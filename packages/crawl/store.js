/**
 * Persistent audit storage (Node's built-in node:sqlite — no new dependency).
 *
 * Model: Site → Audit → URLs → Links → Findings. Every table keeps its own
 * evidence rather than collapsing straight to "URL has finding". A single
 * audit is small enough (hundreds to low thousands of rows) that plain SQLite
 * on local/attached disk is the right amount of infrastructure; the schema
 * does not assume that will always be true (see docs/full-site-audit.md).
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS audits (
  id TEXT PRIMARY KEY,
  site_origin TEXT NOT NULL,
  start_url TEXT NOT NULL,
  config_json TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  stats_json TEXT,
  owner TEXT NOT NULL DEFAULT 'shared'
);
CREATE INDEX IF NOT EXISTS idx_audits_site ON audits(site_origin, created_at);

CREATE TABLE IF NOT EXISTS audit_urls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id TEXT NOT NULL,
  url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  discovered_via TEXT,
  depth INTEGER,
  status TEXT NOT NULL,
  http_status INTEGER,
  final_url TEXT,
  redirected INTEGER DEFAULT 0,
  collection_method TEXT,
  title TEXT,
  meta_description TEXT,
  canonical TEXT,
  indexable INTEGER,
  h1_count INTEGER,
  word_count INTEGER,
  error TEXT,
  fetched_at TEXT,
  rendered INTEGER NOT NULL DEFAULT 0,
  rendered_at TEXT,
  schema_types TEXT,
  UNIQUE(audit_id, normalized_url)
);
CREATE INDEX IF NOT EXISTS idx_urls_audit ON audit_urls(audit_id, status);

CREATE TABLE IF NOT EXISTS audit_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  target_url TEXT NOT NULL,
  normalized_target TEXT NOT NULL,
  internal INTEGER NOT NULL,
  anchor_text TEXT,
  status TEXT,
  http_status INTEGER,
  final_url TEXT,
  redirected INTEGER DEFAULT 0,
  checked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_links_audit ON audit_links(audit_id, status);
CREATE INDEX IF NOT EXISTS idx_links_target ON audit_links(audit_id, normalized_target);

/* Structured-data items, one row per parsed node.
   Kept as rows rather than as a blob on audit_urls because the questions asked
   of them are aggregate ones — how many Organizations, under how many @ids,
   across which pages — and those are queries, not a scan of 300 JSON columns.
   props_json is the bounded projection packages/crawl/schema-items.js builds;
   it is never the page's markup. */
CREATE TABLE IF NOT EXISTS audit_schema_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id TEXT NOT NULL,
  url TEXT NOT NULL,
  format TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT '',
  node_id TEXT,
  name TEXT,
  item_path TEXT,
  prop_keys TEXT,
  props_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_schema_audit ON audit_schema_items(audit_id, type);
CREATE INDEX IF NOT EXISTS idx_schema_url ON audit_schema_items(audit_id, url);

/* Blocks that did not parse. A page with broken JSON-LD has no items to record,
   so without this the audit would report it as a page with no structured data —
   the opposite of what is true, and the more expensive mistake. */
CREATE TABLE IF NOT EXISTS audit_schema_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id TEXT NOT NULL,
  url TEXT NOT NULL,
  block_index INTEGER NOT NULL,
  reason TEXT,
  truncated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_schema_blocks_audit ON audit_schema_blocks(audit_id);

/* What the sitemap said, kept rather than counted.
   The crawl read every sitemap URL into memory, enqueued it, recorded the total
   and dropped the set. That total answers "how many" and nothing else, so the
   questions that need membership — is this indexable page absent from the
   sitemap, does the sitemap list a URL that redirects, do the canonical and the
   sitemap disagree — were unanswerable after the crawl even though the data had
   been in hand minutes earlier. Discarding a set you already have is the
   cheapest kind of evidence loss. */
CREATE TABLE IF NOT EXISTS audit_sitemap_urls (
  audit_id TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  url TEXT NOT NULL,
  source TEXT,
  PRIMARY KEY (audit_id, normalized_url)
);
CREATE INDEX IF NOT EXISTS idx_sitemap_audit ON audit_sitemap_urls(audit_id);

CREATE TABLE IF NOT EXISTS audit_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id TEXT NOT NULL,
  url TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  title TEXT,
  detail TEXT,
  category TEXT,
  severity TEXT,
  confidence TEXT,
  impact_class TEXT,
  fingerprint TEXT,
  count INTEGER DEFAULT 1,
  evidence_json TEXT,
  created_at TEXT,
  collection_method TEXT NOT NULL DEFAULT 'static'
);
CREATE INDEX IF NOT EXISTS idx_findings_audit ON audit_findings(audit_id, rule_id);
CREATE INDEX IF NOT EXISTS idx_findings_fingerprint ON audit_findings(audit_id, fingerprint);
`;

const RENDER_CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

export function normalizeAuditUrl(raw) {
  try {
    const u = new URL(String(raw));
    u.hash = '';
    if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return String(raw || '');
  }
}

export function newAuditId() {
  return `audit_${crypto.randomBytes(9).toString('base64url')}`;
}

/** Every state a row in audit_urls can hold. Written down once because it is
 * now an input surface: listUrls() accepts a caller-supplied status filter and
 * anything outside this set is dropped rather than passed through. */
export const URL_STATUSES = Object.freeze(['queued', 'fetching', 'fetched', 'error', 'skipped']);

/** The three states that mean "this page never became evidence" — what the
 * audit UI counts as a coverage gap. Kept beside URL_STATUSES so the UI's
 * definition of a gap and the store's cannot drift apart. */
export const URL_GAP_STATUSES = Object.freeze(['queued', 'error', 'skipped']);

/** The four HTTP status classes the report's status chart can open, as integer
 * bounds. A caller-supplied class only ever selects one of these; nothing from
 * the request reaches SQL as text. */
export const HTTP_STATUS_CLASS_RANGE = Object.freeze({
  '2xx': [200, 299], '3xx': [300, 399], '4xx': [400, 499], '5xx': [500, 599]
});

/** The two indexability states a page can be listed by. `indexable IS NULL`
 * (never read) is deliberately not selectable: it is a coverage gap, and the
 * crawl-state filters already describe those pages. */
export const INDEXABLE_FILTERS = Object.freeze({ yes: 1, no: 0 });

/** Depth is a non-negative integer or nothing. Anything else is dropped rather
 * than rejected, matching how listUrls already treats an unknown status. */
export function normalizeUrlDepth(input) {
  if (input === null || input === undefined || input === '') return null;
  const value = Number(input);
  return Number.isInteger(value) && value >= 0 && value <= 1000 ? value : null;
}

export function normalizeUrlStatuses(input) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : String(input).split(',');
  const seen = new Set();
  for (const raw of list) {
    const value = String(raw || '').trim().toLowerCase();
    if (URL_STATUSES.includes(value)) seen.add(value);
  }
  return [...seen];
}

export function openAuditStore(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  // CREATE TABLE IF NOT EXISTS never adds columns to a table that already
  // exists from an older schema version — a real deployment's data/audits.db
  // persists across redeploys (see services/api/Dockerfile's VOLUME), so a
  // plain schema bump here would crash every existing installation on boot.
  const auditColumns = db.prepare("SELECT name FROM pragma_table_info('audits')").all().map((r) => r.name);
  if (!auditColumns.includes('owner')) {
    db.exec("ALTER TABLE audits ADD COLUMN owner TEXT NOT NULL DEFAULT 'shared'");
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_audits_owner ON audits(owner)');
  const urlColumns = db.prepare("SELECT name FROM pragma_table_info('audit_urls')").all().map((r) => r.name);
  if (!urlColumns.includes('rendered')) {
    db.exec('ALTER TABLE audit_urls ADD COLUMN rendered INTEGER NOT NULL DEFAULT 0');
    db.exec('ALTER TABLE audit_urls ADD COLUMN rendered_at TEXT');
  }
  if (!urlColumns.includes('schema_types')) {
    db.exec('ALTER TABLE audit_urls ADD COLUMN schema_types TEXT');
  }
  if (!urlColumns.includes('h1_text')) {
    db.exec('ALTER TABLE audit_urls ADD COLUMN h1_text TEXT');
  }
  if (!urlColumns.includes('claimed_at')) {
    db.exec('ALTER TABLE audit_urls ADD COLUMN claimed_at TEXT');
  }
  // Link depth was computed by every crawl already (crawler.js's BFS keeps a
  // depth-by-URL map) and thrown away when the worker exited. It is the axis
  // Sitebulb's overview leads with, and keeping it costs one integer per row.
  // Rows written before this column existed stay NULL, and the UI reports
  // "not recorded" for them rather than drawing them as depth 0.
  if (!urlColumns.includes('depth')) {
    db.exec('ALTER TABLE audit_urls ADD COLUMN depth INTEGER');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_urls_depth ON audit_urls(audit_id, depth)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_urls_render_queue ON audit_urls(audit_id, rendered, status)');
  const findingColumns = db.prepare("SELECT name FROM pragma_table_info('audit_findings')").all().map((r) => r.name);
  if (!findingColumns.includes('collection_method')) {
    db.exec("ALTER TABLE audit_findings ADD COLUMN collection_method TEXT NOT NULL DEFAULT 'static'");
  }

  const stmt = {
    deleteAudit: db.prepare('DELETE FROM audits WHERE id = ?'),
    deleteAuditUrls: db.prepare('DELETE FROM audit_urls WHERE audit_id = ?'),
    deleteAuditLinks: db.prepare('DELETE FROM audit_links WHERE audit_id = ?'),
    deleteAuditFindings: db.prepare('DELETE FROM audit_findings WHERE audit_id = ?'),
    deleteAuditSchemaItems: db.prepare('DELETE FROM audit_schema_items WHERE audit_id = ?'),
    deleteAuditSchemaBlocks: db.prepare('DELETE FROM audit_schema_blocks WHERE audit_id = ?'),
    deleteAuditSitemapUrls: db.prepare('DELETE FROM audit_sitemap_urls WHERE audit_id = ?'),
    insertSitemapUrl: db.prepare('INSERT OR REPLACE INTO audit_sitemap_urls (audit_id, normalized_url, url, source) VALUES (?, ?, ?, ?)'),
    listSitemapUrls: db.prepare('SELECT normalized_url, url, source FROM audit_sitemap_urls WHERE audit_id = ? ORDER BY normalized_url'),
    countSitemapUrls: db.prepare('SELECT COUNT(*) AS n FROM audit_sitemap_urls WHERE audit_id = ?'),
    insertSchemaItem: db.prepare('INSERT INTO audit_schema_items (audit_id, url, format, type, node_id, name, item_path, prop_keys, props_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    deleteSchemaItems: db.prepare('DELETE FROM audit_schema_items WHERE audit_id = ? AND url = ?'),
    insertSchemaBlock: db.prepare('INSERT INTO audit_schema_blocks (audit_id, url, block_index, reason, truncated) VALUES (?, ?, ?, ?, ?)'),
    deleteSchemaBlocks: db.prepare('DELETE FROM audit_schema_blocks WHERE audit_id = ? AND url = ?'),
    listSchemaItems: db.prepare('SELECT * FROM audit_schema_items WHERE audit_id = ? ORDER BY url, id'),
    listSchemaBlocks: db.prepare('SELECT * FROM audit_schema_blocks WHERE audit_id = ? ORDER BY url, block_index'),
    countSchemaItems: db.prepare('SELECT COUNT(*) AS n FROM audit_schema_items WHERE audit_id = ?'),
    insertAudit: db.prepare('INSERT INTO audits (id, site_origin, start_url, config_json, status, phase, created_at, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    getAudit: db.prepare('SELECT * FROM audits WHERE id = ?'),
    listAudits: db.prepare('SELECT * FROM audits WHERE site_origin = ? AND owner = ? ORDER BY created_at DESC LIMIT ?'),
    updateAuditStatus: db.prepare('UPDATE audits SET status = ?, phase = ?, error = ?, started_at = COALESCE(started_at, ?), completed_at = ?, stats_json = ? WHERE id = ?'),
    setAuditPhase: db.prepare('UPDATE audits SET phase = ? WHERE id = ?'),
    markRunning: db.prepare("UPDATE audits SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ?"),
    setAuditStats: db.prepare('UPDATE audits SET stats_json = ? WHERE id = ?'),
    setAuditConfig: db.prepare('UPDATE audits SET config_json = ? WHERE id = ?'),
    listByStatus: db.prepare('SELECT id FROM audits WHERE status = ?'),
    auditsForRetention: db.prepare('SELECT id, site_origin, owner, status, created_at FROM audits'),
    upsertUrl: db.prepare(`
      INSERT INTO audit_urls (audit_id, url, normalized_url, discovered_via, status, http_status, final_url, redirected, collection_method, title, meta_description, canonical, indexable, h1_count, h1_text, word_count, error, fetched_at, schema_types)
      VALUES (@audit_id, @url, @normalized_url, @discovered_via, @status, @http_status, @final_url, @redirected, @collection_method, @title, @meta_description, @canonical, @indexable, @h1_count, @h1_text, @word_count, @error, @fetched_at, @schema_types)
      ON CONFLICT(audit_id, normalized_url) DO UPDATE SET
        status=excluded.status, http_status=excluded.http_status, final_url=excluded.final_url, redirected=excluded.redirected,
        collection_method=excluded.collection_method, title=excluded.title, meta_description=excluded.meta_description,
        canonical=excluded.canonical, indexable=excluded.indexable, h1_count=excluded.h1_count, h1_text=excluded.h1_text, word_count=excluded.word_count,
        error=excluded.error, fetched_at=excluded.fetched_at, schema_types=excluded.schema_types
    `),
    insertQueuedUrl: db.prepare(`
      INSERT INTO audit_urls (audit_id, url, normalized_url, discovered_via, depth, status)
      VALUES (?, ?, ?, ?, ?, 'queued')
      ON CONFLICT(audit_id, normalized_url) DO NOTHING
    `),
    getUrlByNormalized: db.prepare('SELECT * FROM audit_urls WHERE audit_id = ? AND normalized_url = ?'),
    countUrlsByStatus: db.prepare("SELECT status, COUNT(*) AS n FROM audit_urls WHERE audit_id = ? GROUP BY status"),
    listUrls: db.prepare('SELECT * FROM audit_urls WHERE audit_id = ? ORDER BY id ASC LIMIT ? OFFSET ?'),
    // Ordered by when the row was actually recorded, not by insertion id: a
    // page enqueued early and fetched a minute later has a low id and never
    // reached a feed sorted by id, which made "recent activity" a list of
    // whatever happened to be discovered last.
    recentUrls: db.prepare("SELECT * FROM audit_urls WHERE audit_id = ? AND status != ? ORDER BY COALESCE(fetched_at,'') DESC, id DESC LIMIT ?"),
    inFlightUrls: db.prepare("SELECT * FROM audit_urls WHERE audit_id = ? AND status = 'fetching' ORDER BY id ASC LIMIT ?"),
    nextQueuedUrl: db.prepare("SELECT * FROM audit_urls WHERE audit_id = ? AND status = 'queued' ORDER BY id ASC LIMIT 1"),
    markUrlFetching: db.prepare("UPDATE audit_urls SET status = 'fetching' WHERE id = ?"),
    nextUrlsNeedingRender: db.prepare("SELECT * FROM audit_urls WHERE audit_id = ? AND status = 'fetched' AND rendered = 0 AND (claimed_at IS NULL OR claimed_at < ?) ORDER BY id ASC LIMIT ?"),
    claimUrlForRender: db.prepare('UPDATE audit_urls SET claimed_at = ? WHERE id = ?'),
    markUrlRendered: db.prepare('UPDATE audit_urls SET rendered = 1, rendered_at = ?, claimed_at = NULL WHERE audit_id = ? AND normalized_url = ?'),
    internalInlinkCounts: db.prepare('SELECT normalized_target, COUNT(*) AS n FROM audit_links WHERE audit_id = ? AND internal = 1 GROUP BY normalized_target'),
    deleteFindingsForUrlByRule: db.prepare('DELETE FROM audit_findings WHERE audit_id = ? AND url = ? AND rule_id = ? AND collection_method = ?'),
    countRunningAuditsByOwner: db.prepare("SELECT COUNT(*) AS n FROM audits WHERE owner = ? AND status IN ('queued','running')"),
    renderCounts: db.prepare("SELECT COUNT(*) AS total, SUM(rendered) AS rendered FROM audit_urls WHERE audit_id = ? AND status = 'fetched'"),
    insertLink: db.prepare(`
      INSERT INTO audit_links (audit_id, source_url, target_url, normalized_target, internal, anchor_text, status, http_status, final_url, redirected, checked_at)
      VALUES (@audit_id, @source_url, @target_url, @normalized_target, @internal, @anchor_text, @status, @http_status, @final_url, @redirected, @checked_at)
    `),
    listLinks: db.prepare('SELECT * FROM audit_links WHERE audit_id = ? ORDER BY id ASC LIMIT ? OFFSET ?'),
    listLinksByStatus: db.prepare('SELECT * FROM audit_links WHERE audit_id = ? AND status = ? ORDER BY id ASC LIMIT ? OFFSET ?'),
    countLinksByStatus: db.prepare('SELECT status, COUNT(*) AS n FROM audit_links WHERE audit_id = ? GROUP BY status'),
    countLinksByTarget: db.prepare('SELECT COUNT(*) AS n FROM audit_links WHERE audit_id = ? AND normalized_target = ?'),
    insertFinding: db.prepare(`
      INSERT INTO audit_findings (audit_id, url, rule_id, title, detail, category, severity, confidence, impact_class, fingerprint, count, evidence_json, created_at, collection_method)
      VALUES (@audit_id, @url, @rule_id, @title, @detail, @category, @severity, @confidence, @impact_class, @fingerprint, @count, @evidence_json, @created_at, @collection_method)
    `),
    listFindings: db.prepare('SELECT * FROM audit_findings WHERE audit_id = ? ORDER BY id ASC LIMIT ? OFFSET ?'),
    listFindingsForUrl: db.prepare('SELECT * FROM audit_findings WHERE audit_id = ? AND url = ? ORDER BY id ASC LIMIT ? OFFSET ?'),
    listFindingsForRule: db.prepare('SELECT * FROM audit_findings WHERE audit_id = ? AND rule_id = ? ORDER BY id ASC LIMIT ? OFFSET ?'),
    listFindingsForRuleAndConfidence: db.prepare('SELECT * FROM audit_findings WHERE audit_id = ? AND rule_id = ? AND confidence = ? ORDER BY id ASC LIMIT ? OFFSET ?'),
    listLinksBySource: db.prepare('SELECT * FROM audit_links WHERE audit_id = ? AND source_url = ? ORDER BY id ASC LIMIT ? OFFSET ?'),
    countFindings: db.prepare('SELECT COUNT(*) AS n FROM audit_findings WHERE audit_id = ?'),
    // MIN(title) carries the human-readable finding title into the grouped
    // view. Scanners write a stable title per ruleId, so the aggregate is the
    // real title rather than an arbitrary pick — and without it the results UI
    // has nothing but the raw rule_id to show a client.
    groupFindingsByRule: db.prepare(`
      SELECT rule_id, MIN(title) AS title, category, severity, confidence, impact_class, COUNT(*) AS instances, COUNT(DISTINCT url) AS affected_urls
      FROM audit_findings WHERE audit_id = ? GROUP BY rule_id, confidence ORDER BY instances DESC
    `)
  };

  function nowIso() { return new Date().toISOString(); }

  return {
    raw: db,

    createAudit({ id = newAuditId(), siteOrigin, startUrl, config, owner = 'shared' }) {
      stmt.insertAudit.run(id, siteOrigin, startUrl, JSON.stringify(config || {}), 'queued', 'queued', nowIso(), owner);
      return id;
    },
    getAudit(id) {
      const row = stmt.getAudit.get(id);
      return row ? hydrateAudit(row) : null;
    },
    /** Every audit belongs to exactly one owner (the shared token, or a
     * managed installation id). This is the boundary that stops one
     * installation from reading, cancelling, or exporting another's audit —
     * callers must check it themselves; the store just records/exposes it. */
    listAudits(siteOrigin, owner, limit = 20) {
      return stmt.listAudits.all(siteOrigin, owner, limit).map(hydrateAudit);
    },
    /** One tenant's own in-flight audit count, for a per-tenant admission
     * cap layered ON TOP OF (never instead of) the process-wide
     * MAX_CONCURRENT_AUDITS ceiling in services/api/server.js — the global
     * ceiling exists to bound total outbound fan-out from our infrastructure
     * regardless of how many tenants are active; a per-tenant cap alone
     * would remove that ceiling entirely as tenant count grows. */
    countRunningAuditsByOwner(owner) {
      return stmt.countRunningAuditsByOwner.get(owner)?.n || 0;
    },
    setPhase(id, phase) {
      stmt.setAuditPhase.run(phase, id);
    },
    /** Persists a config the operator changed mid-run — today only the page
     * budget — so a reopened overlay shows the budget the crawl is actually
     * working to rather than the one it started with. */
    updateAuditConfig(id, config) {
      stmt.setAuditConfig.run(JSON.stringify(config || {}), id);
    },
    finishAudit(id, { status, error = null, stats = null }) {
      stmt.updateAuditStatus.run(status, status, error, nowIso(), nowIso(), stats ? JSON.stringify(stats) : null, id);
    },
    markRunning(id) {
      stmt.markRunning.run(nowIso(), id);
    },
    /**
     * Merges facts into a running audit's stats blob.
     *
     * stats_json used to be written only by finishAudit(), which meant every
     * fact the crawl establishes early was unreadable until the whole crawl
     * ended. The site signals are the ones that hurt: robots.txt, the sitemap
     * and llms.txt are all fetched in the discovering phase, before a single
     * page is crawled, yet an operator watching the run saw "Not checked in
     * this audit" for all three — the audit had checked them minutes earlier
     * and simply had nowhere to put the answer. Reporting a completed check as
     * unchecked is the exact failure this product exists to avoid.
     *
     * A shallow merge is enough: callers own whole top-level keys, and
     * finishAudit still writes the complete stats at the end.
     */
    mergeAuditStats(id, patch = {}) {
      const row = stmt.getAudit.get(id);
      if (!row) return null;
      const merged = { ...safeParse(row.stats_json, {}), ...patch };
      stmt.setAuditStats.run(JSON.stringify(merged), id);
      return merged;
    },
    /** A 'running' audit with no worker left (e.g. a server restart) never
     * finishes on its own — call once at startup so it fails honestly instead
     * of appearing to hang forever. */
    reconcileInterruptedAudits(errorMessage = 'Interrupted by a server restart.') {
      const ids = stmt.listByStatus.all('running').map((r) => r.id);
      for (const id of ids) this.finishAudit(id, { status: 'failed', error: errorMessage });
      return ids;
    },

    /** `depth` is the number of link hops from the start URL. DO NOTHING on
     * conflict means the first enqueue wins, which is exactly the shortest
     * path under the crawler's breadth-first frontier — a URL later reached
     * again from deeper in the site must not overwrite its own shorter route. */
    enqueueUrl(auditId, url, discoveredVia = 'link', depth = null) {
      const normalized = normalizeAuditUrl(url);
      const result = stmt.insertQueuedUrl.run(auditId, url, normalized, discoveredVia, depth == null ? null : Number(depth));
      return result.changes > 0;
    },
    hasUrl(auditId, url) {
      return Boolean(stmt.getUrlByNormalized.get(auditId, normalizeAuditUrl(url)));
    },
    claimNextQueuedUrl(auditId) {
      const row = stmt.nextQueuedUrl.get(auditId);
      if (!row) return null;
      stmt.markUrlFetching.run(row.id);
      return row;
    },
    recordUrlResult(auditId, url, fields) {
      const normalized = normalizeAuditUrl(url);
      stmt.upsertUrl.run({
        audit_id: auditId, url, normalized_url: normalized,
        discovered_via: fields.discoveredVia || null,
        status: fields.status || 'fetched',
        http_status: fields.httpStatus ?? null,
        final_url: fields.finalUrl || null,
        redirected: fields.redirected ? 1 : 0,
        collection_method: fields.collectionMethod || 'static',
        title: fields.title || null,
        meta_description: fields.metaDescription || null,
        canonical: fields.canonical || null,
        indexable: fields.indexable === undefined ? null : (fields.indexable ? 1 : 0),
        h1_count: fields.h1Count ?? null,
        h1_text: fields.h1Text || null,
        word_count: fields.wordCount ?? null,
        error: fields.error || null,
        fetched_at: nowIso(),
        schema_types: fields.schemaTypes?.length ? JSON.stringify(fields.schemaTypes) : null
      });
    },
    /** Replaces whatever was recorded for this page. A render pass re-visits a
     * page the static tier already read, and appending would double every item. */
    /**
     * Remove an audit and everything recorded under it.
     *
     * Added because there was no way to. Every other table keys on audit_id and
     * none of them cascade, so a deleted audit row would have left its pages,
     * links, findings, schema items and sitemap behind as rows belonging to an
     * audit that no longer exists. That is worse than not deleting at all: the
     * counts still answer, from data nothing can reach.
     *
     * Deliberately not exposed over the API. Nothing in the product deletes an
     * audit today, and a destructive endpoint with no caller is a liability
     * rather than a feature; this exists for fixtures and maintenance.
     */
    /** Every audit's retention-relevant columns, for packages/crawl/retention.js.
     * Deliberately not the whole row: the purge decision needs an id, a site, an
     * owner, a status and an age, and nothing else. */
    auditsForRetention() {
      return stmt.auditsForRetention.all();
    },
    deleteAudit(auditId) {
      const id = String(auditId || '');
      if (!id) return false;
      const existed = Boolean(stmt.getAudit.get(id));
      stmt.deleteAuditSitemapUrls.run(id);
      stmt.deleteAuditSchemaBlocks.run(id);
      stmt.deleteAuditSchemaItems.run(id);
      stmt.deleteAuditFindings.run(id);
      stmt.deleteAuditLinks.run(id);
      stmt.deleteAuditUrls.run(id);
      stmt.deleteAudit.run(id);
      return existed;
    },
    /** The sitemap's URL set, written once as the crawl reads it. */
    recordSitemapUrls(auditId, entries = []) {
      for (const entry of entries) {
        if (!entry?.normalized || !entry?.url) continue;
        stmt.insertSitemapUrl.run(auditId, entry.normalized, entry.url, entry.source || null);
      }
    },
    /** Membership, as a Set of normalized URLs. Empty when no sitemap was read,
     * which callers must tell apart from "read and this URL is absent" — the
     * two support opposite conclusions. */
    sitemapUrlSet(auditId) {
      return new Set(stmt.listSitemapUrls.all(auditId).map((r) => r.normalized_url));
    },
    sitemapUrlRows(auditId) {
      return stmt.listSitemapUrls.all(auditId);
    },
    sitemapUrlCount(auditId) {
      return Number(stmt.countSitemapUrls.get(auditId)?.n || 0);
    },
    recordSchema(auditId, url, { items = [], invalidBlocks = [], truncated = false } = {}) {
      stmt.deleteSchemaItems.run(auditId, url);
      stmt.deleteSchemaBlocks.run(auditId, url);
      for (const item of items) {
        stmt.insertSchemaItem.run(
          auditId, url, item.format || 'json-ld', item.type || '', item.nodeId || null,
          item.name || null, item.path || null,
          JSON.stringify(item.propKeys || []), JSON.stringify(item.props || {})
        );
      }
      for (const block of invalidBlocks) {
        stmt.insertSchemaBlock.run(auditId, url, Number(block.blockIndex) || 0, block.reason || null, 0);
      }
      if (truncated) stmt.insertSchemaBlock.run(auditId, url, -1, 'Item limit reached for this page', 1);
    },
    /** Every page's schema, in the shape packages/findings/schema-validation.js
     * reads. Pages with no items are included: a page that was parsed and found
     * to carry nothing is evidence, and dropping it would make the denominator
     * of every coverage statement wrong. */
    schemaPages(auditId, { parsedUrls = null } = {}) {
      const byUrl = new Map();
      const ensure = (url) => {
        if (!byUrl.has(url)) byUrl.set(url, { url, items: [], invalidBlocks: [], truncated: false });
        return byUrl.get(url);
      };
      for (const url of parsedUrls || []) ensure(url);
      for (const row of stmt.listSchemaItems.all(auditId)) {
        let props = {};
        let propKeys = [];
        try { props = JSON.parse(row.props_json || '{}'); } catch { props = {}; }
        try { propKeys = JSON.parse(row.prop_keys || '[]'); } catch { propKeys = []; }
        ensure(row.url).items.push({
          format: row.format, type: row.type || '', nodeId: row.node_id || '',
          name: row.name || '', path: row.item_path || '', propKeys, props
        });
      }
      for (const row of stmt.listSchemaBlocks.all(auditId)) {
        const page = ensure(row.url);
        if (row.truncated) page.truncated = true;
        else page.invalidBlocks.push({ blockIndex: row.block_index, reason: row.reason || '' });
      }
      return [...byUrl.values()];
    },
    schemaItemCount(auditId) {
      return Number(stmt.countSchemaItems.get(auditId)?.n || 0);
    },
    urlCountsByStatus(auditId) {
      return Object.fromEntries(stmt.countUrlsByStatus.all(auditId).map((r) => [r.status, r.n]));
    },
    /** `statuses` narrows the listing to specific crawl states. It exists so
     * the audit UI's "Coverage gaps" tile can open the pages that were never
     * turned into evidence (queued/error/skipped) rather than the whole list —
     * a tile that says 178 must be able to show those 178. Values are checked
     * against URL_STATUSES before they reach SQL, so the interpolated part of
     * the query is only ever a run of '?' placeholders. */
    listUrls(auditId, { limit = 100, offset = 0, statuses = null, depth = null, httpClass = null, indexable = null } = {}) {
      const wanted = normalizeUrlStatuses(statuses);
      const depthValue = normalizeUrlDepth(depth);
      const range = HTTP_STATUS_CLASS_RANGE[String(httpClass || '').toLowerCase()] || null;
      // Tri-state on purpose: a page whose indexability was never read is
      // neither indexable nor noindex, and must not be swept into either.
      const indexableFlag = INDEXABLE_FILTERS[String(indexable || '').toLowerCase()] ?? null;
      if (!wanted.length && depthValue === null && !range && indexableFlag === null) return stmt.listUrls.all(auditId, limit, offset);
      const where = ['audit_id = ?'];
      const params = [auditId];
      if (wanted.length) {
        where.push(`status IN (${wanted.map(() => '?').join(',')})`);
        params.push(...wanted);
      }
      if (depthValue !== null) { where.push('depth = ?'); params.push(depthValue); }
      // A status class is two integer bounds, never an interpolated string:
      // the caller's value only ever selects one of four fixed ranges.
      if (range) { where.push('http_status BETWEEN ? AND ?'); params.push(range[0], range[1]); }
      if (indexableFlag !== null) { where.push('indexable = ?'); params.push(indexableFlag); }
      return db
        .prepare(`SELECT * FROM audit_urls WHERE ${where.join(' AND ')} ORDER BY id ASC LIMIT ? OFFSET ?`)
        .all(...params, limit, offset);
    },
    /** Most recently updated non-queued rows, for a live "recent activity"
     * feed in the audit UI — not a general-purpose listing. */
    recentUrls(auditId, limit = 6) {
      return stmt.recentUrls.all(auditId, 'queued', limit);
    },
    /** The URLs the crawl has claimed but not yet recorded a result for — what
     * the progress screen shows as "now requesting". */
    inFlightUrls(auditId, limit = 3) {
      return stmt.inFlightUrls.all(auditId, limit);
    },

    /** The local render pass (run in the user's own browser, never ours —
     * see crawler.js's module doc) works off this queue: pages the static
     * crawl already fetched successfully but that have not yet had a full
     * rendered scan submitted via recordRenderResult. Handing out a row also
     * claims it (a leased timestamp, not a hard lock) so two concurrent
     * pollers — two open side panels, or a retried request racing a slow-but-
     * successful one — don't both grab and duplicate-render the same URL. A
     * claim that's never fulfilled (the tab/service worker died mid-render)
     * simply expires after RENDER_CLAIM_TIMEOUT_MS and the row becomes
     * offerable again — there is no separate "release" call needed. */
    nextUrlsNeedingRender(auditId, limit = 1) {
      const staleBefore = new Date(Date.now() - RENDER_CLAIM_TIMEOUT_MS).toISOString();
      const rows = stmt.nextUrlsNeedingRender.all(auditId, staleBefore, limit);
      const claimedAt = nowIso();
      for (const row of rows) stmt.claimUrlForRender.run(claimedAt, row.id);
      return rows;
    },
    markUrlRendered(auditId, url) {
      stmt.markUrlRendered.run(nowIso(), auditId, normalizeAuditUrl(url));
    },
    /** Once a page has actually been rendered, its findings supersede the
     * static tier's weaker, inferred equivalents for the same rule on the
     * same page (e.g. a real a11y.lang-missing observation replaces the
     * static tier's own inferred version) — prefer confirmed evidence over
     * inferred evidence for the same fact, never keep both. Call this with
     * the rule IDs the incoming rendered findings actually cover, before
     * recording them. */
    supersedeStaticFindings(auditId, url, ruleIds = []) {
      for (const ruleId of ruleIds) stmt.deleteFindingsForUrlByRule.run(auditId, url, ruleId, 'static');
    },
    renderProgress(auditId) {
      const row = stmt.renderCounts.get(auditId) || {};
      const total = row.total || 0;
      const rendered = row.rendered || 0;
      return { total, rendered, remaining: Math.max(0, total - rendered) };
    },

    recordLinks(auditId, sourceUrl, links = []) {
      for (const link of links) {
        stmt.insertLink.run({
          audit_id: auditId, source_url: sourceUrl, target_url: link.url,
          normalized_target: normalizeAuditUrl(link.url), internal: link.internal ? 1 : 0,
          anchor_text: (link.text || '').slice(0, 300), status: link.status || 'unknown',
          http_status: link.httpStatus ?? null, final_url: link.finalUrl || null,
          redirected: link.redirected ? 1 : 0, checked_at: nowIso()
        });
      }
    },
    linkCountsByStatus(auditId) {
      return Object.fromEntries(stmt.countLinksByStatus.all(auditId).map((r) => [r.status, r.n]));
    },
    listLinks(auditId, { status = null, limit = 100, offset = 0, sourceUrl = null } = {}) {
      if (sourceUrl) return stmt.listLinksBySource.all(auditId, sourceUrl, limit, offset);
      return status ? stmt.listLinksByStatus.all(auditId, status, limit, offset) : stmt.listLinks.all(auditId, limit, offset);
    },
    inlinkCountForTarget(auditId, targetUrl) {
      return stmt.countLinksByTarget.get(auditId, normalizeAuditUrl(targetUrl))?.n || 0;
    },
    /** Bulk version of inlinkCountForTarget, for cross-page checks (orphan
     * pages) that need every internal target's inbound count at once rather
     * than one query per crawled URL. */
    internalInlinkCounts(auditId) {
      return new Map(stmt.internalInlinkCounts.all(auditId).map((r) => [r.normalized_target, r.n]));
    },

    recordFindings(auditId, url, findings = [], { collectionMethod = 'static' } = {}) {
      for (const f of findings) {
        stmt.insertFinding.run({
          audit_id: auditId, url, rule_id: String(f.ruleId || 'unknown'),
          title: f.title || '', detail: (f.detail || '').slice(0, 2000), category: f.category || '',
          severity: f.severity || '', confidence: f.confidence || '', impact_class: f.impactClass || '',
          fingerprint: f.fingerprint || '', count: Number(f.count || 1),
          evidence_json: JSON.stringify({ selector: f.selector || '', evidence: f.evidence || '', link: f.link || null }).slice(0, 4000),
          created_at: nowIso(), collection_method: collectionMethod
        });
      }
    },
    findingsCount(auditId) { return stmt.countFindings.get(auditId)?.n || 0; },

    /**
     * Every distribution the report's discipline sections draw, as GROUP BY
     * aggregates rather than as rows shipped to the client. This is the whole
     * reason those sections can exist without new collection: the columns are
     * already in audit_urls and audit_links, they were simply never summarised.
     *
     * Only fetched pages are summarised — a queued or errored row has no
     * title, canonical or word count to bucket, and folding its absence in
     * with a page that genuinely lacks one would turn a coverage gap into a
     * content defect. `depth` is the exception: it is known at enqueue time,
     * so it is reported across every discovered URL and carries its own crawl
     * state so the chart can show reached versus never-reached at each level.
     *
     * The title/description length cuts are the same numbers seo.js uses
     * (15/65 and 50/160), because a bucket that disagreed with the finding it
     * sits beside would be its own bug.
     */
    auditDistributions(auditId) {
      const rows = (sql, ...params) => db.prepare(sql).all(auditId, ...params);
      const one = (sql, ...params) => db.prepare(sql).get(auditId, ...params) || {};

      const depth = rows(`
        SELECT depth, status, COUNT(*) AS n FROM audit_urls
        WHERE audit_id = ? GROUP BY depth, status ORDER BY depth IS NULL, depth ASC
      `).map((r) => ({ depth: r.depth === null ? null : Number(r.depth), status: r.status, n: Number(r.n) }));

      const httpStatus = rows(`
        SELECT http_status AS status, COUNT(*) AS n FROM audit_urls
        WHERE audit_id = ? AND http_status IS NOT NULL
        GROUP BY http_status ORDER BY http_status ASC
      `).map((r) => ({ status: Number(r.status), n: Number(r.n) }));

      // rtrim(x,'/') tolerates the one difference that shows up constantly in
      // real canonicals — a trailing slash on one side and not the other. It
      // is not full URL normalisation, and the UI says the comparison is
      // literal so nobody reads 'points elsewhere' as more than it is.
      const canonical = one(`
        SELECT
          SUM(CASE WHEN canonical IS NULL OR TRIM(canonical) = '' THEN 1 ELSE 0 END) AS missing,
          SUM(CASE WHEN canonical IS NOT NULL AND TRIM(canonical) <> ''
                    AND (rtrim(canonical,'/') = rtrim(url,'/') OR rtrim(canonical,'/') = rtrim(COALESCE(final_url, url),'/'))
                   THEN 1 ELSE 0 END) AS self,
          SUM(CASE WHEN canonical IS NOT NULL AND TRIM(canonical) <> ''
                    AND rtrim(canonical,'/') <> rtrim(url,'/') AND rtrim(canonical,'/') <> rtrim(COALESCE(final_url, url),'/')
                   THEN 1 ELSE 0 END) AS other
        FROM audit_urls WHERE audit_id = ? AND status = 'fetched'
      `);

      const page = one(`
        SELECT
          COUNT(*) AS fetched,
          SUM(CASE WHEN indexable = 1 THEN 1 ELSE 0 END) AS indexable,
          SUM(CASE WHEN indexable = 0 THEN 1 ELSE 0 END) AS noindex,
          SUM(CASE WHEN indexable IS NULL THEN 1 ELSE 0 END) AS indexableUnknown,
          SUM(CASE WHEN redirected = 1 THEN 1 ELSE 0 END) AS redirected,
          SUM(CASE WHEN title IS NULL OR TRIM(title) = '' THEN 1 ELSE 0 END) AS titleMissing,
          SUM(CASE WHEN title IS NOT NULL AND TRIM(title) <> '' AND LENGTH(title) < 15 THEN 1 ELSE 0 END) AS titleShort,
          SUM(CASE WHEN LENGTH(title) BETWEEN 15 AND 65 THEN 1 ELSE 0 END) AS titleOk,
          SUM(CASE WHEN LENGTH(title) > 65 THEN 1 ELSE 0 END) AS titleLong,
          SUM(CASE WHEN meta_description IS NULL OR TRIM(meta_description) = '' THEN 1 ELSE 0 END) AS descMissing,
          SUM(CASE WHEN meta_description IS NOT NULL AND TRIM(meta_description) <> '' AND LENGTH(meta_description) < 50 THEN 1 ELSE 0 END) AS descShort,
          SUM(CASE WHEN LENGTH(meta_description) BETWEEN 50 AND 160 THEN 1 ELSE 0 END) AS descOk,
          SUM(CASE WHEN LENGTH(meta_description) > 160 THEN 1 ELSE 0 END) AS descLong,
          SUM(CASE WHEN h1_count = 0 THEN 1 ELSE 0 END) AS h1None,
          SUM(CASE WHEN h1_count = 1 THEN 1 ELSE 0 END) AS h1One,
          SUM(CASE WHEN h1_count > 1 THEN 1 ELSE 0 END) AS h1Many,
          SUM(CASE WHEN h1_count IS NULL THEN 1 ELSE 0 END) AS h1Unknown,
          SUM(CASE WHEN word_count IS NULL THEN 1 ELSE 0 END) AS wordsUnknown,
          SUM(CASE WHEN word_count < 150 THEN 1 ELSE 0 END) AS words0,
          SUM(CASE WHEN word_count BETWEEN 150 AND 499 THEN 1 ELSE 0 END) AS words150,
          SUM(CASE WHEN word_count BETWEEN 500 AND 999 THEN 1 ELSE 0 END) AS words500,
          SUM(CASE WHEN word_count >= 1000 THEN 1 ELSE 0 END) AS words1000,
          SUM(CASE WHEN schema_types IS NOT NULL AND TRIM(schema_types) <> '' THEN 1 ELSE 0 END) AS withSchema,
          SUM(CASE WHEN rendered = 1 THEN 1 ELSE 0 END) AS rendered
        FROM audit_urls WHERE audit_id = ? AND status = 'fetched'
      `);

      // Internal versus external is the split Availability leads with: a broken
      // link on your own site is your defect, one to someone else's is their
      // outage plus your stale link, and the fix differs.
      const linksByScope = rows(`
        SELECT internal, status, COUNT(*) AS n FROM audit_links
        WHERE audit_id = ? GROUP BY internal, status
      `).map((r) => ({ internal: Number(r.internal) === 1, status: r.status || 'unknown', n: Number(r.n) }));

      const duplicateSets = (column) => db.prepare(`
        SELECT ${column} AS value, COUNT(*) AS n FROM audit_urls
        WHERE audit_id = ? AND status = 'fetched' AND ${column} IS NOT NULL AND TRIM(${column}) <> ''
        GROUP BY ${column} HAVING n > 1 ORDER BY n DESC, value ASC LIMIT 25
      `).all(auditId).map((r) => ({ value: String(r.value), pages: Number(r.n) }));

      const num = (v) => Number(v || 0);
      return {
        depth,
        httpStatus,
        canonical: { missing: num(canonical.missing), self: num(canonical.self), other: num(canonical.other) },
        pages: {
          fetched: num(page.fetched),
          indexable: num(page.indexable), noindex: num(page.noindex), indexableUnknown: num(page.indexableUnknown),
          redirected: num(page.redirected), rendered: num(page.rendered), withSchema: num(page.withSchema),
          title: { missing: num(page.titleMissing), short: num(page.titleShort), ok: num(page.titleOk), long: num(page.titleLong) },
          description: { missing: num(page.descMissing), short: num(page.descShort), ok: num(page.descOk), long: num(page.descLong) },
          h1: { none: num(page.h1None), one: num(page.h1One), many: num(page.h1Many), unknown: num(page.h1Unknown) },
          words: { thin: num(page.words0), short: num(page.words150), medium: num(page.words500), long: num(page.words1000), unknown: num(page.wordsUnknown) }
        },
        linksByScope,
        duplicates: {
          titles: duplicateSets('title'),
          descriptions: duplicateSets('meta_description'),
          h1s: duplicateSets('h1_text')
        }
      };
    },
    listFindings(auditId, { limit = 100, offset = 0, url = null, ruleId = null, confidence = null } = {}) {
      if (url) return stmt.listFindingsForUrl.all(auditId, url, limit, offset);
      if (ruleId && confidence) return stmt.listFindingsForRuleAndConfidence.all(auditId, ruleId, confidence, limit, offset);
      if (ruleId) return stmt.listFindingsForRule.all(auditId, ruleId, limit, offset);
      return stmt.listFindings.all(auditId, limit, offset);
    },
    findingsByRule(auditId) {
      return stmt.groupFindingsByRule.all(auditId);
    },

    close() { db.close(); }
  };
}

function hydrateAudit(row) {
  return {
    ...row,
    config: safeParse(row.config_json, {}),
    stats: safeParse(row.stats_json, null)
  };
}
function safeParse(text, fallback) {
  try { return text ? JSON.parse(text) : fallback; } catch { return fallback; }
}
