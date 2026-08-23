# Web QA Assistant 1.2.1 acceptance checklist

## Immediate scan regression
1. Reload the unpacked extension from `dist/extension`.
2. Open a normal HTTPS site.
3. Click the toolbar action and confirm the first scan completes without `Assignment to constant variable`.
4. Click **Rescan** and confirm the same inspected tab is reused.

## Error UX
1. If an extension action fails, confirm the primary message is human-readable rather than raw JavaScript.
2. Confirm **Technical details** appears only when diagnostics are available.
3. Open it and confirm diagnostic ID, operation, version, and technical message are present.
4. Click **Copy diagnostics** and confirm the copied payload includes the diagnostic ID and technical message.

## Regression pass from 1.2.0
1. Confirm staging/preview/local/production inference still behaves as expected.
2. Confirm staging `noindex` remains quiet and production `noindex` is material when appropriate.
3. Confirm broken internal links are enriched after the fast local scan.
4. Confirm visual Frank findings highlight real elements.
5. Confirm document-level findings do not attempt a fake spotlight.
6. Confirm quiet observations remain available through **Show all checks**.
