# Verification report

Verified in the managed workspace using Node 22-compatible tooling and installed Linux Chromium. This report describes automated execution; no physical Samsung was used.

- TypeScript checks: passed (`npm run typecheck`, also included in the production build).
- Production build: passed (`npm run build`).
- 38 automated tests: passed. These include 18 payment/money/date/recurrence/backup validation tests, 11 sync recovery/restore/future-occurrence tests, and 9 PostgreSQL migration/authorization tests using PGlite.
- 6 production browser tests: passed across 412 × 915 and 1440 × 900 viewports. They cover create/edit/reload persistence, paid/unpaid transitions, attachment caching, deletion, overflow checks, first-visit service-worker caching, offline reload/editing, backup download, import preview, and merge restore.

PostgreSQL tests execute the real migration with small auth and storage test schemas. They prove account-level record policies, file ownership policies, write-function authorization, duplicate-mutation safety, version conflicts, paid-date validation, receipt replacement safety, and protected type deletion. Actual Supabase authentication HTTP flows and object-storage transfer are not exercised by these tests. Sync-engine tests use mocked network failures; they verify queue retention and retry behavior, rather than claiming live device synchronization.

The separate Supabase CLI database job is configured in GitHub Actions; it was not run locally because a full Supabase local stack was not provisioned. GitHub Actions is configured to run on pushes and pull requests. Local results below do not establish hosted CI success; inspect the repository Actions tab for the latest outcome.

Still requires account setup and live verification:

- Verified registration, email confirmation, password recovery and production SMTP delivery.
- Browser ↔ installed Galaxy synchronization through an actual Supabase project.
- Real receipt upload progress, interruption/retry, cross-device access and scheduled cleanup.
- Physical Galaxy S26 Ultra installation, standalone behavior and accessibility with Samsung/Android assistive technologies.
- Public HTTPS hosting is available at https://chic-chaja-7faadb.netlify.app through the user's Netlify deployment. The user supplied a signed-in desktop PWA screenshot showing Saved; physical-phone and live cross-device behavior remain unverified.

See README.md for setup, costs/limits, the full live acceptance checklist, and backup/synchronization behavior. A fresh checkout runs in a clearly labeled local preview until public Supabase configuration is supplied and the app rebuilt. The current Netlify deployment was built with that configuration.
