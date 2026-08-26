# Test contract inventory (v1.7.5 development)

Compact inventory of major evidence families. Status: **Y** = present, **P** = partial, **N** = gap.

| Family | Positive | Negative/clean | Correlation | Frank | Privacy/sanitization |
|--------|----------|----------------|-------------|-------|----------------------|
| Target integrity / blocked | Y | Y | P | Y | Y |
| Axe / a11y core | Y | Y | P | Y | Y |
| Links / probes | Y | Y | P | Y | Y |
| Browser lab performance | Y | P | P | Y | Y |
| Historical perf monitor | P | P | N | P | Y |
| Runtime / page errors | Y | P | P | Y | Y |
| Resource failures / ownership | Y | Y | P | Y | Y |
| Disclosure interactions | Y | Y | Y | Y | Y |
| Menu toggles | Y | Y | N | Y | Y |
| Skip-link | Y | P | N | Y | Y |
| Same-origin iframe | Y | Y | P | Y | Y |
| Cross-origin embed coverage | Y | Y | N | P | Y |
| Report Bug timeline | Y | Y | — | — | Y |
| buildRevision provenance | Y | Y | — | — | Y |
| Interaction accounting | Y | Y | — | — | Y |
| Coverage UI / reasons | P | P | — | P | Y |

## Dangerous holes (do not ignore)

1. Historical monitor vs lab — still easy to misread in UI if connector copy regresses.
2. Menu/item activation — only toggle tested; no correlation with embed failures yet.
3. Skip-link history — jsdom/history edge cases; needs human Chrome confirmation on real sites.
4. Side-effect honesty — documented limitation; no network interception proof tests.
5. PSL — bounded multi-part list, not full Public Suffix List.

Do not chase raw test count. Prefer contracts that catch false confidence.
