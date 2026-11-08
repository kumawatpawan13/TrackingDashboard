# Session Changes

This file records fixes and changes made in active development sessions, so future sessions can pick up without re-discovering them. It is a log, not a spec — see `docs/PROJECT_CONTEXT.md` for architecture.

## 2026-11-08 — Dev login fixed (legacy hash/salt mismatch)

- **Root cause**: existing accounts (e.g. `admin`) were hashed with WebCrypto PBKDF2 at **100,000 iterations** using the **raw base64 salt string as bytes**. The app's `passwordHash()` decodes the base64 salt and hashes at **210,000**, and the login route's legacy fallback only tried 100k with the decoded salt — so no stored hash could ever verify. The `admin` password is `Admin@123456`; login failed purely because of the hash/salt mismatch, not the credentials.
- **Fix** (`src/index.js`): `passwordHash()` gained a `decodeSalt` option; the login route now also verifies with the legacy raw-base64-salt variant (`{ decodeSalt: false }`) before rejecting. On match, the hash auto-upgrades to a fresh salt + 210k hash.
- **Helper scripts** (`reset-password.js`, `set-password.js`): replaced the raw WebCrypto PBKDF2 implementation with the same manual HMAC-SHA256 PBKDF2 as `src/index.js` (decoded base64 salt, 210k), so scripts produce hashes the app can verify. Previously they could never match.
- **Verified**: `admin` / `Admin@123456` now logs in (200, session cookie set) and the stored hash auto-upgraded to a 210k hash with a new salt.

## 2026-11-02 — Production login and recovery improvements

- **Employee login** (`src/index.js`, `public/app.js`): accept the linked employee ID as an alternative to the account username; retain username/password login for all roles.
- **Session UX**: add show/hide password and an opt-in 30-day session, preserving the existing seven-day default.
- **Email password recovery**: add Resend-delivered OTP recovery with short expiry, attempt limits, resend cooldown, generic account-independent responses, and session invalidation on password change.
- **Recovery email management**: add a schema migration and admin controls to set/clear recovery emails. Employee-linked email is used when an account recovery address is blank.
- **Production setup** (`README.md`): document remote migrations and required Resend/OTP Worker secrets; production resources were not verified or deployed.

## 2026-11-02 — User creation, security, and config fixes

### Bug fixes
- **User creation was broken** (`public/app.js`). The Add User modal rendered but no submit handler existed for `user-form`. Added the handler: validates employee selection for the `employee` role, POSTs `{username, password, role, employee_id?}` to `/api/users`, then refreshes the view.
- **Employee dropdown silently failed** (`public/app.js` `openUserModal`). The `api('/api/employees')` call had no `.catch()`, so a network/auth error left the dropdown empty and the backend then rejected the role with "employee id required". Added `.catch()` with a toast and client-side validation.
- **IDOR in payslip endpoint** (`src/index.js` `/api/employee/slip`). An `employee`-role user could pass `employee_id` in the query string and view another employee's payslip. The route now resolves `employeeId` from `user.employee_id` for the employee role and ignores the query param.
- **Dead payroll CSV export** (`src/index.js` `/api/reports/payroll.csv`). The route referenced undefined `columns`/`rows` variables and 500'd. Added a `CSV_COLUMNS` constant and fetches rows via `calculateMonth` + `mapPayrollToSlipColumns`.
- **Division by zero** (`src/calculator.js` `ctcForPayrollMonth`). A month with 0 days crashed the proration. Now returns 0 when `daysInMonth` is 0.
- **Stale password hash iterations** (`src/index.js`). Backend hashed at 100,000 while helper scripts (`reset-password.js`, `set-password.js`) hashed at 210,000, so scripts produced hashes the app could not verify. Unified to `PASSWORD_HASH_ITERATIONS = 210_000`.

### Security / config
- **Hardcoded credentials removed** from `reset-password.js` and `set-password.js`. Both now require username, password, and salt as CLI args.
- **Hardcoded D1 database ID removed** from `wrangler.toml`. `database_name` is now `"salary-payroll"` (a name, not an ID); set the real ID before deploying.
- **`not_found_handling` typo fixed** in `wrangler.toml: `single-page-app` → `single-page-application` (valid value).
- **Null-safety** in the setup probe: `needsSetup: Number(userCount?.count ?? 0) === 0`.

### Performance
- **Added migration `0011_performance_indexes.sql`** with six composite indexes on hot query paths: salary revisions by employee+date, attendance by employee+date, payroll adjustments by month, recurring items by employee+component, travel claims by employee+status, leave balances by year+type.

### Dead code removed
- Removed unused `payrollRole`, `employeeRole`, `employeeSelfOnly` helpers from `src/index.js`; inlined the payroll role check.

### Not changed (intentional)
- Frontend GPS watcher memory leaks, migration rollback safety, Workers CPU-limit tuning, rate limiting, CSRF tokens, and CHECK-constraint fixes that need table rebuilds were skipped — they are not regressions and need separate design work.

## Related files touched this session
`public/app.js`, `src/index.js`, `src/calculator.js`, `wrangler.toml`, `reset-password.js`, `set-password.js`, `migrations/0011_performance_indexes.sql`.

## 2026-11-02 (later) — Automatic salary integration

### New feature: punch-to-attendance
- **Migration `0012_automatic_salary_integration.sql`** adds an `attendance_days.source` column (`''` for manual, `'punch'` for auto-derived) plus an index on `(employee_id, work_date, source)`.
- **New route `POST /api/travel/punch/sync`** (admin/hr/payroll) reads `travel_punch_events` for a month and writes `attendance_days` rows marked `source='punch'`. A day with both an in-punch and out-punch becomes `P` (Present); only one direction becomes `R` (Regularized). Manual edits are never overwritten — the route skips any day that already has a manual `attendance_days` row.
- **UI**: the Travel view gains a **⇄ Sync punch attendance** button that calls the route and reloads the view.

### New feature: GPS distance from route points
- **`POST /api/employee/travel/live` stop action** now reads `travel_route_points.cumulative_km` and uses it as `gps_distance_km`/`road_distance_km` when route points exist. The client-supplied start-to-end straight-line value is the fallback only. This fixes the case where a live-tracked journey submitted a straight-line distance far below the actual route.

### New feature: per-employee TA/DA rules flow into payroll
- **`src/calculator.js`**: added `allowanceForDays(employeeId, days, settings, employeeRules)`, which calls `resolveAllowanceSettings` per date so per-employee `travel_allowance_rules` actually affect payroll.
- **`calculateMonth()`** now loads `travel_allowance_rules` (active only) and applies them per employee per date to both approved-journey TA/DA and approved expense-claim TA/DA, then combines the two into one `travelReimbursement` passed to `calculatePayroll`.

### New feature: approved expense claims flow into payroll
- **`calculateMonth()`** now queries `travel_expense_claims` (status `approved`, `approved_km > 0`) grouped by employee and travel date, and adds their TA/DA to the month's payroll. Previously an approved claim's TA/DA was stored but never read by payroll.

### Tests
- Added two tests in `test/calculator.test.js` for `allowanceForDays`: per-employee rule override, effective-date gating, employee isolation, and daily KM cap. All 26 calculator tests pass; the only failing suite is `test-login.js`, which needs a running D1 server and is unrelated.