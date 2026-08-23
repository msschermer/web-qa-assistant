# QA acceptance: Web QA Assistant 1.5.0

Automated gates must pass before manual acceptance starts:

```bash
npm run check          # 38 files, product invariants, dist freshness
npm test               # 91 tests
npm run build:extension
```

Do not merge `feature/final-product-pass` into `main` until every section below
passes in a real browser.

---

## 1. Install

- [ ] Load `dist/extension` unpacked at `chrome://extensions`
- [ ] Version reads **1.5.0**
- [ ] Service worker registers with no console error
- [ ] Side panel opens from the toolbar icon
- [ ] Permissions list shows only `activeTab`, `scripting`, `sidePanel`, `storage`

## 2. Known-answer regression (the reason this release exists)

On a page with a small icon rendered beside short visible text, where the text
already states what the icon means — a verification or trust badge is the typical
case. Any page with that pattern reproduces this.

- [ ] The image-alt finding appears
- [ ] **Ask Frank** opens with an interpretation step *before* remediation
- [ ] Interpretation quotes the adjacent text it relied on, e.g. *"reinforces the
      adjacent text '<badge label>'"*
- [ ] Remediation says `Set alt=""` directly
- [ ] Remediation does **not** offer "add alt text or use an empty alt"
- [ ] A **What I ruled out** step explains the rejected branch
- [ ] Evidence used includes `image-purpose: decorative` sourced from `browser`

Counter-case, to confirm the classifier is not simply always answering decorative:

- [ ] Find a content image (large, in main content, no adjacent caption)
- [ ] Frank does **not** recommend `alt=""`
- [ ] Find a logo that is the sole content of a link
- [ ] Frank recommends naming the destination, never an empty alt

## 3. Cross-discipline brief

On a page that has both a broken internal link and several axe findings.

- [ ] Brief reads across areas, e.g. *"N issues need attention across N areas"*
- [ ] The confirmed broken destination is named first
- [ ] The brief is not composed entirely of accessibility findings
- [ ] Impact ledger shows counts per area
- [ ] Clicking a ledger cell filters the feed; clicking again clears it
- [ ] Repeated instances of one rule appear as one card with an instance count
- [ ] Expanding that card lists every affected selector
- [ ] Two different broken destinations stay as two separate cards
- [ ] `N grouped from M findings` appears when grouping actually collapsed rows

## 4. Current-page performance

- [ ] Scan coverage shows a current-page performance row
- [ ] Coverage notes state the measurement is a lab observation
- [ ] On a deliberately slow page, an LCP or TTFB finding appears as **review**,
      not as a confirmed defect
- [ ] Frank never describes a browser measurement as a confirmed regression on
      its own
- [ ] On a monitored site, Performance Monitor history still appears separately

## 5. Broken links and discoverability keep standing

- [ ] A confirmed navigation 404 outranks isolated accessibility advisories
- [ ] A production `noindex` on a primary page appears as a blocker
- [ ] Unverified destinations stay in coverage and are not counted as broken
- [ ] `N of M checked destinations` wording appears when verification is incomplete

## 6. Frank overlay

- [ ] Overlay shows only mark, progress, one line, Back/Next
- [ ] Overlay does **not** repeat the side-panel remediation text
- [ ] Spotlight tracks the target element on scroll and resize
- [ ] Escape closes; focus returns to the invoking control
- [ ] Arrow keys move between steps
- [ ] Side panel and overlay stay in step sync

## 7. Visual acceptance

- [ ] Headings render in Plex Sans, not monospace
- [ ] Mono appears only on selectors, rule IDs, HTTP codes, scores
- [ ] Severity reads as a left-edge accent, not a top bar
- [ ] Cards have visible radii and soft shadow, not hairline boxes everywhere
- [ ] Keyboard focus is clearly visible on every control
- [ ] Panel is usable at 320px width
- [ ] Reduced-motion preference is respected

## 8. Defect verification

Integration health:

- [ ] Point `META_STATE_URL` at a host that returns 404 on `/api/health`
- [ ] Test connection reports **not-found**, not available
- [ ] Detail text advises checking the configured URL
- [ ] Restore the correct URL and confirm it returns to available

Gateway auth:

- [ ] With `ASSISTANT_ACCESS_TOKEN` set and no key saved, Test connection reports
      the gateway is reachable but protected
- [ ] With a wrong key, it reports the key was rejected
- [ ] With the correct key, it reports version, AI state and integration counts
- [ ] A rejected key renders as a warning, never as a healthy connection

## 9. Connected and disconnected behaviour

- [ ] With OpenAI configured, brief mode reads **Connected reasoning**
- [ ] With OpenAI unavailable, the deterministic brief is still composed across
      classes and Frank still produces an interpretation step
- [ ] On a private or local host, connected services stay disabled and coverage
      reads local-only
- [ ] Gateway outage degrades to standard guidance without an error state

## 10. Deployment

- [ ] `docker compose -f docker-compose.yml -f docker-compose.portfolio.yml up -d --build`
      succeeds on the droplet
- [ ] `docker network ls` shows the API attached to `portfolio-infra_web`
- [ ] Caddy reaches the gateway by service name
- [ ] `curl https://assistant.msschermer.us/api/health` reports 1.5.0
- [ ] Protected `/api/health/integrations` responds with the team key
- [ ] Base `docker-compose.yml` required no manual edit on the server
