---
name: webqa-full-loop
description: Run the complete Web QA Assistant multi-role engineering workflow for a material feature or bug.
disable-model-invocation: true
---
# WebQA full revision loop

Use this for significant features, bugs, architecture changes, or systemic product-quality issues.

1. Inspect the current implementation and reproduce the issue when possible.
2. Diagnose root cause before editing.
3. Create an implementation plan.
4. Ask relevant read-only specialists to challenge the plan in parallel.
5. Resolve disagreements using runtime evidence, tests, source and standards.
6. If the plan is not acceptable, revise it before coding.
7. Implement as the parent/lead agent.
8. Run targeted tests, then full tests/check/build.
9. Run adversarial QA and appropriate browser acceptance.
10. Revise material failures and repeat tests.
11. Run product review and the independent release gate.
12. Report only what changed, verified evidence, review resolution, remaining risk and user intervention.
