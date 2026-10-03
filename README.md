# DueTrack

A mobile-first React + TypeScript payment tracker, designed for a shared Supabase account across browser and installed PWA. No privileged keys are included. The live app is hosted at https://chic-chaja-7faadb.netlify.app with a configured Supabase backend. A new checkout requires your public Supabase configuration before building; without it, the app offers a clearly labeled device-local preview with no cloud synchronization.

## Quick start

Node 22+:

```sh
npm ci
cp .env.example .env
# Set your Supabase project URL and public publishable/anon key
npm run dev
npm run typecheck
npm test
npm run build
```

Only `VITE_SUPABASE_URL` and the public `VITE_SUPABASE_ANON_KEY` go into the frontend. Never put a service-role key in any `VITE_` variable. Environment values are compiled into the build; setting hosting variables after a static build does not configure that build.

## Enable the cloud backend (your account access required)

1. Create a Supabase project in your own account. Record its project URL and public publishable/anon key under Project Settings / API. Set the two values in `.env` or your host's build environment.
2. For a new project, apply `supabase/migrations/001_duetrack.sql` and then `supabase/migrations/002_cash_and_income.sql` in the SQL editor, or use the Supabase CLI: `supabase login`, `supabase link --project-ref YOUR_PROJECT_REF`, `supabase db push`. The migration creates records, ownership policies, the atomic sync RPC, and a private 10 MB receipts bucket. Don't rerun applied migrations; add new migrations for changes.
3. Enable email/password authentication. Keep email verification enabled. Under Authentication / URL Configuration, set Site URL to your final HTTPS origin and allow that origin as a redirect URL for recovery and verification. Add localhost only for development.
4. Configure a production SMTP provider for reliable confirmation and recovery email. Supabase's built-in mail service has restrictive limits and is intended for trials. Check your plan's current rates.
5. Realtime is enabled for the records table by the migration. The app also refreshes every 15 seconds while visible, on reconnect, and on returning to the foreground. Realtime is an additional refresh trigger.
6. Deploy the receipt cleanup Edge Function: `supabase functions deploy receipt-cleanup --no-verify-jwt`. Set a strong `CLEANUP_SECRET` via Supabase function secrets. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied by the Supabase function environment; keep them server-only. Schedule a daily authenticated POST to the function with `Authorization: Bearer YOUR_CLEANUP_SECRET` using Supabase Cron + Vault/pg_net or your scheduler. Never store this secret in Git. The handler independently checks the secret. Cleanup removes unreferenced uploads older than 24 hours, including failed uploads and replaced/deleted receipts. Without this scheduled job, abandoned files are retained. Verify a successful run in function logs without logging file contents.
7. Register two test accounts and complete the live acceptance checklist below before relying on the app for important records.

## HTTPS deployment

The app builds to `dist/`. Deploy it on Sites, Cloudflare Pages, Netlify, Vercel, or any HTTPS static host. For Cloudflare Pages: connect the `duetrack` repository, choose build command `npm run build`, output directory `dist`, Node 22, and set the two public build environment variables. Configure SPA fallback to `index.html` if the host needs it. The app uses a single route, including auth redirects.

The current Netlify production site is connected to `alharthi2602/duetrack`, branch `main`, with automatic publishing. Commits to main trigger `npm run build` and publish `dist/`, using the public Supabase variables configured in Netlify. Database migrations are separate: a frontend deployment does not apply SQL in Supabase. Generated builds and local hosting metadata are excluded from Git.

Prefer your own stable HTTPS origin for production. Set the Supabase auth redirect URLs to that exact origin. CSP can be tightened at your hosting layer: allow your Supabase project for API/WebSocket connections, `blob:` for receipt views, and only your own assets. No third-party analytics or payment data logging is included.

## Cash and income update (existing production project)

1. Export a backup and wait for **Saved** on each device.
2. In the existing Supabase project SQL Editor, run **only** `supabase/migrations/002_cash_and_income.sql`. Do not rerun `001`. The migration preserves current records, extends the existing owner/version/mutation protections, and defaults existing types to Expense. It runs in a transaction. It is also safe to rerun `002` if needed.
3. Verify with `select public.duetrack_capabilities();` while signed in through the app, or inspect the function in the dashboard. The app checks capabilities when online and shows **Backend update required** until the migration is available. New Income choices stay disabled beforehand. This prevents unsavable cash records being added to the local queue.
4. Confirm the new main commit has **Published** status in Netlify. Close all installed app windows and browser tabs for DueTrack, then reopen online to adopt the update. Pending local data is retained across an app update.
5. Create a cash account with its actual bank balance, currency, and balance date. For example, AED 1,000,000 already received is the opening balance. Earlier transactions are already included; do not re-enter them. After creating entries, the opening date/balance/currency are fixed. Use dated Adjustment entries to reconcile differences.
6. Create an **Income** payment type for each rental asset, and add its expected rent installments using the regular payment form. Received rent requires a received date and can retain its receipt. Existing mortgage types remain Expense. Direction is fixed while payment records exist.
7. Add bank movements manually in **Cash ledger**: rent receipts, mortgage payments, service charges, maintenance, savings profit, adjustments or other income/expenses. Paid/Received changes never create cash entries automatically. Enter each actual movement once. Entries dated after the selected balance date do not affect that date's cash.
8. In **Coverage forecast**, select the cash account, balance/start date (defaults to today in your account timezone), end date (defaults to year end), mortgage expense type (or **All mortgages**) and rental income types. **All mortgages** includes every Expense payment type. Select **All cash accounts** to combine each account’s dated balance for the forecast while preserving separate ledgers; totals and forecast results remain separated by currency. Start/end bounds are inclusive. Available cash + not-received rent due in the period − unpaid mortgage due in the period gives projected surplus or the amount to cover. Overdue rent/mortgage are shown separately and excluded unless you enable **Include overdue**. Scheduled cash entries are excluded from the forecast; record expected rent in the income payment list. Future costs and savings profit are not estimated automatically. Other currencies are shown separately and never converted; select their own cash account to compute coverage.

Total value is Paid/Received + Unpaid/Expected in the same filtered payment view, separately for each currency. Income type tabs show received and expected totals. Cash balances do not form part of payment totals. This is a planning tool, not a prediction that every tenant will pay on time.

Cash records use the same authenticated owner isolation, version checks, conflict handling, offline queue and tombstones as payments. Cash deletion is confirmed and changes the calculated ledger balance. A cash account containing entries and a type referenced by cash entries cannot be deleted. Forecasts are calculated from the current account snapshot; check **Saved** and resolve pending errors/conflicts for cloud confirmation. Historical balance dates show dated ledger balances, but forecasts use current Paid/Received statuses, not historical status snapshots.

Mobile layouts wrap totals, contain horizontal type-tab scrolling, and support portrait and landscape. Automated checks cover 360, 390 and 412 pixel portrait widths, landscape and enlarged text; physical iPhone/Samsung testing remains a separate acceptance check.

## Samsung Galaxy installation

1. Open the final HTTPS URL in Chrome on the Galaxy S26 Ultra.
2. Tap **⋮ → Add to Home screen → Install**. In Samsung Internet, use **Menu → Add page to → Home screen** when available.
3. Open DueTrack from the home screen. Sign in using the same account as on your computer.
4. Open online once to load payment data and cache the app. View or download a receipt once to make that receipt available offline on that device.

The manifest includes 192/512 pixel icons, maskable artwork, standalone display, and an app-shell service worker. The browser decides whether to offer installation. We have not performed physical Samsung testing.

## Payments, recurrence and currencies

Amount and due date are required. All other invoice fields and the receipt are optional. Paid records require a payment date. Amounts are stored as integers in the currency's minor unit (JPY: 0 decimals, AED/USD: 2, KWD: 3). Existing currency values never change with the default. Totals are separated by currency and labeled by filter scope. No conversion is performed.

Invoice, due, and paid dates use `YYYY-MM-DD` strings. Overdue means unpaid and strictly before today in the account's selected IANA time zone. Browser date display is locale-aware and preserves date-only values.

Monthly and yearly recurrence retain the original anchor day and clamp to the last day of a shorter month. January 31 → February 28 → March 31; February 29 → February 28 in non-leap years and February 29 in leap years. New occurrences have no paid status, payment date, invoice date, or attachment. Twelve future occurrences are created initially. Successful synchronization maintains a rolling year of occurrences; Extend by 12 can pre-create more. Occurrence IDs derive from series ID and due date; tombstones prevent regeneration. An occurrence can be edited independently. The future option applies amount, currency, type, description and reference to later unpaid occurrences. Changing the due-date anchor or cadence with that option starts a new schedule for the selected occurrence and later unpaid records, while preserving their stable IDs and individual receipts/status. History and paid records retain their dates and payment information; their old schedule is retired. Stopping a repeat retains already created future payments as one-off records. There is no unattended scheduler generating records while every client is closed; opening a client replenishes them.

## Synchronization and offline use

Cloud PostgreSQL is authoritative. IndexedDB holds an account-scoped snapshot, local receipt bytes, and pending mutations. Every write has a stable record ID, expected version, and mutation ID. The server serializes changes per owner and saves mutations transactionally, so a retry cannot duplicate a write. Deletes are versioned tombstones.

Refreshes preserve pending local edits. If a remote version differs, DueTrack displays both versions and requires a choice. A remote deletion can only be accepted in the conflict UI; restoring it requires deliberately adding a new record. Sync failures preserve the queue and offer retry. Changes to the same local record are coalesced before upload. Active foreground retry runs every 15 seconds; no dependency on browser background sync. Attachments are queued in IndexedDB, uploaded before their metadata, and displayed as locally available when cached. File replacement does not remove the existing cloud receipt until new upload and metadata save succeed.

Offline editing requires an initial sign-in and successful sync. Re-authentication may be required when a session expires. Browser storage can be evicted by the OS; offline-only pending edits cannot survive eviction. Export a backup regularly. Sign-out warns about pending changes, removes that account's local snapshot and receipt bytes, and ends its auth session. Updates do not force activation while existing clients are open, and never clear IndexedDB. Close all app tabs/windows and reopen online to adopt an update.

Restore is queued as individual versioned mutations, not a global cloud transaction. If a restore is interrupted, pending changes remain and retry is safe; check for conflicts and errors before treating it as complete. Payment types and cash accounts are saved before their payments and cash entries; dependent deletions are saved before parent deletions. There is no atomic multi-device bulk replace; avoid editing on other devices during a replace restore.

## Backup and restore

Settings → Export backup downloads a ZIP containing `backup.json` plus `receipts/<attachment-id>`. Version 2 includes active payment types, payments (including recurrence settings), cash accounts, cash ledger entries, preferences, and receipt bytes. Imports still accept version 1 payment-only backups; new exports use version 2. Older app versions cannot import version 2 backups. Every referenced attachment must be readable; export fails clearly if a receipt cannot be retrieved. Keep the ZIP private—it contains your payment information.

Settings → Import backup validates the ZIP, format version, field values, duplicate IDs, payment-type references, and attachment sizes. It previews counts before applying. Merge updates matching IDs and preserves other records; Replace adds deletion markers for records not present, with explicit confirmation. IDs preserve attachment relationships and prevent duplicate imports. The expanded/import size limit is 100 MB, and uploads remain subject to the 10 MB per-receipt limit. Backups are intended for the same account. Importing IDs already owned by another account is denied by backend authorization.

## Architecture and adding features

- `src/payments/model.ts`: schemas, integer money, date-only status, totals and sorting.
- `src/components/PaymentForm.tsx`: shared create/edit form.
- `src/recurrence/rules.ts`: pure anchored date rules, stable occurrence IDs, rolling window.
- `src/attachments/service.ts`: metadata validation, upload progress, authenticated download, offline caching.
- `src/auth/client.ts`: Supabase client and configuration.
- `src/sync/store.ts`: account-scoped IndexedDB, queue and refresh reconciliation.
- `src/sync/engine.ts`: retry-safe cloud mutation and attachment sequencing.
- `src/sync/useAccount.ts`: foreground/reconnect refresh, Realtime, account lifecycle.
- `src/backup/service.ts`: versioned ZIP validation and restore ordering.
- `src/main.tsx`: account screens; `src/components/Dashboard.tsx`: workspace and view composition.
- `src/payment-types/rules.ts`: type rename, reorder and deletion rules.
- `src/settings/preferences.ts`: account preference defaults.
- `supabase/migrations`: schema, backend validation, authorization, idempotency, deletion tracking.
- `supabase/functions/receipt-cleanup`: scheduled private file lifecycle.

Add a feature by defining its typed model and validation in a domain module, adding a migration for backend validation/relationships when needed, implementing data access through the sync engine, and composing UI components. Add behavior tests around business decisions and authorization. Keep keys and ownership checks server-side. A versioned discriminated record table is intentionally small; payment-type relationships are enforced inside the only granted write function rather than a conventional JSON foreign key. Future household sharing would require explicit membership tables and revised authorization; reminders and dashboards can consume existing date-only records. None are implemented now.

## Tests and honest acceptance status

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm test` runs domain, queue, backup and sync recovery tests plus PostgreSQL integration tests using PGlite. The latter execute the actual migration with minimal test auth/storage schemas, demonstrating ownership policies, conflict/idempotency logic, immutable receipt access and deletion safety. They do not exercise Supabase's HTTP authentication or actual object storage. CI additionally runs Supabase database tests and mobile/desktop Playwright checks. Tests run without cloud credentials; mocked network tests are labeled accordingly.

Before production, complete these live checks with your configured Supabase project:

- Create two verified accounts. Account B cannot fetch Account A's record IDs or receipt paths through the REST/storage API; signed-in owner download works, signed-out download fails.
- On desktop and installed Galaxy, sign into the same account. Create/edit/pay/delete a payment on each device; confirm the other receives every change. Restart both; records and receipts persist.
- Open a receipt, disconnect, reopen the installed app, and verify cached receipt and payments. Edit offline, reconnect, and confirm pending changes become Saved.
- Edit the same record on two disconnected devices; reconnect and verify explicit conflict choices. Delete remotely while editing offline; confirm it stays deleted when accepted.
- Interrupt an upload and retry. Confirm old receipt remains accessible until replacement succeeds. Confirm cleanup deletes unreferenced files after the grace period and retains all live files.
- Export/import with receipts using merge, repeat the import, then test replace after backup. Verify no duplicate IDs, correct type relationships, and cloud confirmation.
- Confirm installation, keyboard focus, text scaling, contrast, portrait/landscape layout and recovery emails on the actual Samsung phone.

The user deployed the cloud-configured build to https://chic-chaja-7faadb.netlify.app, applied the Supabase migration, configured authentication URLs, and supplied a screenshot of the signed-in desktop PWA showing Saved. This establishes the desktop sign-in and displayed sync state; it does not establish live cross-device payment or receipt synchronization. Physical Samsung installation, two-device synchronization, real receipt lifecycle, password recovery email delivery, and the scheduled cleanup function still require live verification. The earlier Sites publication attempt was blocked; Netlify is the active host.

## External services and costs

- **Supabase**: Auth, PostgreSQL, Realtime, private Storage and Edge Functions. A free tier can support trial use; storage, egress, active-user, Realtime and function quotas apply, and free projects may pause. Production paid plans and overages vary—check current pricing in your account. Cleanup consumes function/storage calls.
- **HTTPS static hosting**: Sites or your own Cloudflare Pages/Netlify/Vercel account. Free tiers are generally available with bandwidth/build limits; availability and billing depend on the selected service.
- **SMTP provider**: needed for reliable production authentication emails, with provider-specific free limits or paid pricing.
- No payment processing service, analytics service, SMS, AI API, household sharing, or reminders are included.
