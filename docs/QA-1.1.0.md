# 1.1.0 browser acceptance pass

Run these before calling the extension release-ready.

## Environment
1. Open `https://staging.example.com` or a real staging host.
2. Confirm the environment reads `staging` with high confidence when the hostname is clear.
3. Confirm a staging `noindex` is absent from Frank's default feed.
4. Click **Show all checks** and confirm the noindex observation is still available.
5. Override the environment to **Production** and rescan. The same noindex must become a critical Frank finding.
6. Return Environment to **Auto**.

## Broken links
1. Test a page containing a known same-origin 404 link.
2. Confirm Frank surfaces the broken link by default.
3. Confirm Highlight points to the actual source anchor.
4. Ask Frank and verify the walkthrough shows the URL and HTTP status, gives a concrete correction path, and ends with verification guidance.
5. Confirm a normal 2xx link is not displayed.
6. Confirm a link timeout is REVIEW, not falsely reported as a confirmed 404.

## Target honesty
1. Ask Frank about a visual axe finding and confirm the actual element is spotlighted.
2. Ask Frank about a canonical, robots, title, schema, or noindex finding.
3. Confirm the page dims but Frank does not attempt a fake element spotlight.
4. Change/remove a previously scanned DOM element, then Ask Frank. Confirm the session falls back to page-level evidence instead of an empty spotlight.

## Noise
1. Use a page with a long title, missing meta description, Open Graph gaps, or minor/manual axe observations.
2. Confirm these do not dominate the default Frank feed.
3. Confirm they remain inspectable under **Show all checks**.

## Guidance
For at least one accessibility, SEO/indexing, broken-link, and implementation finding, confirm Frank provides:
- what was found,
- evidence,
- impact,
- specific remediation,
- a verification step.

Reject any walkthrough whose remediation is only generic wording.

## Connected tools
Expand Scan coverage and verify relevant services individually:
- Browser
- Links
- axe
- Meta State
- Performance Monitor
- Preflight
- WCAG Translator
- AI / deterministic mode

Connected evidence should be relevant to the selected finding, not an indiscriminate list of every service.

## Standalone
Run:
`npm run dev`

Then confirm:
- `http://localhost:3000/`
- `http://localhost:3000/api/health`
- `http://localhost:8790/health`

For actual public scans, Playwright Chromium must also be installed:
`npx playwright install chromium`
