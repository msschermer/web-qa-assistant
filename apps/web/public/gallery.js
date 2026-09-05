/**
 * The specimens, and the contexts they are rendered in.
 *
 * A specimen is markup, not a screenshot: it is built from the same class names
 * the surface uses and dropped into that surface's own cascade, so it renders
 * the way the product renders.
 *
 * There are two halves. The first puts the four surfaces beside each other on
 * one idea at a time, which is the only way the drift between them is visible:
 * in the product they are never on screen together. The second is the overlay's
 * own states, which lead with the ones an audit will not conveniently produce,
 * because those are the ones that rot unseen.
 *
 * The sealed confidence vocabulary is imported rather than listed. A fifth
 * level would then appear on every surface's specimen without anyone
 * remembering to add it, which is the failure this page exists to prevent.
 */

import { CONFIDENCE_LEVELS } from '/assets/confidence.js';

/**
 * The four surfaces, and how each is faithfully reproduced.
 *
 * `kind` is the whole point. The overlay is a shadow root because the content
 * script builds one; the other three are documents and are rendered in iframes
 * because their stylesheets style `html` and `body`. Putting a panel specimen
 * in a shadow root would silently drop the rules that set its canvas, its 12.5px
 * base type and its line height, and the specimen would look fine while the
 * product did not.
 */
const SURFACES = {
  overlay: {
    label: 'Site Audit overlay',
    context: 'shadow root, inline all:initial',
    kind: 'shadow',
    css: '/assets/site-audit.css'
  },
  panel: {
    label: 'Side panel',
    context: 'its own document, 360px',
    kind: 'frame',
    css: '/assets/sidepanel.css',
    // The only surface with a real width. Chrome gives the side panel roughly
    // this, and its own sheet has a 300px floor, so a specimen at any other
    // width is answering a question the product never asks. The other three
    // are wide surfaces being sampled and share whatever the row has left.
    width: 360
  },
  web: {
    label: 'Web app',
    context: 'its own document',
    kind: 'frame',
    css: '/styles.css'
  },
  report: {
    label: 'Exported report',
    context: 'one self-contained file',
    kind: 'frame',
    css: '/assets/report.css'
  }
};

const SURFACE_ORDER = ['overlay', 'panel', 'web', 'report'];

/* --- How each surface draws confidence ------------------------------------
 *
 * One function per surface, each reading the sealed vocabulary and rendering it
 * the way that surface's own code does. Where a surface collapses levels
 * together, the collapse is reproduced rather than corrected: showing four
 * distinct chips on a surface that ships two would hide exactly the thing this
 * row is for. The mappings below are the ones in the shipping code, cited.
 */

// packages/findings/priority.js: isEstablished() is confirmed or corroborated.
const established = (level) => level === 'confirmed' || level === 'corroborated';

const CONFIDENCE_BY_SURFACE = {
  // apps/extension/content.js: a bare coloured dot, one rule per level. The
  // only surface that draws all four apart.
  overlay: () => row(CONFIDENCE_LEVELS.map((level) => `
    <span style="display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--sa-ink-soft)">
      <span class="confidence-dot ${level}"></span>${level}</span>`)),

  // apps/extension/sidepanel.js: `.chip-confidence` takes tone ok for the two
  // established levels and warn for the other two. Four levels, two colours.
  panel: () => row(CONFIDENCE_LEVELS.map((level) =>
    `<span class="chip chip-confidence chip-meta" data-tone="${established(level) ? 'ok' : 'warn'}">${level}</span>`)),

  // apps/web/public/app.js: coloured text, no dot, and `inconclusive` is
  // written out as the empty string, so the level renders as nothing at all.
  web: () => row(CONFIDENCE_LEVELS.map((level) =>
    `<span class="finding-confidence" data-confidence="${level}">${level === 'inconclusive' ? '(blank)' : level}</span>`)),

  // packages/crawl/report.js: evidenceDot() maps the four onto two classes,
  // established and early. The word is kept, the distinction inside each pair
  // is not.
  report: () => row(CONFIDENCE_LEVELS.map((level) =>
    `<span class="ev ev-${established(level) ? 'established' : 'early'}">${level}</span>`))
};

/* --- How each surface draws the severity ramp ----------------------------- */

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

// apps/extension/content.js: one pill primitive, tones assigned by severity.
const OVERLAY_SEVERITY_TONE = {
  critical: 'critical-solid', high: 'critical', medium: 'warn', low: 'warn', info: 'muted'
};

const SEVERITY_BY_SURFACE = {
  overlay: () => row(SEVERITIES.map((s) =>
    `<span class="pill" data-tone="${OVERLAY_SEVERITY_TONE[s]}">${cap(s)}</span>`)),

  // The panel has no severity chip at all: it shows an impact class and a
  // priority word instead, and its chip primitive answers to five tones. This
  // is the vocabulary it actually ships.
  panel: () => row(['critical', 'warn', 'ok', 'info', 'muted'].map((tone) =>
    `<span class="chip" data-tone="${tone}">${cap(tone)}</span>`)),

  // The web app has no severity either: `.finding-priority` carries Lumen's
  // remediation priority as coloured text, and only two of its values have a
  // colour rule.
  web: () => row(['blocker', 'high', 'medium', 'low'].map((p) =>
    `<span class="finding-priority" data-priority="${p}">${p}</span>`)),

  // packages/crawl/report.js: a second pill primitive, one class per severity,
  // unrelated to the overlay's tone vocabulary.
  report: () => row(SEVERITIES.map((s) => `<span class="pill pill-${s}">${s}</span>`))
};

/* --- How each surface draws Lumen's identity ------------------------------ */

// Each lockup is the markup its surface ships, verbatim, empty spans and
// aria-hidden included, and inside the ancestor it really sits in. The ancestor
// is not decoration: the web app's title is sized by `.masthead h1`, so a
// lockup lifted out of its header renders at the browser's bare h1 instead and
// the specimen shows a size the product never draws.
//
// Three of these draw the tile with the lens ring. The fourth draws a letter,
// and `.mark` means two different things depending on which file you are in.
const MARK_BY_SURFACE = {
  overlay: () => `<div class="head">
    <span class="mark" aria-hidden="true"></span>
    <span class="identity"><span class="name">Lumen</span><span class="device">Site audit</span></span>
  </div>`,
  panel: () => `<div class="app-header">
    <div class="brand-lockup">
      <span class="brand-mark" aria-hidden="true"></span>
      <div class="app-id"><h1>Lumen</h1><p>Ready to scan this page</p></div>
    </div>
  </div>`,
  web: () => `<header class="masthead">
    <div class="brand-lockup">
      <span class="brand-mark" aria-hidden="true"></span>
      <div><h1>Lumen</h1><p>See what the page is actually doing.</p></div>
    </div>
  </header>`,
  report: () => `<header>
    <span class="mark">L</span>
    <h1>Site audit: example.com</h1>
    <p class="prov">https://example.com/ · 2026-09-04 18:20 UTC · complete</p>
  </header>`
};

/* --- How each surface presents one finding -------------------------------- */

const FINDING_BY_SURFACE = {
  overlay: () => changeRow(false),
  panel: () => `<article class="finding finding-card">
    <div class="finding-top"><span class="chips">
      <span class="chip chip-class" data-tone="critical">Availability</span>
      <span class="chip chip-priority chip-meta" data-tone="critical">Fix first</span>
      <span class="chip chip-confidence chip-meta" data-tone="ok">Confirmed</span>
      <span class="chip chip-instances">10 pages</span>
    </span></div>
    <h3>A link points at a page that is gone</h3>
    <p class="detail">The destination answered 404, so the link cannot reach it.</p>
    <div class="finding-next"><span>Next step</span><p>Fix or remove the link, or redirect the destination to a working URL.</p></div>
    <p class="finding-context">"Tooele County" · in the site footer</p>
  </article>`,
  web: () => `<article class="finding finding-card" data-kind="fix">
    <div class="finding-top"><span>
      <span class="kind">fix</span>
      <span class="finding-priority" data-priority="blocker">blocker</span>
      <span class="finding-confidence" data-confidence="confirmed">confirmed</span>
    </span><span class="sources">link probe · crawl</span></div>
    <h3>A link points at a page that is gone</h3>
    <p class="detail">The destination answered 404, so the link cannot reach it.</p>
    <p class="finding-context">"Tooele County" · in the site footer</p>
    <div class="finding-actions"><button class="ask-frank">Walk through</button><button class="copy-issue">Copy issue</button></div>
  </article>`,
  report: () => `<ol class="priorities"><li>
    <span class="p-rank">01</span>
    <div class="p-body">
      <p class="p-top"><b>A link points at a page that is gone</b> <span class="pill pill-critical">critical</span> <span class="ev ev-established">confirmed</span></p>
      <p class="p-scope">10 pages · <span class="rule-inline">link-target-missing</span></p>
      <p class="p-guidance">Fix or remove the link, or 301-redirect the destination to a working URL.</p>
    </div>
  </li></ol>`
};

/* --- How each surface says there is nothing to show ----------------------- */

const EMPTY_BY_SURFACE = {
  overlay: () => `<div class="schema-empty"><b>No work is sequenced.</b><p class="hint">The crawl recorded no findings that ask for a change. Informational observations are in Findings.</p></div>`,
  panel: () => `<div class="empty-findings"><b>Nothing material needs your attention.</b>No confirmed issues in the current evidence.</div>`,
  web: () => `<div class="empty-findings"><b>Nothing material needs your attention.</b>Use Show all checks to inspect lower-priority observations.</div>`,
  report: () => `<p class="empty">Nothing to show here.</p>`
};

/* --- The page ------------------------------------------------------------- */

const GROUPS = [
  {
    band: 'The four surfaces, side by side'
  },
  {
    title: 'Confidence',
    why: 'The sealed vocabulary from packages/findings/confidence.js, drawn by each surface as it really draws it. Read across: the overlay separates all four levels, the side panel and the exported report each collapse them onto two colours, and the web app writes inconclusive out as the empty string. The four words mean four things everywhere in the reasoning layer and are drawn as two or three in three places out of four.',
    cross: CONFIDENCE_BY_SURFACE
  },
  {
    title: 'Severity and priority',
    why: 'What each surface puts where a severity belongs. The overlay and the report have two unrelated pill primitives, one keyed on a tone vocabulary and the other on the severity name. The side panel ships no severity at all, only its five chip tones, and the web app carries Lumen\'s remediation priority as coloured text with a colour rule for two of its four values.',
    cross: SEVERITY_BY_SURFACE
  },
  {
    title: 'The identity mark',
    why: 'apps/extension/sidepanel.css states the contract in a comment: one mark across every surface, the violet tile with the lens ring, because three near-variants of a logo read as three products. Three surfaces draw the tile. The exported report, the one artifact that leaves the building and reaches a client, draws a letter L.',
    cross: MARK_BY_SURFACE
  },
  {
    title: 'One finding, four presentations',
    why: 'The same broken link, as each surface presents it. This is the composite of everything above, and it is what a consultant actually walks a client through before sending them the last of the four.',
    cross: FINDING_BY_SURFACE,
    // Whole cards, so two per line rather than four: a clipped card compares
    // nothing.
    paired: true
  },
  {
    title: 'Nothing to show',
    why: 'An empty state says what would fill it. These are the states a healthy site produces, and a healthy site is the one nobody tests against.',
    cross: EMPTY_BY_SURFACE
  },

  {
    band: 'The Site Audit overlay, state by state'
  },
  {
    title: 'Remediation priority',
    why: 'What a change is worth doing first, which is not what the scanner thinks of it. Shown together because the defect they had was only visible together: as separate hues they read as a severity ramp.',
    specimens: [
      ['blocker', pill('Blocker', 'critical-solid')],
      ['high', pill('High', 'critical')],
      ['medium', pill('Medium', 'warn')],
      ['low', pill('Low', 'muted')]
    ]
  },
  {
    title: 'Phase in the sequence',
    why: 'Position in the plan. One hue getting quieter, never the severity ramp: "do this first" is not "this is worse".',
    specimens: [
      ['now', pill('Now', 'brand')],
      ['next', pill('Next', 'outline')],
      ['then', pill('Then', 'muted')],
      ['later', pill('Later', 'muted')]
    ]
  },
  {
    title: 'Scope of a change',
    why: 'How far one edit reaches. The difference between one job and many, which is the plan’s central claim.',
    specimens: [
      ['sitewide', pill('Sitewide', 'brand')],
      ['template', pill('Shared template', 'outline')],
      ['single page', pill('Single page', 'muted')],
      ['several pages', pill('4 pages', 'muted')]
    ]
  },
  {
    title: 'Severity, as the scanner recorded it',
    why: 'The sealed ramp. Fills only: no value here may ever follow color:, which check.mjs enforces.',
    specimens: [
      ['critical', pill('Critical', 'critical-solid')],
      ['high', pill('High', 'critical')],
      ['medium', pill('Medium', 'warn')],
      ['low', pill('Low', 'warn')],
      ['info', pill('Info', 'muted')]
    ]
  },
  {
    title: 'A change, closed and open',
    why: 'The row a plan is executed from. Closed it answers what someone assigning work asks; open it answers what the person doing it asks. Reproduced here because reaching a real one costs a crawl.',
    wide: true,
    specimens: [
      ['closed', changeRow(false)],
      ['open', changeRow(true)],
      ['no value recorded', changeRow(false, { absent: true })]
    ]
  },
  {
    title: 'Read across the findings',
    why: 'Conclusions no single check could reach. Both needed a hand-built synthetic audit before they could be looked at, and the interface for them was written blind.',
    wide: true,
    specimens: [
      ['open question', questionCard()],
      ['template action', templateCard()]
    ]
  },
  {
    title: 'Coverage that was not surveyed',
    why: 'The hatch. What was not looked at is never greyed out and never coloured as a failure.',
    specimens: [
      ['hatched', '<div style="width:220px;height:56px;border:1px solid var(--sa-line-strong);border-radius:var(--sa-radius-sm);background-image:linear-gradient(var(--sa-surface),var(--sa-surface)),var(--sa-hatch);background-origin:padding-box,border-box;background-clip:padding-box,border-box"></div>']
    ]
  },
  {
    title: 'Earlier audits of this site',
    why: 'The row a consultant decides from: open the recent audit, or run a new one. Reproduced here because reaching it needs several audits of one origin, days apart, which no single run produces. The delta against the audit before is the only part a crawler could not report on its own, so it is the part worth looking at.',
    wide: true,
    specimens: [
      ['improving, regressing, unchanged', historyList()],
      ['one audit, nothing to compare', historyList({ single: true })],
      ['still running', historyList({ running: true })]
    ]
  },
  {
    title: 'Empty and unavailable',
    why: 'The overlay’s own empty states, which state what would have filled them rather than showing a blank panel.',
    wide: true,
    specimens: [
      ['nothing sequenced', EMPTY_BY_SURFACE.overlay()],
      ['no page groups', '<section class="structure"><div class="card-head"><h3>Page groups</h3><p class="hint">None of the 12 pages read fall into a group. Nothing in the plan is treated as template work.</p></div></section>']
    ]
  }
];

/* --- Markup helpers ------------------------------------------------------- */

function cap(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** A horizontal run of specimens inside one surface's frame, so a whole
 * vocabulary can be read at once and each value seen against its neighbours. */
function row(parts) {
  return `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">${parts.join('')}</div>`;
}

function pill(text, tone) {
  return `<span class="pill" data-tone="${tone}">${text}</span>`;
}

function changeRow(open, { absent = false } = {}) {
  const now = absent
    ? '<span class="change-now absent">not present</span>'
    : '<span class="change-now">"Tooele County" &rarr; https://example.com/gone (HTTP 404)</span>';
  const body = open ? `<div class="change-body">
    <dl class="change-facts">
      <dt>Change</dt><dd>Fix or remove the link, or 301-redirect the destination to a working URL.</dd>
      <dt>Done when</dt><dd>The link resolves to a working page, or has been removed.</dd>
      <dt>Effort</dt><dd>One change, applied once</dd>
      <dt>Priority</dt><dd>Near the front of the queue: the scanner recorded it as high and confirmed, and one edit resolves it on all 10 pages carrying it.</dd>
    </dl>
    <div class="optimize-rules"><span class="pill cap" data-tone="ok">confirmed</span></div>
    <p class="change-where">On 10 pages</p>
  </div>` : '';
  return `<ul class="change-list"><li>
    <button type="button" class="change-head" aria-expanded="${open}">
      <span class="change-id">C01</span>
      <span class="pill" data-tone="critical">High</span>
      <span class="change-loc">The link href and its destination</span>
      ${now}
      <span class="change-meta"><span class="change-category">Link targets</span><span class="pill" data-tone="brand">Sitewide</span></span>
      <svg class="change-caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5"/></svg>
    </button>
    ${body}
  </li></ul>`;
}

/** The earlier-audits list from the Site Audit setup screen. Markup matches
 * renderSiteAuditHistory() in apps/extension/content.js. */
function historyList({ single = false, running = false } = {}) {
  const row = (when, meta, delta, action) => `<li>
    <span><span class="history-when">${when}</span>${meta}${delta}</span>
    <button type="button">${action}</button>
  </li>`;
  const plain = (n) => `<span class="history-meta">  ${n} findings</span>`;
  const delta = (dir, text) => `<span class="history-delta" data-dir="${dir}">  ${text}</span>`;

  let rows;
  if (single) {
    rows = row('3 hours ago', plain(38), '', 'Open');
  } else if (running) {
    rows = row('12 minutes ago', '<span class="history-running">  still running</span>', '', 'Resume')
      + row('2 days ago', plain(44), delta('same', 'no change'), 'Open');
  } else {
    rows = row('an hour ago', plain(38), delta('down', '6 fewer than the audit before'), 'Open')
      + row('yesterday', plain(44), delta('same', 'no change'), 'Open')
      + row('2 days ago', plain(44), delta('up', '17 more than the audit before'), 'Open');
  }
  return `<section class="history">
    <div class="history-head">
      <h3>Earlier audits of this site</h3>
      <p class="hint history-policy">Audits are deleted after 7 days, and only the 5 most recent per site are kept.</p>
    </div>
    <ul class="history-list">${rows}</ul>
  </section>`;
}

function questionCard() {
  return `<section class="reason-card question">
    <div class="reason-head"><span class="pill" data-tone="warn">Needs a decision</span><h3>Which URL is this page meant to be indexed as?</h3></div>
    <p class="reason-body">The canonical, the sitemap and the internal links do not agree. Each signal is valid on its own, which is why no single check reports a problem.</p>
    <p class="reason-caveat">Lumen cannot tell which URL was intended without knowing what the site meant to publish.</p>
    <p class="reason-settled">Decide which URL should be the indexed one, then make the canonical, the sitemap and the internal links all name it.</p>
  </section>`;
}

function templateCard() {
  return `<section class="reason-card merge">
    <div class="reason-head"><span class="pill" data-tone="brand">T01</span><h3>These 3 changes look like one template edit</h3><span class="pill cap" data-tone="warn">inferred</span><span class="reason-scope">7 pages &middot; 21 findings</span></div>
    <p class="reason-body">3 different kinds of change land on the same 7 pages, which are all of /team/*. Several separate things being wrong across one page family usually means one template emitting all of them.</p>
    <div class="reason-covers"><button type="button" class="optimize-rule">C02 The JSON-LD block</button><button type="button" class="optimize-rule">C03 The &lt;title&gt; tag</button></div>
    <p class="reason-caveat">Confirm these pages are emitted by one template before editing as one.</p>
  </section>`;
}

/* --- Rendering contexts --------------------------------------------------- */

/**
 * The overlay's context: a shadow root under the host contract the content
 * script builds, inline `all:initial` included.
 *
 * That inline declaration outranks `:host`, which is why the overlay sets
 * colour-scheme, accent-color and scrollbar-color on `.workspace` rather than
 * on the host. A specimen rendered without it would be a different cascade from
 * the product's, and would agree with nothing.
 */
function mountShadow(markup, css) {
  const host = document.createElement('div');
  host.setAttribute('data-webqa-ui', 'gallery-specimen');
  host.dataset.gallerySurface = 'overlay';
  host.style.cssText = 'all:initial;display:block';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  // .workspace carries the type and colour the overlay's contents inherit from,
  // so a specimen outside one would render at the browser's 16px default.
  const frame = document.createElement('div');
  frame.className = 'workspace';
  frame.style.cssText = 'position:static;inset:auto;border-radius:0;box-shadow:none;display:block;overflow:visible;background:transparent';
  frame.innerHTML = markup;
  shadow.append(style, frame);
  return { host, ready: Promise.resolve() };
}

/**
 * A document surface's context: a real iframe, so `html` and `body` rules
 * apply.
 *
 * `srcdoc` keeps the frame same-origin, which is what lets the frame measure
 * itself and lets tools/autoqa/gallery-check.mjs read into it. Height is taken
 * from the specimen wrapper rather than from the document, because the report's
 * body is `min-height:100vh` and measuring the document would only ever return
 * the height the frame already had.
 */
function mountFrame(markup, css, surface, key) {
  const host = document.createElement('div');
  host.setAttribute('data-webqa-ui', 'gallery-specimen');
  host.dataset.gallerySurface = key;

  const frame = document.createElement('iframe');
  frame.title = `${surface.label} specimen`;
  frame.setAttribute('scrolling', 'no');
  frame.style.height = '40px';
  frame.srcdoc = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="${css}">
<style>
  /* The only rules the gallery adds. Padding on a wrapper, never on body: the
     surfaces set their own body margin and type, and those are the rules being
     inspected. The hidden overflow on the root stops a frame that is sized to
     its content from also offering to scroll it. */
  html { overflow: hidden; }
  .lumen-specimen { padding: 14px; }
</style></head><body><div class="lumen-specimen">${markup}</div></body></html>`;

  const ready = new Promise((resolve) => {
    frame.addEventListener('load', async () => {
      const doc = frame.contentDocument;
      try { await doc.fonts.ready; } catch { /* a frame without a font set is still measurable */ }
      const wrapper = doc.querySelector('.lumen-specimen');
      const measure = () => {
        // Round up: a fractional height leaves a hairline scroll.
        frame.style.height = `${Math.ceil(wrapper.getBoundingClientRect().height)}px`;
      };
      measure();
      // Late layout — a font swapping in, an image decoding — moves the floor.
      new frame.contentWindow.ResizeObserver(measure).observe(wrapper);
      resolve();
    }, { once: true });
  });

  host.appendChild(frame);
  return { host, ready };
}

function mount(markup, key, sheets) {
  const surface = SURFACES[key];
  return surface.kind === 'shadow'
    ? mountShadow(markup, sheets[key])
    : mountFrame(markup, surface.css, surface, key);
}

/* --- Assembly ------------------------------------------------------------- */

function cell({ label, context, width, framed }) {
  const node = document.createElement('div');
  node.className = 'specimen' + (framed ? ' framed' : '');
  // Only a surface with a real width in the product gets one here. The rest
  // share the row, so all four stay on one line and can be read across.
  if (width) {
    node.style.width = `${width}px`;
    node.dataset.fixed = 'true';
  }
  const tag = document.createElement('span');
  tag.className = 'label';
  tag.textContent = label;
  if (context) {
    const note = document.createElement('span');
    note.className = 'context';
    note.textContent = context;
    tag.appendChild(note);
  }
  node.appendChild(tag);
  return node;
}

async function build() {
  const status = document.getElementById('status');

  // Only the overlay's stylesheet is fetched: it is injected as a string, so a
  // shadow root has to be handed the text. The three document surfaces link
  // their own sheets from inside their frames, exactly as they do in the
  // product.
  const sheets = {};
  try {
    const res = await fetch(SURFACES.overlay.css);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    sheets.overlay = await res.text();
  } catch (error) {
    status.textContent = `Could not load ${SURFACES.overlay.css} (${error.message}). Run npm run build:extension, which emits it.`;
    return;
  }

  const gallery = document.getElementById('gallery');
  const pending = [];

  for (const group of GROUPS) {
    const section = document.createElement('section');

    if (group.band) {
      section.className = 'band';
      const h = document.createElement('h2');
      h.textContent = group.band;
      section.appendChild(h);
      gallery.appendChild(section);
      continue;
    }

    const h = document.createElement('h2');
    h.textContent = group.title;
    const why = document.createElement('p');
    why.className = 'why';
    why.textContent = group.why;
    const rowEl = document.createElement('div');
    rowEl.className = group.cross ? `specimens cross${group.paired ? ' paired' : ''}` : 'specimens';

    if (group.cross) {
      // One cell per surface, each holding that surface's whole rendering of
      // the idea. Reading across the row is the point.
      for (const key of SURFACE_ORDER) {
        const surface = SURFACES[key];
        const node = cell({
          label: surface.label,
          context: surface.context,
          width: surface.width,
          framed: surface.kind === 'frame'
        });
        const { host, ready } = mount(group.cross[key](), key, sheets);
        pending.push(ready);
        node.appendChild(host);
        rowEl.appendChild(node);
      }
    } else {
      // The overlay's own states: one cell per state, all in the overlay's
      // context.
      for (const [label, markup] of group.specimens) {
        const node = cell({ label });
        if (group.wide) node.classList.add('wide');
        const { host, ready } = mount(markup, 'overlay', sheets);
        pending.push(ready);
        node.appendChild(host);
        rowEl.appendChild(node);
      }
    }

    section.append(h, why, rowEl);
    gallery.appendChild(section);
  }

  // Frames size themselves after they load, so the page is not ready to be
  // screenshotted or measured until every one of them has.
  await Promise.all(pending);
  document.body.dataset.ready = 'true';
}

build();
