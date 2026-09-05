/**
 * The audit, as the spreadsheet a consultant hands over.
 *
 * Two deliverables live in one file, and the operator chooses either or both:
 *
 *   - **Scan results** — the evidence. What was found, on which page, with what
 *     confidence, plus the pages and links the crawl actually read. This is the
 *     part that has to survive scrutiny, so it is the raw record rather than a
 *     summary of it.
 *   - **Action plan** — the work. One row per change, in the order the plan
 *     sequences them, carrying the id, the element to edit, the value it holds
 *     now, the instruction, how to check it is done, and the pages it lands on.
 *     This is the part someone assigns, and it is built so it can be pasted into
 *     a tracker without editing.
 *
 * The first tab is always a cover: what this file is, which site and audit it
 * came from, what the crawl covered, and — stated rather than implied — what it
 * could not see. A spreadsheet outlives the screen it was exported from, so
 * every limit the interface would have shown has to be written into the file
 * itself. Without that, a partial crawl becomes a complete-looking document the
 * moment it is emailed on.
 */

import { buildWorkbook } from './workbook.js';

const COVER_WIDTH = [{ key: 'field', label: 'Field', width: 26 }, { key: 'value', label: 'Value', width: 96 }];

function coverSheet({ audit, urlCounts, plan, findingCount, include, generatedAt }) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const fetched = Number(urlCounts.fetched || 0);
  const discovered = Object.values(urlCounts).reduce((n, v) => n + Number(v || 0), 0);
  const rows = [
    { field: 'Report', value: include.scan && include.plan ? 'Scan results and action plan' : include.plan ? 'Action plan' : 'Scan results' },
    { field: 'Site', value: audit.site_origin || audit.start_url || '' },
    { field: 'Audit id', value: audit.id || '' },
    { field: 'Crawl finished', value: audit.completed_at || audit.started_at || audit.created_at || '' },
    { field: 'Exported', value: generatedAt },
    { field: 'Pages read', value: discovered ? `${fetched} of ${discovered} discovered` : String(fetched) },
    { field: 'Findings recorded', value: Number(findingCount || 0) }
  ];
  // The limit belongs in the file, not only on the screen it was exported from.
  if (discovered > fetched) {
    rows.push({
      field: 'Coverage limit',
      value: `${discovered - fetched} discovered pages were never fetched. Every count in this file describes the ${fetched} pages that were, not the whole site.`
    });
  }
  if (include.plan && plan) {
    const s = plan.changeSummary || {};
    rows.push(
      { field: 'Changes planned', value: Number(s.total || 0) },
      { field: 'Findings they cover', value: Number(s.findings || 0) },
      { field: 'Shared fixes', value: `${Number(s.sitewide || 0) + Number(s.template || 0)} of ${Number(s.total || 0)} apply to more than one page` },
      { field: 'Sequence', value: 'Phases are a dependency order, not a severity ranking. Severity and confidence are recorded per row exactly as the scanner found them.' }
    );
    if (plan.informational?.patterns) {
      rows.push({
        field: 'Excluded from the plan',
        // Only point at the Findings tab when this file has one. A cross-
        // reference to something that is not in the workbook is worse than none.
        value: `${plural(plan.informational.findings, 'informational observation')} across ${plural(plan.informational.patterns, 'pattern')}. They describe the site rather than ask for a change, so they are not work.${include.scan ? ' They are in the Findings tab.' : ''}`
      });
    }
  }
  const drafted = include.plan && plan
    ? (plan.priorities || []).flatMap((p) => (p.actions || []).flatMap((a) => (a.changes || []))).filter((c) => c.draft).length
    : 0;
  if (drafted) {
    rows.push({
      field: 'Drafted values',
      value: `${drafted} change${drafted === 1 ? ' carries a' : 's carry'} drafted replacement text in the "Drafted value" column. A model wrote ${drafted === 1 ? 'it' : 'them'} from this page's own words and ${drafted === 1 ? 'it was' : 'they were'} checked for length, uniqueness and unsupported claims. ${drafted === 1 ? 'It is' : 'They are'} a proposal to review, not a finding, and nothing was applied to the site.`
    });
  }
  if (include.plan && plan?.compression?.templateActions) {
    rows.push({
      field: 'Template actions',
      value: `${plan.compression.templateActions} group${plan.compression.templateActions === 1 ? '' : 's'} of changes look like a single edit to one template, which is why the job count is lower than the change count. Each is a proposal resting on how alike the pages are, not on anything the crawl saw of the code, and the Template actions tab says what to confirm first.`
    });
  }
  if (include.plan && plan?.openQuestions?.length) {
    rows.push({
      field: 'Open questions',
      value: `${plan.openQuestions.length} situation${plan.openQuestions.length === 1 ? '' : 's'} where the site's own signals disagree and no single instruction is defensible. They are in the Open questions tab, stated as questions rather than recommendations because answering them wrongly is worse than leaving them open.`
    });
  }
  rows.push({ field: 'Produced by', value: 'Lumen. Every finding traces to a rule the scan recorded. The only text a model wrote is in the Drafted value column, and it is labelled there.' });
  return { name: 'About this report', columns: COVER_WIDTH, rows };
}

const CHANGE_COLUMNS = [
  { key: 'id', label: 'ID', width: 8 },
  { key: 'priority', label: 'Priority', width: 11 },
  { key: 'category', label: 'Category', width: 26 },
  { key: 'phase', label: 'Phase', width: 30 },
  { key: 'area', label: 'Area of work', width: 34 },
  { key: 'location', label: 'What to change', width: 38 },
  { key: 'current', label: 'What it says now', width: 46 },
  { key: 'action', label: 'Change it to', width: 52 },
  { key: 'draft', label: 'Drafted value', width: 52 },
  { key: 'draftedBy', label: 'Drafted by', width: 16 },
  { key: 'doneWhen', label: 'Done when', width: 60 },
  { key: 'scope', label: 'Scope', width: 16 },
  { key: 'effort', label: 'Effort', width: 30 },
  { key: 'pages', label: 'Pages', width: 8 },
  { key: 'severity', label: 'Severity', width: 11 },
  { key: 'confidence', label: 'Confidence', width: 13 },
  { key: 'rule', label: 'Rule', width: 26 },
  { key: 'findings', label: 'Findings', width: 10 },
  { key: 'pageGroup', label: 'Page group', width: 22 },
  { key: 'urls', label: 'Where', width: 80 },
  { key: 'owner', label: 'Owner', width: 16 },
  { key: 'status', label: 'Status', width: 14 },
  { key: 'notes', label: 'Notes', width: 40 }
];

/**
 * The plan, one row per change.
 *
 * The last three columns are deliberately empty. A tracker is used by writing
 * in it, and a deliverable that has to be restructured before anyone can assign
 * a row is a deliverable that gets rebuilt by hand. Owner, Status and Notes are
 * the operator's columns; Lumen never fills them, and never reads them back.
 */
function changeRows(plan) {
  const rows = [];
  for (const priority of plan.priorities || []) {
    const phase = `${String(priority.order).padStart(2, '0')} ${priority.title}`;
    for (const action of priority.actions || []) {
      for (const change of action.changes || []) {
        rows.push({
          id: change.id,
          phase,
          priority: change.priorityLabel || '',
          category: change.category || '',
          area: action.title,
          location: change.location,
          current: change.current || change.absence || '',
          action: change.action || '',
          // A drafted replacement is a proposal, in its own column beside the
          // instruction rather than in place of it. Merging the two would let a
          // model's sentence be read as the audit's finding, and a reader who
          // pastes this into a page needs to know which is which.
          draft: change.draft || '',
          draftedBy: change.draft ? (change.draftBy === 'byo' ? 'Your model, unchecked' : 'On-device model, unchecked') : '',
          doneWhen: change.doneWhen || '',
          scope: change.scopeLabel || '',
          effort: change.effort || '',
          pages: Number(change.pages || 0),
          severity: change.severity || '',
          confidence: change.confidence || '',
          rule: change.ruleId || '',
          findings: Number(change.instances || 0),
          // Which family of pages this lands on, so a reader can see at a glance
          // which rows are one template and which are scattered.
          pageGroup: change.pageGroup ? `${change.pageGroup.label} (${Math.round(change.pageGroup.coverage * 100)}%)` : '',
          // Every page the change lands on, so the row is actionable on its own
          // once it has left this file.
          urls: (change.urls || []).join('\n'),
          owner: '',
          status: '',
          notes: ''
        });
      }
    }
  }
  return rows;
}

function phaseRows(plan) {
  return (plan.priorities || []).map((p) => ({
    order: Number(p.order || 0),
    title: p.title,
    summary: p.summary,
    unblocks: p.unblocks,
    changes: Number(p.changes || 0),
    findings: Number(p.findings || 0),
    severity: p.severity,
    confidence: p.confidence
  }));
}

/**
 * Build the workbook.
 *
 * `include` decides which deliverables are present; asking for neither is a
 * caller error rather than an empty file.
 */
export function buildAuditWorkbook({
  audit = {}, urlCounts = {}, findings = [], pages = [], links = [], plan = null,
  findingCount = null, include = { scan: true, plan: true }, generatedAt = new Date().toISOString()
} = {}) {
  const wants = { scan: Boolean(include.scan), plan: Boolean(include.plan && plan) };
  if (!wants.scan && !wants.plan) throw new Error('A workbook needs at least one of scan results or the action plan.');

  const sheets = [coverSheet({
    audit, urlCounts, plan, include: wants, generatedAt,
    findingCount: findingCount === null ? findings.length : findingCount
  })];

  // The plan comes first when it was asked for: it is what the recipient is
  // expected to act on, and the evidence behind it is the reference.
  if (wants.plan) {
    sheets.push({ name: 'Action plan', columns: CHANGE_COLUMNS, rows: changeRows(plan) });
    // Conclusions drawn across findings get their own tabs rather than columns:
    // a template proposal covers several rows and a question covers none, so
    // neither fits beside a change without lying about what it is.
    const templates = plan.templateActions || [];
    if (templates.length) {
      sheets.push({
        name: 'Template actions',
        columns: [
          { key: 'id', label: 'ID', width: 8 },
          { key: 'group', label: 'Page group', width: 26 },
          { key: 'covers', label: 'Covers changes', width: 22 },
          { key: 'pages', label: 'Pages', width: 8 },
          { key: 'findings', label: 'Findings resolved', width: 16 },
          { key: 'rootCause', label: 'Why this is probably one edit', width: 90 },
          { key: 'implementation', label: 'What to change in the template', width: 80 },
          { key: 'confidence', label: 'Confidence', width: 13 },
          { key: 'caveat', label: 'Before you act on this', width: 70 }
        ],
        rows: templates.map((t) => ({
          id: t.id,
          group: t.group.label,
          covers: t.resolves.join(', '),
          pages: Number(t.pages || 0),
          findings: Number(t.findings || 0),
          rootCause: t.rootCause,
          implementation: t.implementation.map((s) => `${s.id} ${s.location}: ${s.action}`).join('\n'),
          confidence: t.confidence,
          caveat: t.caveat
        }))
      });
    }

    const questions = plan.openQuestions || [];
    if (questions.length) {
      sheets.push({
        name: 'Open questions',
        columns: [
          { key: 'question', label: 'Question', width: 52 },
          { key: 'why', label: 'Why it is being asked', width: 90 },
          { key: 'blocked', label: 'What Lumen will not decide', width: 70 },
          { key: 'settledBy', label: 'What would settle it', width: 70 },
          { key: 'count', label: 'Pages', width: 8 },
          { key: 'urls', label: 'Where', width: 80 }
        ],
        rows: questions.map((q) => ({
          question: q.question,
          why: q.why,
          blocked: q.blocked,
          settledBy: q.settledBy,
          count: Number(q.count || 0),
          urls: (q.urls || []).join('\n')
        }))
      });
    }
    sheets.push({
      name: 'Plan phases',
      columns: [
        { key: 'order', label: '#', width: 5 },
        { key: 'title', label: 'Phase', width: 34 },
        { key: 'summary', label: 'What it covers', width: 60 },
        { key: 'unblocks', label: 'Why it sits here', width: 90 },
        { key: 'changes', label: 'Changes', width: 10 },
        { key: 'findings', label: 'Findings', width: 10 },
        { key: 'severity', label: 'Worst severity', width: 15 },
        { key: 'confidence', label: 'Weakest confidence', width: 18 }
      ],
      rows: phaseRows(plan)
    });
  }

  if (wants.scan) {
    sheets.push({
      name: 'Findings',
      columns: [
        { key: 'url', label: 'URL', width: 62 },
        { key: 'page_title', label: 'Page title', width: 40 },
        { key: 'rule_id', label: 'Rule', width: 26 },
        { key: 'title', label: 'What was found', width: 44 },
        { key: 'detail', label: 'Detail', width: 90 },
        { key: 'category', label: 'Category', width: 12 },
        { key: 'severity', label: 'Severity', width: 11 },
        { key: 'confidence', label: 'Confidence', width: 13 },
        { key: 'impact_class', label: 'Impact class', width: 16 },
        { key: 'collection_method', label: 'Collected by', width: 15 },
        { key: 'count', label: 'Count', width: 8 }
      ],
      rows: findings
    });
    sheets.push({
      name: 'Pages',
      columns: [
        { key: 'url', label: 'URL', width: 62 },
        { key: 'status', label: 'Crawl status', width: 14 },
        { key: 'http_status', label: 'HTTP', width: 8 },
        { key: 'final_url', label: 'Final URL', width: 62 },
        { key: 'title', label: 'Title', width: 44 },
        { key: 'meta_description', label: 'Meta description', width: 60 },
        { key: 'canonical', label: 'Canonical', width: 50 },
        { key: 'indexable', label: 'Indexable', width: 11 },
        { key: 'h1_count', label: 'H1s', width: 7 },
        { key: 'word_count', label: 'Words', width: 8 },
        { key: 'schema_types', label: 'Schema types', width: 30 },
        { key: 'discovered_via', label: 'Discovered via', width: 20 },
        { key: 'error', label: 'Error', width: 34 }
      ],
      rows: pages
    });
    sheets.push({
      name: 'Links',
      columns: [
        { key: 'source_url', label: 'On page', width: 62 },
        { key: 'target_url', label: 'Points to', width: 62 },
        { key: 'anchor_text', label: 'Anchor text', width: 36 },
        { key: 'internal', label: 'Internal', width: 10 },
        { key: 'status', label: 'Status', width: 14 },
        { key: 'http_status', label: 'HTTP', width: 8 },
        { key: 'final_url', label: 'Final URL', width: 62 }
      ],
      rows: links
    });
  }

  return buildWorkbook(sheets);
}

/** A filename that says what it is without being opened. */
export function workbookFilename(audit, include) {
  const host = String(audit?.site_origin || audit?.start_url || 'site').replace(/^https?:\/\//, '').replace(/[^a-z0-9.-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'site';
  const day = String(audit?.completed_at || audit?.created_at || new Date().toISOString()).slice(0, 10);
  const what = include.scan && include.plan ? 'audit' : include.plan ? 'action-plan' : 'scan-results';
  return `${host}-${what}-${day}.xlsx`;
}
