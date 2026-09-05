# QA strategy

Lumen is tested against outcomes, not merely whether rules execute.

The primary trust question for every detector is:

```text
What proves this?
Could it be a false positive?
What confidence can we claim?
Is there a legitimate exception?
Is it material?
Can Frank recommend a safe action and verify the result?
```

The live acceptance gate is `docs/RELEASE-CHECKLIST.md`. `docs/QA-1.7.0.md` and
`docs/FINAL-REVIEW-1.7.0.md` are kept as the recorded worked example of what a
multi-role, adversarial, security and product review gate looked like when one
was run in full; they are history, not the current list.
