/**
 * The one mapping from rule id to discipline.
 *
 * Order is load-bearing, first match wins: `a11y.lang-*` is an International
 * fact before it is an accessibility one, `web.meta-refresh` is an
 * indexability fact, and `quality` is last because it is the catch-all. Every
 * finding lands in exactly one discipline — a taxonomy with holes would
 * quietly drop rows out of the report.
 *
 * Shared rather than copied. The Site Audit overlay groups findings by
 * discipline and so does the exported client report; while each kept its own
 * taxonomy they disagreed about what a finding *was* — the overlay called a
 * broken link an availability failure and the report filed it under "SEO".
 * A consultant cannot show a client a document that contradicts the screen
 * they were just shown.
 *
 * Patterns are strings rather than RegExp literals so this list can be
 * injected verbatim into the content script at build time, the same way the
 * palette is. `disciplineOf()` compiles them once.
 */

export const DISCIPLINE_RULES = [
  ['availability', ['^navigation\\.link-', '^runtime\\.(resource-failed|resource-status|visible-error)', '^navigation\\.(fragment-missing|skip-link-target-missing)', '^ux\\.(inert-link|form-no-submit|controls-target-missing|disclosure-target-missing|disclosure-toggle-failed|menu-toggle-failed|interaction-restoration-unproven)']],
  ['duplicates', ['^seo\\.duplicate-', '^structure\\.duplicate-h1']],
  ['sitemaps', ['^seo\\.sitemap-']],
  ['international', ['^seo\\.hreflang-', '^a11y\\.lang-']],
  ['indexability', ['^seo\\.(canonical|noindex|robots|soft-404)', '^structure\\.orphan-page', '^navigation\\.redirect-chain-long', '^web\\.meta-refresh']],
  ['security', ['^security\\.']],
  ['performance', ['^performance\\.']],
  ['accessibility', ['^(axe|a11y)\\.']],
  ['content', ['^seo\\.(title|description|thin-content)', '^structure\\.(h1-|heading-skip|image-alt-missing)', '^content\\.', '^social\\.']],
  ['quality', ['.']]
];

/** The reading order of the disciplines: what is broken, then what is
 * unreachable, then what is weak. Availability leads because a confirmed
 * functional failure outranks an optimisation warning; no discipline is
 * promoted or demoted for being easy to detect. */
export const DISCIPLINE_ORDER = [
  'availability', 'indexability', 'content', 'duplicates', 'sitemaps',
  'security', 'accessibility', 'performance', 'international', 'quality'
];

export const DISCIPLINE_LABEL = {
  availability: 'Availability',
  indexability: 'Indexability',
  content: 'Content',
  duplicates: 'Duplicates',
  sitemaps: 'Sitemaps',
  security: 'Security',
  international: 'International',
  quality: 'Web quality',
  performance: 'Performance',
  accessibility: 'Accessibility'
};

const COMPILED = DISCIPLINE_RULES.map(([discipline, patterns]) => [discipline, patterns.map((p) => new RegExp(p))]);

export function disciplineOf(ruleId) {
  const id = String(ruleId || '');
  for (const [discipline, patterns] of COMPILED) {
    if (patterns.some((re) => re.test(id))) return discipline;
  }
  return 'quality';
}

export function disciplineLabel(discipline) {
  return DISCIPLINE_LABEL[discipline] || 'Web quality';
}
