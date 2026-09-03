# Lumen ↔ Sitebulb parity evaluation and plan

Status: **Phases 0 and 1 are built.** Phases 2–6 remain a proposal. The
per-phase headings in §5 and the table in §6 record what shipped, including the
two places the built work departs from what was written here.

Source of comparison: 13 screenshots of a Sitebulb 9.18 audit of a ~10,200-URL
site, and 4 screenshots of a Lumen Site Audit of `nixlawutah.com`.
Research: Sitebulb's published hint catalogue and report documentation
(see "Sources" at the end).

This document is scoped to the **Site Audit** surface. Page Scan is out of scope
except where it feeds site-level data.

---

## 1. What the screenshots actually show

### Sitebulb's audit, structurally

| Surface | What it carries |
|---|---|
| Audit Overview | 3 score dials (Audit / SEO / Security), 4 crawl tiles each with a **View** drill-in (Crawled 10.2K, Internal 5.7K, External 1.8K, Resources 2.6K), an Audit Details record (date range, start URL, project, page limit, depth limit, crawl type, user-agent string), audit actions, audit notes, and four charts |
| Overview charts | Crawled-URLs-by-depth, a crawl-state counter strip (Success 9,572 / Not Found 32 / Redirected 449 / Disallowed 0 / Timeout 0 / Forbidden 87 / Error 40), HTTP-status pie, URL-segments pie, URL-type-by-depth stacked bar, HTML-URL-sources bar |
| Left nav | ~15 report sections: All Hints, HTML Templates, SEO, Internal, Links, Indexability, Redirects, On Page, Duplicate Content, Security, Page Resources, External, XML Sitemap Generator |
| Every report | A score dial, a priority chip row (Critical / High / Medium / Low / Insights / No Issue) **and** a type chip row (All Hints / Issues / Potential Issues / Opportunities), then section-specific tables and charts, then a Hints tab |
| URL Explorer | 5,707 rows, 100/page, sortable per column, per-column menus, quick search, advanced filter builder, **Add/Remove Columns**, export |
| Link Explorer | 1,248,701 link rows with target / anchor / linking URL, scoped by dropdown (internal links, internal anchor text, external links, external anchor text) |
| Distinctive data | Link **location** classification (Header / Navigation / Breadcrumb / Aside / Footer / Content), follow-vs-nofollow-vs-sponsored-vs-UGC, incoming-internal-link histogram, isolated-URL states, per-bot robots.txt evaluation, domain-resolution test (http/https × www/non-www), synthetic 404 probes, TLS protocol and cipher-suite inspection |

### Lumen's audit, structurally

| Surface | What it carries |
|---|---|
| Left nav | 4 items: Overview, Findings (235), Pages (40), Links (1.2k) |
| Overview | 4 tiles (not clickable), the **Site conditions** readout with per-row confidence, a severity bar, findings-by-area, top issues, coverage |
| Findings | Grouped rule cards with severity, instances, pages affected and an explicit confidence label; category filter, sort, hide-unconfirmed, two quick chips |
| Pages | 5 fixed columns (Page, Status, Title, Words, Structured data), one text filter |
| Links | 4 fixed columns (Source page, Links to, Anchor text, Status), status chips, one text filter |

### The headline number problem

The audited site had **218 discovered pages and Lumen fetched 40** — the default
`maxPages`. The overlay's headline reads "40 pages crawled, 128 broken links, 235
findings", and the coverage card correctly says 178 pages were never fetched. But
the headline still reads as a whole-site claim, and every count under it is a
count of 18% of the site. Sitebulb crawled 10,200 URLs of the comparison site.

Separately, the same run shows **0 of 40 browser-checked**. The optional render
pass — which is where Lumen's accessibility, runtime-error, and performance
evidence comes from — did not run. So the audit in the screenshot exercised
roughly the static half of what Lumen can already do.

---

## 2. What Lumen already does better, and must not trade away

Parity work must not sand these off:

1. **Confidence is on every finding.** Sitebulb has no equivalent column. Its
   "No Issue 102" chip presents unchecked and checked-and-clean identically.
2. **Coverage is accounted for as its own fact.** "80 links could not be
   independently verified", "178 pages still queued", "0 of 40 browser-checked".
   Sitebulb reports Timeout/Forbidden counts but does not separate *not
   established* from *established clean*.
3. **No score.** `packages/crawl/audit-summary.js` deliberately refuses one.
   Sitebulb's four dials (88, 87, 77, 66…) are the most immediately impressive
   thing on its screen and the least defensible line in a client report.
4. **Frank walkthroughs** and on-device reasoning.
5. **Findings are grouped by rule** with instance and page counts, rather than
   presented as a flat per-URL list.

---

## 3. Gap analysis

### 3.1 Data model gaps (these block whole report sections)

| Missing entity | Consequence | Sitebulb equivalent |
|---|---|---|
| **Resources** — JS, CSS, images, fonts, PDFs | No broken-image report, no page weight, no cache-policy check, no disallowed-JS/CSS check, no resource redirects, no image-level alt inventory | "Resources 2.6K" tile, Page Resources report |
| **Redirect chains** | `audit_urls.redirected` is a boolean. No hop sequence, so no chain length, no loop detection, no "redirects to a 404", no chain export | Redirects report (13 hints) + Export Redirect Chains |
| **Link attributes** — location, rel, link type, follow status | No Link Location table, no follow/nofollow/sponsored/UGC split, no "orphan except from footer" analysis | Internal/External Link Location and Nofollow tables |
| **Per-URL response timing** | No TTFB distribution, no slow-page list at site level | Response Times report |
| **Inbound link counts per URL** | `structure.orphan-page` exists, but there is no "only one internal linking URL", no incoming-link histogram, no link-equity view | Incoming Internal Followed Links histogram |

All of these except resources and timing are **parse-time data the static
collector already touches and throws away**. They are schema and extraction
work, not architecture work.

### 3.2 Report-section gaps

Lumen has 4 nav sections. Everything below is either absent or buried inside the
undifferentiated Findings list:

| Section | Lumen today | Notes |
|---|---|---|
| Availability | Findings only | Broken links/resources, errors, timeouts, forbidden. **Per the standing prioritization rule this section leads, not accessibility.** |
| Indexability | Findings only | `seo.canonical-*`, `seo.noindex`, `seo.robots-*`, `structure.orphan-page` already exist. Missing: per-bot robots evaluation, isolated-URL state breakdown, canonical distribution |
| Redirects | Nothing | Needs the chain table first |
| Duplicates | Findings only | `seo.duplicate-title`, `seo.duplicate-description` exist. Missing: duplicate H1, duplicate/similar body content |
| On-page / content | Findings only | Title/description/H1 length, word-count distribution, alt-text inventory |
| Sitemaps | Findings only | `seo.sitemap-orphan`, `seo.sitemap-unreached`, `seo.sitemap-blocked-by-robots` exist with no surface |
| International | Findings only | `seo.hreflang-*`, `a11y.lang-*` exist. Sitebulb has 24 hreflang hints; Lumen has 2 |
| Security | Findings only | 8 security rules exist with no surface. Missing entirely: TLS protocol/cipher inspection |
| Performance | Findings only | `performance.browser.*` exists from the render pass; no site-level surface |
| Accessibility | Findings only | axe results exist from the render pass; no site-level surface, no WCAG grouping |
| Resources | Nothing | Blocked on the resources entity |
| Site structure | Nothing | No depth distribution, no directory/segment breakdown, no template grouping |

**The cheapest, highest-value observation in this document:** eight of those
sections can be built from data Lumen already collects and already stores. The
product looks four-sections-deep because of presentation, not because of
collection.

### 3.3 Table and interaction gaps

| Capability | Sitebulb | Lumen |
|---|---|---|
| Column chooser | Yes | No — 5 fixed columns |
| Per-column sort | Yes, all columns | Pages has `data-sort` attrs; Links has none |
| Per-column filter menus | Yes | No |
| Advanced filter builder | Yes | No |
| Rows per page | 100 / 500 / 1000 | Fixed page size |
| Export from the current view | Yes | Export is global-only, from Overview |
| Row count / position | "1 to 100 of 5,707 URLs" | Prev/next with a label |
| Deep-link from a tile or chart into a filtered list | Every tile has **View** | None — tiles are inert |

### 3.4 Site-level probes Lumen does not perform

- **Domain resolution test** — is `http://`, `https://`, `www.`, non-`www` each
  crawlable or redirecting? Four requests. Sitebulb puts it at the top of SEO.
- **Synthetic 404 test** — request a made-up URL and check for a real 404 rather
  than a soft 200. Lumen infers `seo.soft-404-probable` but never probes.
- **Per-bot robots.txt evaluation** — Googlebot / Bingbot / etc. Lumen parses
  robots.txt but evaluates one agent.
- **TLS protocol and cipher-suite inspection** — Sitebulb's Security report is
  largely this. Node can read the negotiated protocol and cipher from one TLS
  socket; enumerating supported suites needs several handshakes.
- **Response timing capture** on the pages already being fetched.

### 3.5 Scale

`CRAWL_LIMITS.hardMaxPages` is **300**, default 40. Sitebulb does 500,000
(desktop). An agency auditing a client site of 5,000 pages cannot use Lumen for
the job it exists to do. This is the one gap that is genuinely architectural —
see §5, Phase 5.

---

## 4. Things that need a product decision, not engineering

These are called out rather than planned, because `PRODUCT.md` records them as
undecided or as deliberate refusals. **Do not implement them silently.**

1. **Scores.** Sitebulb leads with four dials. Lumen refuses a score by design.
   *Recommendation: keep the refusal.* Solve what the dial actually solves —
   instant orientation and section triage — by giving every nav section a state
   chip (Needs attention / Observed / Not established, plus a count), which is
   the same glanceable signal without the false precision. Revisit only if the
   operator asks for a number.
2. **Audit comparison and history.** `PRODUCT.md` lists this as undecided.
   Sitebulb's "Compare Audits" and changed-hints view are a major agency
   workflow — proving improvement to a client. Strong candidate, but it is a
   product commitment.
3. **Scheduled / unattended runs.** Undecided. Conflicts with the extension-side
   execution model: a scheduled crawl has no browser to run in.
4. **GA / Search Console integration.** Sitebulb's entire Search Traffic hint
   family depends on it. It would mean sending client analytics through the
   gateway, which cuts against the on-device posture. Flagged, not recommended.
5. **PDF export.** Undecided. The HTML report already exists and is the cheaper
   90%.

---

## 5. The plan

Phases are ordered so that each one ships something a consultant can see.
Sizing is relative (S / M / L), not calendar time.

### Phase 0 — Truth and visible defects (S) — **built**

Small, and it removes things that undercut trust in everything else.
Locked by `tests/audit-scope-truth.test.js`.

1. **Status pills wrap mid-word.** In the Links table "broken" renders as
   "broke / n" and in Pages "queued" renders as "queue / d". Fix the pill's
   `white-space` / min-width in the overlay stylesheet.
2. **Partial-crawl banner.** When `fetched < discovered`, the results header must
   say so persistently — "40 of 218 pages. Counts below describe the 40." Today
   the truth is one card down and the headline reads as a whole-site claim.
3. **Make the Overview tiles drill in.** Every Sitebulb tile has a View link.
   Every Lumen tile should navigate to the matching filtered list.
4. **Surface the render pass.** A run that reports `0 of 40 browser-checked` has
   silently skipped accessibility, runtime errors and performance. Make the
   render pass's availability and state a first-class element of the Overview,
   with a one-click start.

### Phase 1 — Surface what is already collected (M) — **built**

No new collection. Pure presentation of existing findings and `audit_urls`
columns. This is where the product stops looking four-sections-deep.
Locked by `tests/report-sections-phase1.test.js`.

**Two departures from what was written below**, both deliberate:

1. **A tenth discipline, "Web quality", was added.** The nine sections listed
   here do not cover `web.*`, `schema.*`, `social.*`, `analytics.*` or `ux.*`,
   so an implementation-class finding would have been visible in the flat
   Findings list and in no discipline section at all. The rule-to-discipline
   map is now total, and a test asserts that every rule id either tier can emit
   lands in exactly one section.
2. **`audit_urls` gained a `depth` column.** The crawl-depth distribution asked
   for below could not be drawn from the existing columns: `crawler.js` already
   computed depth for its own frontier and threw the map away when the worker
   exited. Persisting the integer it had already worked out is the minimum
   supporting change, and it is additive (old rows read as "not recorded"
   rather than as depth 0). Nothing new is fetched, parsed or requested.

New nav sections, in this order (functional failures first, per the standing
prioritization rule):

1. **Availability** — broken internal links, broken external links, error and
   timeout states, plus the unverified ledger. Lumen's lead section.
2. **Indexability** — canonical distribution, noindex, robots directives,
   orphan/isolated pages, robots.txt readout.
3. **Content** — titles, descriptions, headings, word-count distribution,
   alt-text inventory.
4. **Duplicates** — duplicate titles, descriptions, H1s.
5. **Sitemaps** — sitemap ↔ crawl reconciliation, already computed and unexposed.
6. **Security** — the 8 existing security rules plus the header readout.
7. **International** — hreflang and lang findings.
8. **Performance** and **Accessibility** — render-pass evidence, each with an
   explicit "N of M pages browser-checked" coverage line so an unrun render pass
   reads as *not established*, never as clean.

Each section gets: a state chip in the nav, a small tile row, its own findings
list scoped to that area, and its own coverage statement.

As built, the state chip carries the three words the Site conditions readout
already uses — Needs attention / Observed / Not established — and a count that
excludes `inconclusive` findings. That exclusion matters: on a site that
rate-limits automated requests, one unverifiable-destination group carried
3,519 instances and made Availability's chip read "3.6k" while 40 links were
actually broken. The unverified figure is stated in the section's own coverage
line, as coverage rather than as defects.

Also in Phase 1: a **depth and status distribution** on Overview
(crawled-by-depth chart plus HTTP-status breakdown), which is the single most
useful thing Sitebulb's overview has that Lumen's lacks. Built as horizontal
bar rows rather than a column chart — the same form every other distribution in
the report uses, which stays legible in a narrow panel — and drawn across every
*discovered* URL with the never-reached share hatched, so a page-limited crawl
can say "2,738 URLs found one hop in, 11 reached". Both charts open the pages
behind any bar: `listUrls` now accepts a depth and an HTTP status class.

### Phase 2 — Data model expansion (M–L)

Schema plus extraction. All of it is cheap, parse-time work in the existing
static collector; none of it requires a browser on the server.

1. **Link attributes** — add `link_location` (header / nav / breadcrumb / aside /
   footer / content, from the nearest landmark ancestor), `rel` (nofollow /
   sponsored / ugc), `link_type` (anchor / image / form) and `follow` to
   `audit_links`. Unlocks the Link Location table and follow/nofollow analysis.
2. **Inbound link counts** — derive per-URL incoming-followed-link counts at
   crawl end. Unlocks the incoming-link histogram and "only one internal linking
   URL".
3. **Redirect chains** — new `audit_redirects` table storing the hop sequence the
   collector already walks and discards. Unlocks the Redirects section, chain
   loops, chains ending in 4xx/5xx, and a chain export.
4. **Resources** — new `audit_resources` + `audit_page_resources`. Collect
   script/link/img/font references during parse; HEAD-check them under the same
   safe-probe discipline as external links. Unlocks broken images, resource
   redirects, page weight, cache policy, disallowed JS/CSS.
5. **Response timing** — record TTFB and total fetch duration per URL.

New sections that unlock: **Redirects**, **Resources**, plus the Link Location
and inbound-link views inside Links.

### Phase 3 — Explorer-grade tables (M)

One shared data-grid component, used by Pages, Links, Resources and finding
instances:

- column chooser with a persisted per-user column set
- sort on every column
- per-column filter menus
- an advanced filter builder (field / operator / value, AND-ed rows)
- selectable page size, with "1 to 100 of 5,707" position text
- export of the current filtered view, not just the global dataset
- deep-linkable state, so a tile or chart can open a pre-filtered view

### Phase 4 — Site-level probes (S–M)

Each is a handful of requests against the origin, not per-page work:

1. Domain resolution test (4 variants).
2. Synthetic 404 test (page / folder / image / stylesheet paths that cannot
   exist), reported as confirmed evidence of soft-404 behaviour.
3. Per-bot robots.txt evaluation.
4. TLS protocol and cipher inspection. Note this is necessarily server-side and
   belongs to the gateway tier, not the extension tier.

### Phase 5 — Scale (L, architectural)

The 300-page cap is the blocker on Lumen being usable for the audience
`PRODUCT.md` names. Two paths:

- **Recommended: move the crawl into the extension.** The manifest already
  declares `optional_host_permissions` for `http://*/*` and `https://*/*`, and
  recent work made those grants persist across Chrome restarts. An MV3 service
  worker with host permissions can fetch cross-origin without CORS. The gateway
  becomes storage, analysis and reporting; fetching and parsing land on the
  operator's machine. This *strengthens* Principle 3 rather than straining it,
  and removes the reason the cap exists.
- **Fallback: raise the gateway cap with backpressure.** Simpler, but it makes
  infrastructure scale with the audited site's size, which Principle 3 calls
  suspect. Appropriate only for the public single-URL scanner path.

Either path also needs: streaming/incremental ingest so results appear during a
long crawl, row virtualization in the tables, and pagination that survives
100k-row datasets.

### Phase 6 — The decisions from §4

Only after an explicit product call: comparison/history, scheduling, PDF,
analytics integration.

---

## 6. Sequencing summary

| Phase | Theme | Size | Visible outcome |
|---|---|---|---|
| 0 | Truth and defects | S | **Built.** Nothing on screen lies or looks broken |
| 1 | Surface existing data | M | **Built.** 4 sections → 14; overview gains distributions |
| 2 | Data model | M–L | Redirects and Resources become real; links gain location and rel |
| 3 | Explorer tables | M | Pages/Links/Resources become analysis tools |
| 4 | Site-level probes | S–M | Domain resolution, 404 behaviour, per-bot robots, TLS |
| 5 | Scale | L | Thousand-page client sites become auditable |
| 6 | Product decisions | — | Comparison, scheduling, PDF, integrations |

Phases 0 and 1 together are the largest visible change per unit of work in the
whole document, and neither adds a single new network request. That held: the
built work adds one gateway endpoint (`GET /api/audits/:id/distributions`,
GROUP BY aggregates over rows already stored) and no new outbound traffic.

---

## Sources

- Sitebulb hint catalogue: [Hints index](https://sitebulb.com/hints/),
  [Indexability](https://sitebulb.com/hints/indexability/),
  [Links](https://sitebulb.com/hints/links/),
  [On Page](https://sitebulb.com/hints/on-page/),
  [Internal](https://sitebulb.com/hints/internal/),
  [Redirects](https://sitebulb.com/hints/redirects/),
  [Duplicate Content](https://sitebulb.com/hints/duplicate-content/),
  [XML Sitemaps](https://sitebulb.com/hints/xml-sitemaps/),
  [International](https://sitebulb.com/hints/international/),
  [Mobile Friendly](https://sitebulb.com/hints/mobile-friendly/),
  [Performance](https://sitebulb.com/hints/performance/),
  [Security](https://sitebulb.com/hints/security/),
  [Rendered](https://sitebulb.com/hints/rendered/),
  [Search Traffic](https://sitebulb.com/hints/search-traffic/),
  [Accessibility](https://sitebulb.com/hints/accessibility/)
- [Navigating Sitebulb Audits](https://support.sitebulb.com/en/articles/9854039-navigating-sitebulb-audits)
- [About Sitebulb Hints](https://support.sitebulb.com/en/articles/9854034-about-sitebulb-hints)
- [Filter Hints lists](https://support.sitebulb.com/en/articles/9496953-filter-hints-lists)
- [Sitebulb features](https://sitebulb.com/features/)
