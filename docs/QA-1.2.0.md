# Web QA Assistant 1.2.0 acceptance checklist

## Environment context
- Clear staging hostname is inferred as staging.
- Preview host is inferred as preview.
- localhost/private host is local.
- apex or www business domain is production.
- ambiguous public subdomain remains unknown unless overridden or strongly corroborated.
- environment override persists for the origin.
- staging noindex is quiet by default.
- production homepage/top-level noindex is blocker/high-priority.
- utility-page production noindex does not become a false blocker.
- same-site staging canonical is quiet.
- cross-site staging canonical remains reviewable.

## Broken links
- Local browser/axe findings render before link enrichment finishes.
- Healthy 2xx same-origin links create no finding.
- 404/410 creates a confirmed broken-link finding.
- production nav/header/CTA 404 is blocker priority.
- 5xx destination is critical.
- timeout remains quiet/unverified rather than being called broken.
- link text and location appear in Frank evidence.
- Highlight points to the source anchor.
- Ask Frank includes destination and status metrics, remediation and verification.

## Frank targeting
- visual axe/link finding spotlights the exact target.
- document findings do not attempt a visual spotlight.
- deleting/replacing a target after scan downgrades to page-level guidance.
- Next, Back, Escape and Exit remain synchronized.
- preview reset leaves no persistent page mutation.

## Materiality
- long title, missing description, minor/manual axe results do not dominate default Frank results.
- Show all checks reveals quiet observations.
- zero material findings produces a clear empty state.

## Lifecycle
- connected findings are not marked resolved during the local stage and new again after enrichment.
- second unchanged full scan shows known/no-change state.

## Connected services
- Meta State
- Performance Monitor
- Preflight
- WCAG Translator
- AI gateway
- deterministic fallback

Relevant tools should appear for the selected signal. Unrelated connected data should not be injected into Frank.

## Standalone
- `npm run dev`
- `http://localhost:3000/` loads
- `/api/health` returns 200
- renderer `/health` returns 200 and `chromiumAvailable:true`
- public scan works in the target deployment environment
- visual finding can generate a Frank spotlight snapshot
