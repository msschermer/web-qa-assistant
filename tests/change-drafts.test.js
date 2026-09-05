import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAFTABLE, BANNED_CLAIMS, DRAFT_RULES, draftableField, draftEnvelope, draftPrompt,
  validateChangeDraft, groundingTerms, draftableChanges
} from '../packages/findings/change-drafts.js';

const change = (over = {}) => ({
  id: 'C01', ruleId: 'seo.title-long', current: 'Example Business On Everything We Do And More For You Today',
  urls: ['https://example.com/criminal-defence-consultation'], ...over
});
const page = {
  title: 'Example Business On Everything We Do And More For You Today',
  h1_text: 'Criminal defence consultation',
  meta_description: 'Book a criminal defence consultation with Example Business.',
  word_count: 900
};
const envelopeFor = (over = {}, siblings = []) => draftEnvelope(change(over), page, siblings);

test('a rule is draftable only when the fix is one specific string', () => {
  // "Fix the heading outline" is real work, but it is not a value someone
  // types once, so it must not offer a draft.
  assert.equal(draftableField('seo.title-long')?.field, 'title');
  assert.equal(draftableField('seo.duplicate-title')?.field, 'title');
  assert.equal(draftableField('seo.description-missing')?.field, 'description');
  assert.equal(draftableField('structure.duplicate-h1')?.field, 'h1');
  assert.equal(draftableField('content.generic-link-text')?.field, 'anchorText');
  for (const notDraftable of ['structure.heading-skip', 'navigation.link-404', 'security.hsts-missing',
    'structure.image-alt-missing', 'schema.invalid-json', 'performance.lcp-slow']) {
    assert.equal(draftableField(notDraftable), null, `${notDraftable} has no single replacement value`);
  }
  // Every spec has to state the bounds the validator enforces, or the model is
  // being asked for something nobody checks.
  for (const spec of DRAFTABLE) {
    assert.ok(spec.min > 0 && spec.max > spec.min, `${spec.field} needs a length range`);
    assert.ok(spec.ideal >= spec.min && spec.ideal <= spec.max);
    assert.ok(spec.guide.length > 40, `${spec.field} needs a usable instruction`);
  }
});

test('the envelope carries what the page says and what the draft must differ from', () => {
  const envelope = envelopeFor({}, ['Another Page Title', 'Example Business On Everything We Do And More For You Today']);
  assert.equal(envelope.field, 'title');
  assert.equal(envelope.page.h1, 'Criminal defence consultation');
  assert.match(envelope.page.slug, /criminal defence consultation/);
  // The current value is never repeated back as a sibling: it is already
  // stated once, and listing it twice would let a draft "differ from siblings"
  // while repeating what it replaces.
  assert.deepEqual(envelope.siblings, ['Another Page Title']);
  // Without siblings a duplication cannot be fixed, so they are first-class.
  assert.deepEqual(envelopeFor({ ruleId: 'seo.duplicate-title' }, ['Shared Title', 'Shared Title']).siblings, ['Shared Title']);
  assert.equal(draftEnvelope({ ruleId: 'navigation.link-404' }, page), null);
});

test('the prompt states every rule the validator will enforce', () => {
  // A constraint the model is not told about is a rejection it cannot avoid,
  // and a constraint nobody checks is a promise the product never verifies.
  const prompt = draftPrompt(envelopeFor());
  for (const rule of DRAFT_RULES) assert.ok(prompt.system.includes(rule));
  assert.match(prompt.user, /between 30 and 65 characters/);
  assert.match(prompt.user, /Criminal defence consultation/);
  assert.match(prompt.user, /"draft"/);
});

test('a good draft is accepted, and quotes around it are not held against it', () => {
  const envelope = envelopeFor();
  const good = validateChangeDraft({ draft: 'Criminal Defence Consultation | Example Business' }, envelope);
  assert.equal(good.ok, true, good.message);
  // Models wrap a lone value in quotes about half the time. Rejecting a good
  // draft over a punctuation habit is not rigour.
  const quoted = validateChangeDraft({ draft: '"Criminal Defence Consultation | Example Business"' }, envelope);
  assert.equal(quoted.ok, true);
  assert.equal(quoted.draft, 'Criminal Defence Consultation | Example Business');
  // A bare string is accepted as readily as the object form.
  assert.equal(validateChangeDraft('Criminal Defence Consultation | Example Business', envelope).ok, true);
});

test('an invented draft is refused, which is the whole point', () => {
  // The failure that would reach a client: a title that reads perfectly and
  // names a city, a service or a credential the page never mentions.
  const envelope = envelopeFor();
  const invented = validateChangeDraft({ draft: 'Immigration Visa Appeals in Manchester | Fast Response' }, envelope);
  assert.equal(invented.ok, false);
  assert.equal(invented.code, 'DRAFT_UNGROUNDED');
  // And a claim nothing in an audit can support never reaches markup.
  for (const claim of ['Best Criminal Defence Consultation Lawyers', 'Award-Winning Criminal Defence Consultation']) {
    const verdict = validateChangeDraft({ draft: claim }, envelope);
    assert.equal(verdict.ok, false, claim);
    assert.equal(verdict.code, 'DRAFT_CLAIM');
  }
  for (const phrase of BANNED_CLAIMS) assert.equal(typeof phrase, 'string');
});

test('a draft that would not fix the finding is refused', () => {
  const envelope = envelopeFor({}, ['Criminal Defence Consultation | Example Business']);
  // Repeating the value it replaces.
  assert.equal(validateChangeDraft({ draft: page.title }, envelope).code, 'DRAFT_UNCHANGED');
  // Matching a sibling, which is the duplication being fixed.
  assert.equal(validateChangeDraft({ draft: 'Criminal Defence Consultation | Example Business' }, envelope).code, 'DRAFT_DUPLICATE');
  // Outside the length the search result will honour.
  assert.equal(validateChangeDraft({ draft: 'Criminal defence' }, envelope).code, 'DRAFT_SHORT');
  assert.equal(validateChangeDraft({ draft: 'Criminal Defence Consultation Services And Advice From Example Business Across The Whole Region' }, envelope).code, 'DRAFT_LONG');
});

test('nothing that belongs in a document reaches a markup field', () => {
  const envelope = envelopeFor();
  const cases = [
    ['Criminal Defence Consultation <b>now</b> at Example', 'DRAFT_MARKUP'],
    ['Criminal Defence Consultation at https://example.com', 'DRAFT_URL'],
    ['Criminal Defence Consultation\nExample Business here', 'DRAFT_MULTILINE'],
    ['**Criminal** Defence Consultation Example Business', 'DRAFT_MARKDOWN'],
    ['', 'DRAFT_EMPTY']
  ];
  for (const [draft, code] of cases) {
    assert.equal(validateChangeDraft({ draft }, envelope).code, code, draft || '(empty)');
  }
});

test('link text is grounded more loosely, because there is less of it', () => {
  // Eight words cannot be asked to echo two of the page's terms and still read
  // like link text, so the requirement is one. The check still bites.
  const envelope = draftEnvelope(
    change({ id: 'C09', ruleId: 'content.generic-link-text', current: 'click here' }), page
  );
  assert.equal(validateChangeDraft({ draft: 'Book a criminal defence consultation' }, envelope).ok, true);
  assert.equal(validateChangeDraft({ draft: 'Download our pricing brochure' }, envelope).code, 'DRAFT_UNGROUNDED');
});

test('grounding uses the page and nothing else', () => {
  const terms = groundingTerms(envelopeFor());
  assert.ok(terms.has('criminal') && terms.has('defence') && terms.has('consultation'));
  // Short and structural words carry no subject, so they cannot ground a draft.
  for (const empty of ['this', 'page', 'html', 'com', 'www']) assert.ok(!terms.has(empty), empty);
  // A page the crawl read nothing from cannot ground anything, and the check
  // stands down rather than rejecting every draft.
  const blind = draftEnvelope(change({ urls: ['https://example.com/'] }), {});
  assert.equal(groundingTerms(blind).size, 0);
  assert.equal(validateChangeDraft({ draft: 'A perfectly ordinary replacement title here' }, blind).ok, true);
});

test('a plan reports which of its changes can be drafted', () => {
  const plan = { priorities: [{ actions: [{ changes: [
    { id: 'C01', ruleId: 'seo.title-long' },
    { id: 'C02', ruleId: 'navigation.link-404' },
    { id: 'C03', ruleId: 'seo.description-missing' }
  ] }] }] };
  assert.deepEqual(draftableChanges(plan), ['C01', 'C03']);
  assert.deepEqual(draftableChanges(null), []);
});
