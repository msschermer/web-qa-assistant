# Test contract inventory (v1.7.5 development)

Compact inventory of major evidence families. Status: **Y** = present, **P** = partial, **N** = gap.

| Family | Positive | Negative/clean | Correlation | Frank | Privacy | UI/card |
|--------|----------|----------------|-------------|-------|---------|---------|
| Target integrity / blocked | Y | Y | P | Y | Y | P |
| Axe / a11y core | Y | Y | P | Y | Y | Y |
| Links / probes | Y | Y | P | Y | Y | Y |
| Browser lab performance | Y | Y | Y | Y | Y | Y |
| Image delivery (DPR/srcset) | Y | Y | Y | Y | Y | Y |
| LCP oversized promotion | Y | Y | Y | Y | Y | Y |
| Historical perf monitor | P | P | N | P | Y | Y |
| Runtime / page errors | Y | P | P | Y | Y | P |
| Resource failures / ownership | Y | Y | P | Y | Y | P |
| Disclosure interactions | Y | Y | Y | Y | Y | Y |
| Menu toggles | Y | Y | N | Y | Y | P |
| Skip-link | Y | P | N | Y | Y | P |
| Same-origin iframe | Y | Y | P | Y | Y | P |
| Cross-origin embed coverage | Y | Y | N | P | Y | P |
| Report Bug timeline | Y | Y | — | — | Y | — |
| buildRevision provenance | Y | Y | — | — | Y | Y |
| BuildRevision hydration | Y | Y | — | — | Y | Y |
| Interaction accounting | Y | Y | — | — | Y | — |
| Coverage UI / reasons | Y | P | — | P | Y | Y |
| CLS (aggregate only) | Y | Y | N | Y | Y | Y |

## Dangerous holes (do not ignore)

1. Historical monitor vs lab — still easy to misread in UI if connector copy regresses.
2. Menu/item activation — only toggle tested; no correlation with embed failures yet.
3. Skip-link history — jsdom/history edge cases; needs human Chrome confirmation on real sites.
4. Side-effect honesty — documented limitation; no network interception proof tests.
5. PSL — bounded multi-part list, not full Public Suffix List.
6. CLS — aggregate lab value only; no contributor attribution without native shift-target evidence.
7. Image delivery — browser zoom / unusual DPR edge cases; human Chrome dogfood still required.
8. Highlight occurrence cycling — grouping covered in unit tests; needs human Chrome confirmation on multi-image pages.

Do not chase raw test count. Prefer contracts that catch false confidence.
