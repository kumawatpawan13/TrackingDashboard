# Architectural and Technical Decisions

This file records decisions evidenced by the current source or project documentation. It does not imply that every choice was separately approved or tested in production.

## Workbook formulas remain the calculation authority

- **Decision:** Implement workbook-derived rules in `src/calculator.js` and preserve observed labels and inconsistencies.
- **Evidence/reason:** The supplied workbook is the primary business-logic reference; `README.md` and `docs/excel-formula-map.md` state that the workbook’s formulas and labels were intentionally retained. Calculation tests compare selected results with cached workbook values.
- **Consequence:** The current treatment of employer contributions and payslip labels is intentionally not “corrected” by the app. Consult the formula map before changing payroll math.

## One D1 source of truth; calculate payroll on read

- **Decision:** Persist employee inputs and related ledgers in D1, while deriving monthly payroll when requested instead of storing calculated output rows.
- **Evidence/reason:** `calculateMonth()` loads the relevant tables and calls the calculation engine; the migration has no persisted payroll-result table. The dashboard, payroll, CSV, and slip routes all use calculated results.
- **Consequence:** Input changes feed later payroll/payslip reads without synchronization among duplicate salary-result records.

## Cloudflare Worker + Hono + D1

- **Decision:** Use Hono routes in a Cloudflare Worker, D1 for relational persistence, Wrangler for local development/deploy, and Worker static assets for the browser UI.
- **Evidence/reason:** `package.json`, `wrangler.toml`, `src/index.js`, and `README.md` define this stack. The README cites durable D1 storage and a low-cost/free-tier deployment path while explicitly warning that quotas and uptime are limited.
- **Consequence:** Production setup requires a real D1 database ID and Cloudflare credentials; the checked-in database ID is a development placeholder.

## No frontend framework or compilation pipeline

- **Decision:** Serve vanilla HTML/CSS/JavaScript as static Worker assets and use delegated browser events.
- **Evidence/reason:** `public/index.html` loads `public/app.js` directly as a module; Wrangler serves `public/`; there is no frontend build script or framework dependency in `package.json`.
- **Consequence:** Keep UI changes compatible with browser-native modules and the existing delegation/rendering patterns unless a separate migration is requested.

## Roles, cookie sessions, and password recovery

- **Decision:** Support `admin`, `hr`, `payroll`, and linked `employee` accounts; accept an account username or linked employee ID at login. Sessions use an HttpOnly, SameSite Strict cookie, Secure on HTTPS, and expire after seven days by default or 30 days when explicitly requested.
- **Evidence/reason:** Implemented in `src/index.js` and reflected in role-aware UI and the README. Passwords use PBKDF2-SHA-256 with 210,000 iterations; login accepts legacy 100,000-iteration hashes and upgrades them after successful verification. Session tokens are random and only their SHA-256 digest is stored.
- **Consequence:** Role enforcement belongs in API routes as well as navigation. HR responses intentionally omit salary/statutory/bank details. Security properties have not been independently audited.

### Email OTP password recovery

- **Decision:** Use Resend to deliver a six-digit recovery code to an administrator-managed recovery email (or the linked employee email when no account recovery email is set). Allow account lookup by username, linked employee ID, or recovery email. Store a keyed HMAC of the code, expire it after ten minutes, limit verification attempts, and invalidate sessions after a successful reset.
- **Evidence/reason:** The Worker has no SMTP sender; Resend provides an HTTPS API compatible with the Cloudflare Worker runtime. Recovery requests use a generic response to avoid confirming whether an account exists.
- **Consequence:** Production must configure `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, and a random `AUTH_OTP_SECRET` as Worker secrets; local development uses an ignored `.dev.vars` file. Existing users need a recovery email before self-service recovery can work. A one-minute resend cooldown applies per account.

## Workbook import reads saved values, not formulas

- **Decision:** Use Python `openpyxl` in `data_only` mode to convert workbook values into versioned JSON, then import that JSON through an admin-only endpoint.
- **Evidence/reason:** `scripts/export-workbook-data.py` and `/api/import/workbook-json` implement this conversion/import boundary; `README.md` explains that formulas are not recalculated and formula cells without cached values are skipped.
- **Consequence:** Recalculate/save the workbook in spreadsheet software before extraction when fresh cached formula results are needed. Treat the output JSON as sensitive because it can contain banking and tax identifiers.

## Calculated payslips use browser print-to-PDF

- **Decision:** Render a printable payslip in the existing browser UI and rely on the browser’s native print/save dialog instead of a PDF service or library.
- **Evidence/reason:** The UI’s print action calls `window.print()`, `public/styles.css` contains print styling, and `README.md` describes this flow.
- **Consequence:** PDF generation depends on the browser’s print capability; no server-generated PDF artifact is produced.

## Upsert imports and application-level backups

- **Decision:** Export payroll data (excluding user credentials/sessions) to JSON; restore/import updates matching records rather than deleting absent records.
- **Evidence/reason:** The `/api/backup`, restore, and import code in `src/index.js` selects business tables and performs insert-on-conflict updates. The README describes non-destructive upsert restore.
- **Consequence:** Restore is not a full database replacement. Deleted/absent records may remain; take and protect backups before importing.

## No invented leave, statutory, or attendance integrations

- **Decision:** Model only the attendance codes and payroll behavior present in the workbook; do not add inferred statutory compliance or unrelated integrations.
- **Evidence/reason:** `ATTENDANCE_CODES`, payroll settings, formula mapping, and README describe the supported scope and explicitly list absent leave-approval, device, filing, and payout features.
- **Consequence:** The application is a workbook-based calculator/workflow, not a certified payroll compliance engine. Have approved payroll rules reviewed before production use.

## Travel allowances are grouped by approved employee/date

- **Decision:** Calculate travel TA from approved distance and apply daily DA once per employee travel date. Cap the daily payable distance using the travel settings; keep manually entered TA/DA separate.
- **Evidence/reason:** `calculateMonth()` groups approved journey distances by employee and date before calling the travel calculator. Payroll and the Travel preview display travel amounts separately from manual reimbursement.
- **Consequence:** Multiple approved journeys on the same date contribute distance to one daily cap and one DA eligibility check. This does not change the workbook's net-pay formula.

## Live travel is owned by an employee-linked account

- **Decision:** Store live journey records against the linked employee ID, retain the account that started tracking, list active journeys for approvers, and submit the journey when tracking stops.
- **Evidence/reason:** Employee login IDs are distinct from employee master IDs; `users.employee_id` is the authoritative account-to-employee link. The live-session table marks an active journey without changing the existing journey-status constraint.
- **Consequence:** A stopped journey awaits approval. Payroll includes its TA/DA only after an approver sets it to `approved`; `calculateMonth()` then groups the approved distance under that employee and month.

## Custom payroll items adjust final payable after workbook net payable

- **Decision:** Support one-off or recurring custom earnings and deductions, applying them after the workbook-derived net-pay calculation and retaining the existing zero floor for final payable.
- **Evidence/reason:** `calculatePayroll()` leaves `netPayable` unchanged and computes `finalPayable` from it, manual reimbursement, travel allowances, and custom items. The custom item tables preserve recurring effective months and one-off payroll months.
- **Consequence:** Custom deductions do not change the workbook's `netPayable` result; review `finalPayable` for the adjusted amount. Do not treat this extension as a change to the workbook formulas or a statutory rule.

## Punch in/out for field force attendance

- **Decision:** Require a live front-camera selfie and GPS location for punch-in and punch-out, preventing duplicate punches for the same direction on the same date. Employee routes show their own large live map; active employee locations are visible only to admin/payroll roles.
- **Evidence/reason:** `POST /api/travel/punch` records `travel_punch_events` with lat/lng, accuracy, selfie URL, and an unverified face flag. `/api/travel/live-locations` is restricted to admin/payroll.
- **Consequence:** The browser offers camera capture instead of a photo picker and the API requires a JPEG data URL, but a web client cannot prove camera provenance or liveness from that payload alone. No face recognition/liveness check is claimed. GPS accuracy is displayed using the configured setting.

## Customer/Doctor master management

- **Decision:** Provide CRUD API for customer records (doctors, pharmacies, other) with location data for field visit routing and planning.
- **Evidence/reason:** New endpoints `/api/travel/customers` (CRUD) manage `travel_customers` table with name, customer_type, lat/lng, territory, phone, notes. Employee role can view all; admin/hr can edit/delete.
- **Consequence:** Enables DCR visit management and territory planning like TrackOlap's customer master.

## Expense bill/photo uploads

- **Decision:** Support expense bill attachments (photos/receipts) linked to journeys or claims with status tracking for approval workflow.
- **Evidence/reason:** New endpoints `/api/travel/expense-bills` (CRUD) manage `travel_expense_bills` table with category, amount, photo_url, status, approved_by.
- **Consequence:** Employees can submit expense bills with photo evidence; HR/payroll can approve with photo verification.

## Per-employee allowance rules override

- **Decision:** Allow per-employee TA/DA rate overrides effective from a specific date, superseding global settings.
- **Evidence/reason:** New endpoints `/api/travel/allowance-rules` (CRUD) manage `travel_allowance_rules` table. `resolveAllowanceSettings()` in `calculator.js` applies these overrides when calculating travel allowances.
- **Consequence:** Field force employees can have different allowance rates based on role, territory, or seniority, matching TrackOlap's allowance policy feature.

## Employee UI navigation updated

- **Decision:** Add Punch, Customers, and travel views to employee navigation for self-service field force workflows.
- **Evidence/reason:** `renderPunch()` and `renderCustomers()` functions render these views; action buttons added to dashboard and punch modals.
- **Consequence:** Field force employees have a unified interface for punch in/out, customer visits, and travel tracking without needing admin/payroll access.

## Horizontal navigation and tabbed rule settings

- **Decision:** Group existing views under a responsive horizontal category tab row, with a smoothly revealed horizontal destination row instead of dropdown menus; organize Rule settings into compact tabs without changing routes, permissions, or save endpoints.
- **Evidence/reason:** The shell renders role-filtered navigation groups; the destination row scrolls on narrow screens, and settings tabs reuse the existing approval, payroll, travel, and company/payslip controls.
- **Consequence:** Navigation remains limited by the existing account-role rules, and the selected theme palette and corner settings apply to the new controls. Employee names link to the corresponding employee detail view.

## Session fixes (2026-11-02)

These are corrective decisions recorded so future sessions do not repeat them.

## Password hashing and helper scripts share one iteration count

- **Decision:** Use `PASSWORD_HASH_ITERATIONS = 210_000` in `src/index.js` and in `reset-password.js` / `set-password.js`.
- **Evidence/reason:** The helper scripts previously hashed at 210,000 while the app verified at 100,000, so scripts produced hashes the login route rejected.
- **Consequence:** Change the constant in one place; the scripts and the app must always match.

## Secrets and deployment config are not committed

- **Decision:** Remove hardcoded passwords, salts, and D1 database IDs from source files and `wrangler.toml`.
- **Evidence/reason:** `reset-password.js` and `set-password.js` contained a hardcoded admin password and salt; `wrangler.toml` contained a hardcoded `database_id`.
- **Consequence:** `wrangler.toml` now holds `database_name = "salary-payroll"` only. Set the real D1 ID via `npx wrangler d1 create` before `npm run deploy`. Helper scripts require username, password, and salt as CLI arguments.

## Payroll CSV export is a real route

- **Decision:** Implement `/api/reports/payroll.csv` with a fixed column set rather than leaving it as a dead route.
- **Evidence/reason:** The route referenced undefined `columns`/`rows` variables and returned 500. It is used by the Reports UI.
- **Consequence:** The CSV includes employee identity, CTC/gross/basic/HRA/bonus, deductions, net/final payable, paid/absent/leave days, travel TA/DA, and reimbursement.

## Composite indexes for hot query paths

- **Decision:** Add `migrations/0011_performance_indexes.sql` with composite indexes rather than ad-hoc single-column indexes.
- **Evidence/reason:** The dashboard, payroll, and attendance views repeatedly filter/join on `(employee_id, ...)`, `(payroll_month)`, and `(year, leave_type_id)`.
- **Consequence:** Indexes are additive and safe to apply to an existing database; they do not change data.

## Automatic salary integration (2026-11-02)

### Punch events drive attendance

- **Decision:** Sync `travel_punch_events` into `attendance_days` on demand via `POST /api/travel/punch/sync`, tagging derived rows with `source = 'punch'`.
- **Evidence/reason:** Punches were recorded but never reached the paid-day ledger, so a punched-in day did not count toward payroll. The attendance grid is the authority for paid days.
- **Consequence:** A day with both punches becomes `P` (Present); one direction only becomes `R` (Regularized). Manual attendance rows (`source = ''`) are never overwritten, so an administrator can correct a punched day. The sync is manual (admin/hr/payroll only), not automatic on every punch, so it stays auditable.

### GPS distance comes from recorded route points

- **Decision:** On live-tracking stop, use `travel_route_points.cumulative_km` for `gps_distance_km` and `road_distance_km`, falling back to the client-supplied start-to-end value only when no route points exist.
- **Evidence/reason:** The client value is a straight-line distance between start and end, which under-reports a real driven route. Route points are recorded continuously during tracking.
- **Consequence:** Approved distance for a live journey reflects the actual tracked distance. The fallback preserves behavior for journeys submitted without route points.

### Per-employee allowance rules and approved claims flow into payroll

- **Decision:** `calculateMonth()` loads active `travel_allowance_rules` and approved `travel_expense_claims`, then computes TA/DA per employee per date through `allowanceForDays()`, which applies per-employee rules when effective.
- **Evidence/reason:** `resolveAllowanceSettings()` existed but was never called by payroll, so per-employee allowance rules had no effect. Approved expense claims stored TA/DA that payroll never read.
- **Consequence:** Both approved journeys and approved expense claims contribute TA/DA to the month's payroll, and per-employee allowance rules override the global `travel_settings` per date. `calculateMonth()` now issues two extra small queries (allowance rules, expense claims), both covered by the migration's existing indexes.

## Security hardening and Kinetic Minimalism redesign (2026-11-04)

### Security requirements implemented

- **Decision:** Implement 19 security hardening items across the application: rate limiting, CAPTCHA integration, security headers, CORS lockdown, input validation, IDOR protection, audit logging, session security, password hashing, error handling, debug mode removal.
- **Evidence/reason:** `src/index.js` implements `checkRateLimit()`, `verifyCaptcha()`, `checkResourceAccess()`, `adminAuditLog()`, security headers middleware, and input validation helpers. `migrations/0014_admin_audit_log.sql` creates the admin audit log table.
- **Consequence:** All API routes are protected by rate limiting and security headers. Self-service endpoints enforce IDOR checks. Admin actions are logged to `admin_audit_log`. CAPTCHA is optional and only active when `CAPTCHA_SECRET_KEY` is configured.

### Design system: Kinetic Minimalism + Bento Grid + Glassmorphism

- **Decision:** Redesign the UI to Kinetic Minimalism with a Bento Grid layout and Glassmorphism accents. Remove purple gradients, pill buttons, and emoji icons.
- **Evidence/reason:** `public/styles.css` was completely rewritten with a solid-color palette (no gradients), rectangular buttons (max 6px border-radius), a 4-column Bento Grid for dashboard cards, and `backdrop-filter: blur(8px)` on modals only. `public/index.html` updated with favicon, privacy policy, and terms of service links.
- **Consequence:** The design system is documented in `docs/SECURITY_DESIGN_RULES.md`. All new UI work must follow these rules: solid colors only, rectangular buttons, no emoji, glassmorphism only on modals, functional motion only.

### Security and design rules are a permanent reference

- **Decision:** Document all security requirements and design system rules in `docs/SECURITY_DESIGN_RULES.md` so any future Claude Code session or agent can review them before building.
- **Evidence/reason:** The rules were applied across the codebase but not previously consolidated in a single reference document.
- **Consequence:** Read `docs/SECURITY_DESIGN_RULES.md` before any new feature implementation. The checklist at the end of that file must be completed before committing code.

## Attendance and expense approvals are administrator-configured

- **Decision:** Keep separate ordered approval workflows for attendance regularisation and expenses, with no seeded approval levels. Rule settings configure each manual step by designation; account roles remain a separate access-control concern. Auto-approve steps remain available.
- **Evidence/reason:** A fixed approval chain did not reflect the administrator-configurable requirement. The workflow schema supports per-request-type levels and sequential order, while employee records hold designations used to match approvers.
- **Consequence:** New submissions require at least one configured manual approver; otherwise the API returns a validation error. Auto-approve steps are skipped, every manual step is required in order, and the settings view previews each chain as a vertical workflow diagram. The designation reference is guidance only and does not seed levels. Requests already stored without a workflow ID retain legacy advancement behavior.

## Enterprise RBAC and organizational access-control foundation (2026-11-04)

- **Decision:** Keep account role, functional access roles, and employee designation as separate concepts. Store role permissions and user-role assignments in D1, enforce mapped module/action permissions in guarded API routes, and apply employee scopes for self, department, region, area, and reporting-tree access.
- **Evidence/reason:** Migration `0021_enterprise_access_control.sql` adds the role, permission, assignment, active-account, and audit records. Migration `0022_rbac_dashboard_and_immutable_audit.sql` grants manager dashboard access and protects access and approval history from update/deletion. `src/index.js` resolves session roles per request, checks authorization, projects sensitive employee fields, and requires Finance or Super Admin access for payroll and salary revisions.
- **Consequence:** Existing account roles remain compatible while functional roles can be assigned to linked employee accounts. Organization scope is enforced on employee lists/details, attendance, expense views, and selected supporting endpoints; this is a foundation, not a completed certification of every API/resource path.

## Approval actions and resulting payroll inputs

- **Decision:** For configurable attendance and expense workflows, persist each approval-state change together with its approval-history entry in a D1 batch. Apply the attendance ledger update in the same batch as the final attendance approval.
- **Evidence/reason:** A request status without its corresponding approval history, or attendance status without an approved request, would leave the workflow and payroll inputs inconsistent. Conditional updates prevent concurrent duplicate approvals.
- **Consequence:** The database batch is atomic for these configurable workflow paths. Other existing legacy state transitions and non-approval administrative audit writes are not asserted to share this transaction boundary.

## Remaining approval and RBAC scope

- **Decision:** Do not imply that the current workflow foundation implements the entire enterprise acceptance request.
- **Evidence/reason:** The shared workflow currently covers attendance regularisation and expenses, with a My Approvals inbox/history for these request types. Leave still has its existing status flow; delegation/reassignment, full attachment/duplicate/DA/reimbursement controls, and the complete acceptance/security regression matrix are not implemented.
- **Consequence:** Consult [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) for current boundaries and complete the remaining work before describing the system as enterprise-complete or production-certified.
