# Project Context

## Project identity

This repository contains **Salary Desk**, an Excel-workbook-based payroll application. No “Status Board” code or feature was found in the inspected source; if Status Board refers to a different project, its repository has not been identified here.

## Stack and runtime

- JavaScript ES modules; Node.js/npm for local development and tests.
- Cloudflare Worker API implemented with Hono (`hono`); Wrangler is the dev/deploy tool.
- Cloudflare D1 (SQLite) is the persistent relational store.
- Browser UI is hand-written HTML, CSS, and vanilla JavaScript; no frontend framework or build/bundler step.
- Python 3 and `openpyxl` are used only by the workbook-to-JSON extraction script.

## Structure and important files

- `src/index.js` — Hono API, auth/session middleware, role checks, validation, D1 queries, imports/exports, and error handling.
- `src/calculator.js` — workbook-derived rounding, salary components, revision proration, attendance summary, payroll, and payslip mappings.
- `public/index.html`, `public/app.js`, `public/styles.css` — single-page browser UI and print styling. `app.js` calls same-origin `/api` endpoints.
- `migrations/0001_init.sql` — D1 schema, indexes, and default payroll settings.
- `migrations/0002_travel_tracking.sql` and `0003_travel_schema.sql` — travel journeys, visits, audit records, and travel settings.
- `migrations/0004_payroll_custom_items.sql` — reusable payroll component definitions, employee recurring items, and month-specific items.
- `migrations/0007_live_travel_tracking.sql` and `0008_employee_user_role.sql` — active tracking ownership and employee-account role support.
- `migrations/0009_enhanced_travel_tracking.sql`, `0010_field_force_dcr_punch.sql`, `0011_performance_indexes.sql`, and `0012_automatic_salary_integration.sql` — enhanced travel, punch-in/out + customer/expense/allowance tables, query performance indexes, and the `attendance_days.source` column that lets punch events drive paid days.
- `migrations/0013_authentication_recovery.sql` — recovery-email fields and one-time password-reset challenge storage.
- `scripts/export-workbook-data.py` — reads saved workbook values with `openpyxl` and produces the import JSON; it does not calculate Excel formulas.
- `test/calculator.test.js` — Node built-in test-runner fixtures for calculation behavior.
- `docs/excel-formula-map.md` — sheet data flow, formulas migrated, source anomalies, and cached workbook comparison values.
- `wrangler.toml` — Worker entry, static asset binding, D1 binding/database name, compatibility date, and migrations directory. The checked-in D1 ID is a placeholder for deployment.
- `README.md` — setup, workbook import, operations, free-tier constraints, backups, and research notes.

## Application structure and data flow

1. The browser requests `/api/session`. If there is no user, it shows first-admin setup or login; otherwise it renders a role-aware shell and loads the selected view.
2. The browser sends same-origin JSON requests to Hono routes. The API authenticates with a cookie-backed session, validates input, applies role checks, and reads/writes D1 using prepared statements.
3. Employees, revisions, attendance, holidays, adjustments, and settings are persisted in D1. Payroll is calculated when requested; there is no separate persisted salary-result table.
4. `calculateMonth()` joins the relevant employee, revision, attendance, adjustment, holiday, and settings data, fills unset Sundays/paid holidays with defaults, then calls `calculatePayroll()`.
5. Payroll, dashboard totals, CSV output, and payslips use the calculated results. Payslips are rendered in the browser and printed/saved as PDF with the system print dialog.
6. Workbook import and backup restore upsert matching records; they do not delete records absent from the incoming JSON.

## Database schema

The initial migration creates:

- `users`, `sessions` — accounts (including employee accounts linked through `employee_id`) and hashed session-token records; session records reference users.
- `employees` — employee master, CTC/statutory applicability, contact/bank/tax identifiers, active/archive state.
- `salary_revisions` — effective-dated CTC history with source order.
- `attendance_days` — one status per employee/date; `(employee_id, work_date)` is the primary key.
- `holidays` — named paid/unpaid dates; date/name pair is unique.
- `payroll_adjustments` — monthly reimbursement and advance deduction per employee.
- `payroll_component_definitions`, `payroll_recurring_items`, `payroll_one_off_items` — reusable earning/deduction labels, employee-specific recurring amounts, and one-month custom items.
- `travel_settings`, `travel_journeys`, `travel_live_sessions`, `travel_visits`, `travel_audit_log` — configured travel rates, journey records, active tracker ownership, visits, and approval audit history (see travel migrations for exact columns).
- `payroll_settings` — keyed numeric formula constants.
- `payroll_periods` — monthly workflow status (`draft`, `review`, `approved`, `paid`).

Indexes support active employee/name search, revision ordering, attendance date/status, and holiday dates. Default formula settings are inserted by the migration. See `migrations/0001_init.sql` for constraints and exact columns.

## Implemented features

- Employee create/edit/archive and employee search.
- Effective-dated salary revisions.
- Month-scoped daily attendance and paid holiday management.
- Editable payroll formula settings, monthly reimbursement/advance inputs, and payroll run status.
- Approved travel TA/DA calculated per employee and travel date, plus separate one-off or recurring payroll earnings/deductions.
- Employee live GPS journeys are linked to the account's assigned employee record, appear in travel approvals while tracking, and flow into payroll only after approval.
- Attendance regularisation and expense approvals use independently configurable, ordered workflows. Administrators define manual approvers or auto-approve steps in Rule settings; no approval levels are preconfigured. New submissions are blocked until their workflow has a manual approver.
- Calculated payroll dashboard, CSV report, and printable payslip.
- First-admin setup, login/logout, username or employee-ID sign-in, seven-day sessions with an opt-in 30-day session, and `admin`/`hr`/`payroll`/`employee` roles.
- Email OTP password recovery uses Resend; accounts can be identified by username, linked employee ID, or recovery email. Codes expire after ten minutes, have limited attempts, and are stored only as keyed hashes. Administrators manage recovery emails; existing employee records may supply their linked account's address.
- Administrator access control supports password resets with active-session invalidation and user removal; self-removal and removal of the final administrator are blocked.
- Enterprise access-control foundation adds functional roles and module/action permissions separately from account roles, role assignment and status controls, manager/department/region/area employee scopes, organization edits, access-audit history, and finance-only payroll/revision permissions. The role and organization screens are backed by D1 APIs; a My Approvals screen shows actionable requests and recorded approval decisions.
- Expense and attendance workflow approvals now record each action atomically with the request transition; the final attendance approval and attendance-ledger update share the same D1 batch. Approval history and access-audit rows are protected against update and deletion by database triggers.
- The application shell uses two horizontal navigation rows: category tabs and a smoothly revealed row of destinations for the selected category. Both rows scroll horizontally on smaller screens; dropdown menus are not used. Destinations reuse existing views and remain filtered by the current account role; employee names link to their employee detail view.
- Rule settings are organized into Approval workflows, Payroll rules, Travel, and Company & payslip tabs. Existing settings, save actions, and workbook formulas are unchanged.
- Admin JSON backup/restore and converted-workbook JSON import.
- Workbook-derived payroll calculations with calculation tests against saved workbook examples.

## Workbook behavior and known limitations

- Preserve the source workbook behavior and labels, including known inconsistencies documented in `docs/excel-formula-map.md`: employer PF/ESIC are included in net-pay deductions and appear again in payslip deductions; two payslip labels map to different payroll columns than their labels suggest; the wage add-back is zero.
- Attendance codes include paid leave, but there is no leave-balance or accrual workflow. Attendance regularisation approvals are configurable separately from leave. The workbook’s attendance completion calculation can report “Open / Check” for otherwise populated leave/weekly-off cases.
- Travel tracking records GPS/road distance and approval, but location capture and routing are browser-side; this is not an attendance-device or geofencing integration. Shifts, employee self-service, statutory filing, bank payout, and a dedicated tax engine are not implemented.
- Workbook extraction uses cached/saved cell values and skips formula cells without cached results; formulas are not evaluated by the importer.
- Node tests cover payroll calculations and authentication API flows (`node --test`); there are no checked-in automated browser tests.
- No CI workflow or issue tracker was present in the inspected project files. A separate Status Board project was not located.
- Production deployment, live Cloudflare resources, and production restore behavior were not verified. Configure the real D1 database ID and credentials before deployment; free-tier availability/quotas are not a production SLA.
- The local `.wrangler/` D1 state is ignored by git and can contain imported payroll data. Do not assume it is empty; protect it as sensitive data.

## Configuration and commands

`package.json`:

```powershell
npm install
npm run dev         # Syntax-check, apply local migrations, then start Wrangler
npm run db:setup    # Apply D1 migrations locally without starting the app
npm run check       # Syntax-check Worker, calculator, and browser modules
npm test            # Run Node built-in tests
npm run db:deploy   # Apply migrations to remote D1
npm run deploy      # Syntax-check and deploy Worker/static assets
```

Workbook extraction (requires Python and `openpyxl`):

```powershell
python scripts\export-workbook-data.py <workbook.xlsx> --output salary-workbook-import.json
```

The output can be uploaded by an administrator from **Access control**. It contains sensitive employee fields; keep it private and remove it when no longer needed. Local D1 state resides under `.wrangler/`; backup/recovery steps are in `README.md`.

## Enterprise access-control boundaries

- The configurable approval engine currently covers attendance regularisation and expenses. Leave requests still use their existing status flow rather than the shared sequential workflow; workflow delegation and administrator reassignment are not implemented.
- With RBAC enabled, the audited employee, attendance, travel, hierarchy, expense, customer, and field-operation paths apply functional-role scopes, including list-query filters and write checks. Employee-only accounts remain limited to their own employee data; managers are limited to assigned organizational scope. Other employees' payslips, payroll dashboard totals, and payroll CSV exports require Super Admin or Finance access; generic dashboard or report permissions do not grant payroll access.
- The complete 14-case acceptance matrix and broad API/resource-scope regression coverage remain outstanding. Targeted tests cover auth, employee detail, approval routing, selected payroll boundaries, and regressions for legacy account-role bypasses and employee/manager data scopes.
- Expense attachment lifecycle, duplicate-claim detection, daily DA validation, and a configurable reimbursement-to-payroll policy are not implemented as one integrated workflow.
- Do not treat this implementation as a completed security audit or production authorization certification. Validate all protected API routes and realistic organization data before using real payroll records.

## Current pending work

- Further UI/API integration testing and a production security/privacy review are prudent before using real payroll data.
- Confirm with the requester whether “Status Board” means this Salary Desk repository or a different project before adding product-specific documentation for that name.

## Attendance defaults and UI (added 2026-10-30)

- A calendar day with no explicit attendance record now defaults to **Present** on weekdays, **Weekly off** on Sundays, and **Holiday** on paid holiday dates. Previously blank weekdays counted as “No Report” and were not paid. This changes paid-day counts for months with sparse attendance.
- The attendance grid colors each select by its current code (green P, teal R, red A, amber CL, blue SL, purple L, gray WO, violet H) and shows a tooltip with the code name.
- On narrow screens the grid switches to a stacked employee card view instead of a wide table.

## Holiday management (added 2026-10-30)

- The holiday API accepts an array of holidays and upserts each one; the UI lets an administrator add multiple holidays in one dialog.
- The holiday date/name pair remains the merge key; existing paid flags are updated on conflict.

## Payslip details (added 2026-10-30)

- The payslip now displays employee identity and statutory identifiers: PAN, UAN, ESIC number, email, bank account, and IFSC, alongside joining/relieving dates, department, and designation.
- These fields are populated from the employee record and respect the same role visibility rules as the employee list.

## Field force punch in/out, customer master, and allowance rules (added 2026-11-02)

- **Punch in/out** (`travel_punch_events`): Employees capture a selfie from the live front camera and record GPS location for both punch-in and punch-out; saved photo uploads are not offered. The API requires a JPEG data URL and stores the face-verified flag as false because no biometric/liveness verification is implemented. Duplicate punches for the same direction on the same date are rejected with a 409 error.
- **Live maps**: Employees see their own large live route map while tracking. Admin/payroll users can view active employee locations on the Travel map; the API limits this data to those roles.
- **Customer/Doctor master** (`travel_customers`): Admin/HR can add, edit, and delete customer records (doctors, pharmacies, other) with name, type, location, lat/lng, territory, phone, and notes. Employees can view their assigned customers. This supports the DCR (Daily Call Report) visit workflow.
- **Expense bills** (`travel_expense_bills`): Admin/Payroll can attach photo receipts/bills to expense claims or journeys, with category, amount, description, and status tracking. This supports the TrackOlap-style expense bill upload workflow.
- **Per-employee allowance rules** (`travel_allowance_rules`): Admin/Payroll can override the global TA/DA settings per employee, effective from a specific date. Rules override the global `travel_settings` for that employee when active and effective. The `resolveAllowanceSettings` function in `calculator.js` applies these overrides.
- **Employee navigation**: The employee dashboard now includes "Punch In/Out" and "Customers" views, plus "My Travel" for journey tracking.

## Rule settings examples (added 2026-10-30)

- The settings API returns a `settingExamples` map computed from a sample CTC, showing what each editable constant produces (e.g. “basic = rounded gross × 0.50 → basic 8,425”).
- Examples are read-only reference text; they do not change calculation behavior.

## Configurable approval workflows

- Rule settings provide separate Attendance and Expense approval-chain editors. The UI configures ordered designation-based steps and can mark a step auto-approve. The initial workflow configuration has no approval levels; configured chains render as live vertical diagrams.
- Rule settings include designation suggestions and descriptions for Super Admin/HR Admin, Department Head, Regional Manager, Area Manager, Employee, Field Executive, and Administrator. This reference does not create approval levels. Employee records and linked Access control accounts display their designation; account roles remain separate from designations.
- Submissions bind to the active workflow and its first manual step. Auto-approve steps are skipped during sequential advancement. An empty or all-auto workflow rejects new submissions rather than silently approving them.
- An administrator cannot replace a workflow while requests are pending in it, preventing in-flight requests from being reassigned to changed levels.
- Expense rows display their configured hierarchy and current step. API routes enforce the current approver condition and preserve existing legacy requests without a workflow ID.
- Schema and cleanup live in `migrations/0019_approval_workflows.sql` and `migrations/0020_remove_unmodified_default_approval_levels.sql`.

## Security & Design Rules (added 2026-11-04)

See [SECURITY_DESIGN_RULES.md](./SECURITY_DESIGN_RULES.md) for the complete reference of mandatory security requirements and Kinetic Minimalism design system rules. This document must be consulted before any code implementation.
