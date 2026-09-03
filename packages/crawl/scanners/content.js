/**
 * Content-quality discipline: thin content (word count below a threshold)
 * and generic link text. Both are per-page checks on already-collected
 * data, not a cross-page comparison — neither needs to see other pages.
 */
import { STATIC_EVIDENCE_NOTE } from './shared.js';

const THIN_CONTENT_WORD_THRESHOLD = 150;

// Anchor text that gives a screen-reader user tabbing through links, or a
// search engine reading link text out of context, no idea where the link
// actually leads. This is a directly measured string comparison, not a
// judgment call about content quality, so it's 'confirmed'.
const GENERIC_LINK_TEXT = new Set(['click here', 'here', 'read more', 'more', 'learn more', 'this page', 'link', 'click', 'more info', 'details', 'continue reading', 'more details']);

function perPage(meta, pageUrl) {
  const out = [];
  const words = Number(meta.wordCount || 0);
  if (meta.wordCount != null && words > 0 && words < THIN_CONTENT_WORD_THRESHOLD) {
    out.push({ ruleId: 'seo.thin-content', title: 'Page has very little text content', detail: `Only ${words} word${words === 1 ? '' : 's'} were found in the static HTML for ${pageUrl} (threshold: ${THIN_CONTENT_WORD_THRESHOLD}). ${STATIC_EVIDENCE_NOTE} Thin pages are less likely to rank and can read as low-value to visitors.`, category: 'review', severity: 'low', confidence: 'inferred', count: words });
  }

  const links = Array.isArray(meta.links) ? meta.links : [];
  const genericCount = links.filter((l) => GENERIC_LINK_TEXT.has(String(l?.text || '').trim().toLowerCase())).length;
  if (genericCount > 0) {
    out.push({ ruleId: 'content.generic-link-text', title: 'Link text does not describe its destination', detail: `${genericCount} link${genericCount === 1 ? '' : 's'} on ${pageUrl} use generic text like "click here" or "read more", which gives no context about where the link leads when read out of context (e.g. by a screen reader's links list or a search result).`, category: 'review', severity: 'low', confidence: 'confirmed', count: genericCount, wcag: ['2.4.4'] });
  }

  return out;
}

export default { id: 'content', perPage };
