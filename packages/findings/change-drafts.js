/**
 * Drafting the replacement text a change asks for.
 *
 * This is the one job in Lumen worth a language model. Everything else it was
 * being asked to do was rewriting sentences the product had already written:
 * safe, cheap, and invisible to whoever received the audit. Meanwhile the
 * Action Plan's most valuable column, "Change it to", held a generic
 * instruction ("Give each page a unique, specific title") and the consultant
 * wrote the actual sixty characters by hand, once per page, for every page.
 *
 * So the model drafts the string. Not the finding, not the priority, not the
 * scope, not whether there is a problem at all: those are decided from evidence
 * before anything is asked. It writes a candidate title, description, heading
 * or link text, and the draft is checked before anyone sees it.
 *
 * ## Why this is checkable, and the rewriting was not
 *
 * A rewritten sentence can only be judged by reading it. A drafted title has
 * mechanical properties: it has a length the search result will honour, it must
 * differ from the value it replaces, it must differ from every sibling page's
 * value or it has not fixed the duplication, and it must be *grounded* in what
 * the page itself already says. That last check is the important one. A model
 * asked to write a title for a page it cannot see will invent a plausible
 * service, city or credential, and a plausible invented credential in a client's
 * title tag is the single most expensive thing this product could produce.
 * Grounding requires the draft to reuse the page's own vocabulary.
 *
 * ## What is sent, which is more than anywhere else in Lumen
 *
 * The brief envelope carries no URL, host or page text by construction. This
 * one cannot: drafting a title for a page means sending what the page is about.
 * The envelope carries the URL slug, the current title, description and H1, and
 * the sibling values a draft has to differ from. That is a real step up in what
 * leaves the machine, it is why drafting is an explicit per-change action rather
 * than something that runs on its own, and the interface says so at the point of
 * use rather than in a settings screen nobody opens.
 *
 * Nothing here writes to the site. A draft is a proposal that lands in a
 * spreadsheet column for a human to accept, edit or ignore.
 */

/**
 * The fields a change can carry a drafted value for.
 *
 * A rule earns a place here only when the fix is a specific string a person
 * would otherwise type. "Fix the heading outline" is real work but it is not one
 * value, so it is absent rather than guessed at. First match wins.
 */
export const DRAFTABLE = [
  {
    field: 'title', match: /^seo\.(title|duplicate-title)/,
    label: 'Page title', element: 'the <title> tag',
    min: 30, max: 65, ideal: 55,
    guide: 'A page title of about 55 characters. Lead with what this page is about, then the business name after a separator.'
  },
  {
    field: 'description', match: /^seo\.description/,
    label: 'Meta description', element: 'the meta description',
    min: 110, max: 158, ideal: 150,
    guide: 'A meta description of 120 to 155 characters that says what the page covers and gives a reason to open it. One or two sentences.'
  },
  {
    field: 'h1', match: /^structure\.(duplicate-h1|h1-)/,
    label: 'Page heading', element: 'the page H1',
    min: 15, max: 80, ideal: 45,
    guide: 'A single page heading that describes only this page. Shorter than the title and written for a reader, not for a search engine.'
  },
  {
    field: 'anchorText', match: /^content\.generic-link-text/,
    label: 'Link text', element: 'the link anchor text',
    min: 8, max: 60, ideal: 30,
    guide: 'Link text that describes the destination when read on its own, out of the surrounding sentence. Two to eight words, no trailing punctuation.'
  }
];

export function draftableField(ruleId) {
  const id = String(ruleId || '');
  return DRAFTABLE.find((spec) => spec.match.test(id)) || null;
}

/** Words a draft may be built from. Short words and the site's own stop-list
 * carry no subject, so they cannot satisfy the grounding requirement. */
const STOP = new Set(['this', 'that', 'with', 'from', 'your', 'their', 'they', 'have', 'been', 'were', 'will',
  'what', 'when', 'where', 'which', 'about', 'into', 'more', 'than', 'then', 'them', 'here', 'there', 'page',
  'home', 'index', 'html', 'https', 'http', 'www', 'com', 'org', 'net']);

function words(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

/**
 * The page's own vocabulary.
 *
 * Drawn from the URL slug, the current title, the current description and the
 * H1, because those are what the crawl records. A draft that shares none of
 * these words is describing a page it was not shown.
 */
export function groundingTerms(envelope) {
  const page = envelope?.page || {};
  return new Set([
    ...words(page.slug),
    ...words(page.title),
    ...words(page.h1),
    ...words(page.description)
  ]);
}

/**
 * Claims a QA tool has no business putting in a client's markup.
 *
 * Every one of these is unverifiable from a crawl, and several are regulated
 * in the professions this product is most used on. A model reaches for them
 * because they read like good marketing copy.
 */
export const BANNED_CLAIMS = ['best', 'number one', '#1', 'leading', 'premier', 'top-rated', 'top rated',
  'award-winning', 'award winning', 'world-class', 'world class', 'guaranteed', 'cheapest', 'lowest price',
  'most trusted', 'unrivalled', 'unrivaled', 'unbeatable', 'no. 1', 'voted'];

/**
 * The instruction the model is held to.
 *
 * Data rather than prose at a call site, for the same reason the brief's rules
 * are: every constraint stated here has a check in `validateChangeDraft`, and a
 * constraint that cannot be checked does not belong here.
 */
export const DRAFT_RULES = [
  'Write one replacement value and nothing else. No explanation, no options, no quotation marks around it.',
  'Use only the subject matter shown to you. Never introduce a service, location, credential, price, award or claim that does not appear in the page facts you were given.',
  'Reuse the page\'s own vocabulary. A draft that shares no significant word with the page is describing a different page.',
  'Stay inside the length range you are given, counted in characters.',
  'The draft must differ from the current value, and from every other value listed under siblings.',
  'Never write a superlative or an unverifiable claim such as best, leading, premier, award-winning or guaranteed.',
  'No URLs, no HTML, no markdown, no line breaks, no emoji.'
];

/**
 * What the model is shown for one change.
 *
 * `siblings` are the values other pages carry for the same field, which is what
 * makes a duplication fixable: without them a model has no way to know what it
 * has to differ from.
 */
export function draftEnvelope(change, page = {}, siblings = []) {
  const spec = draftableField(change?.ruleId);
  if (!spec) return null;
  let slug = '';
  try { slug = new URL(change.urls?.[0] || '').pathname.replace(/[/_-]+/g, ' ').trim(); }
  catch { slug = ''; }
  const current = String(change?.current || '').trim();
  const unique = [...new Set(siblings.map((s) => String(s || '').trim()).filter(Boolean))]
    .filter((s) => s !== current)
    .slice(0, 12);
  return {
    id: String(change?.id || ''),
    field: spec.field,
    label: spec.label,
    element: spec.element,
    guide: spec.guide,
    length: { min: spec.min, max: spec.max, ideal: spec.ideal },
    current,
    page: {
      slug,
      title: String(page.title || '').trim(),
      h1: String(page.h1_text || '').trim(),
      description: String(page.meta_description || '').trim(),
      words: Number(page.word_count || 0)
    },
    siblings: unique
  };
}

export function draftPrompt(envelope) {
  return {
    system: [
      'You write one replacement value for a web page, for a QA report a consultant will hand to a client.',
      'The problem has already been diagnosed. You are not deciding whether anything is wrong.',
      ...DRAFT_RULES
    ].join('\n'),
    user: [
      `Write ${envelope.element}.`,
      envelope.guide,
      `Length: between ${envelope.length.min} and ${envelope.length.max} characters, ideally about ${envelope.length.ideal}.`,
      '',
      'Page facts:',
      JSON.stringify(envelope.page),
      '',
      `Current value: ${envelope.current || '(none)'}`,
      envelope.siblings.length ? `Must also differ from: ${JSON.stringify(envelope.siblings)}` : '',
      '',
      'Reply with JSON: {"draft": "..."}'
    ].filter(Boolean).join('\n')
  };
}

const reject = (code, message) => ({ ok: false, code, message });

/**
 * Is this draft safe to show a consultant?
 *
 * Rejection is cheap and a bad draft is not. Everything checked here is a
 * property of the string against evidence already in hand, so no judgement is
 * being deferred to the reader.
 */
export function validateChangeDraft(candidate, envelope) {
  if (!envelope) return reject('DRAFT_NO_ENVELOPE', 'There is nothing to draft against.');
  const raw = typeof candidate === 'string' ? candidate : candidate?.draft;
  let draft = String(raw ?? '').trim();
  if (!draft) return reject('DRAFT_EMPTY', 'The model returned no draft.');

  // Models wrap a single value in quotes roughly half the time. Unwrapping one
  // matched pair is not leniency about content, it is not rejecting a good
  // draft over a punctuation habit.
  const unwrapped = draft.replace(/^["“']([\s\S]*)["”']$/, '$1').trim();
  if (unwrapped) draft = unwrapped;

  if (/[\r\n]/.test(draft)) return reject('DRAFT_MULTILINE', 'A single value cannot span lines.');
  if (/<[^>]+>/.test(draft)) return reject('DRAFT_MARKUP', 'The draft contains markup.');
  if (/https?:\/\/|www\./i.test(draft)) return reject('DRAFT_URL', 'The draft contains a URL.');
  if (/[*_`#]{1,}\w|\]\(/.test(draft)) return reject('DRAFT_MARKDOWN', 'The draft contains markdown.');

  const { min, max } = envelope.length;
  if (draft.length < min) return reject('DRAFT_SHORT', `${draft.length} characters, and ${envelope.label.toLowerCase()} needs at least ${min}.`);
  if (draft.length > max) return reject('DRAFT_LONG', `${draft.length} characters, and ${envelope.label.toLowerCase()} allows at most ${max}.`);

  const same = (a, b) => a.replace(/\s+/g, ' ').toLowerCase() === b.replace(/\s+/g, ' ').toLowerCase();
  if (envelope.current && same(draft, envelope.current)) {
    return reject('DRAFT_UNCHANGED', 'The draft repeats the value it is meant to replace.');
  }
  for (const sibling of envelope.siblings || []) {
    if (same(draft, sibling)) return reject('DRAFT_DUPLICATE', 'The draft matches another page, which is the problem being fixed.');
  }

  const lower = draft.toLowerCase();
  const claim = BANNED_CLAIMS.find((phrase) => lower.includes(phrase));
  if (claim) return reject('DRAFT_CLAIM', `The draft claims "${claim}", which nothing in the audit can support.`);

  // Grounding. The check that stops a confident invention reaching a client's
  // markup: a title for a page the model could not see will name a service or a
  // city the page never mentions, and it will read perfectly well.
  const terms = groundingTerms(envelope);
  if (terms.size) {
    const used = words(draft).filter((w) => terms.has(w));
    const needed = envelope.field === 'anchorText' ? 1 : 2;
    if (used.length < needed) {
      return reject('DRAFT_UNGROUNDED', 'The draft does not use the words this page uses, so it may be describing a page the model could not see.');
    }
  }

  return { ok: true, code: '', message: '', draft };
}

/** Which changes in a plan can be drafted, so the interface can offer it once
 * rather than testing every row twice. */
export function draftableChanges(plan) {
  const out = [];
  for (const priority of plan?.priorities || []) {
    for (const action of priority.actions || []) {
      for (const change of action.changes || []) {
        if (draftableField(change.ruleId)) out.push(change.id);
      }
    }
  }
  return out;
}
