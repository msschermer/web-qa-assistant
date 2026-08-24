# Installing Web QA Assistant 1.6.1

1. Build with `npm run build:extension` or unzip the packaged extension artifact.
2. Open `chrome://extensions`, enable Developer mode, and load `dist/extension` as an unpacked extension.
3. Confirm Connection Settings reports gateway version 1.6.1 after the backend deployment.
4. Run the real-browser acceptance checklist in `docs/QA-1.6.1.md`.

1.6.1 does not require new production environment variables beyond the existing 1.6.0 managed-access configuration.
