# Salary Desk

Editable employee, attendance, payroll, and salary-slip application built from the supplied Excel workbook. This workspace initially contained the workbook but no pre-existing application source, so this is a greenfield implementation.

## Workbook migration and formulas

Read [the Excel formula map](./docs/excel-formula-map.md) before approving or distributing payroll. The app preserves workbook-derived calculation behavior, including the workbook's repeated employer-contribution deductions and its payslip label mismatches. It does not interpret or certify Indian statutory rules.

To prepare the workbook data import:

```powershell
python scripts\export-workbook-data.py D:\Project\Salary_Application_new\Salary_Slip_Automation_Test.xlsx
```

Sign into the app as the administrator, open **Access control**, choose **Import converted workbook JSON**, and select `salary-workbook-import.json`. The importer reads saved worksheet values and skips formula cells whose cached results are absent; it does not recalculate formulas. The JSON includes employee banking/tax identifiers, so keep it private and delete it securely after import if it is no longer needed.

## Local development

Requirements: Node.js 24+ and npm. The Excel conversion script additionally needs Python 3.9+ and `openpyxl`.

```powershell
npm install
npm run dev
```

`npm run dev` checks JavaScript syntax and applies any pending migrations to the **local** D1 database automatically before starting Wrangler. To apply migrations without starting the app, run `npm run db:setup`; this command does not target production. Open the local URL printed by Wrangler. On first visit, create an administrator account with a unique password of at least 12 characters. The local D1 database is stored under `.wrangler/` and is ignored by git. Local data persists across app restarts.

## Features

- Employee create/edit/archive, with salary and statutory fields restricted to administrator/payroll roles.
- Effective-dated salary revisions, attendance by date, paid-holiday calendar, workbook-derived rules, monthly payroll adjustments, run statuses, reports, and payslips.
- Approved travel is included in payroll as separate TA and daily DA totals, calculated per employee/date with the configured daily KM cap. Manual TA/DA remains a separate input.
- Employee accounts must be linked to an employee record. Live tracking creates a visible in-progress travel entry for that employee; stopping submits it for approval, and approved distance is automatically included in that employee's payroll calculations.
- Payroll supports one-off and recurring earning/deduction items. These custom items adjust final payable after the workbook's net-pay calculation; recurring items can be stopped after a selected month.
- Calculations are centralized in `src/calculator.js`; changes to employees, rules, revisions, attendance, holidays, or manual payroll inputs are reflected in payroll and payslips when next loaded.
- Search and payroll CSV export.
- Administrator-only JSON backup/restore and workbook import.
- Administrator access control supports resetting a user's password (which signs out that user's active sessions) and removing other users. The signed-in administrator cannot remove their own account, and the final administrator account is protected.
- Print stylesheet for a printable payslip. Use the browser print dialog's **Save as PDF** option to download a PDF.
- **Punch in/out for field force**: Employees must capture a live selfie from the front camera for both punch-in and punch-out; saved photo uploads are not offered. GPS location is recorded and duplicate punches for the same direction on the same date are rejected. Admin/payroll users can view active employee locations on the Travel map; employees see their own live route.
- **Customer/Doctor master management**: Admin/HR can add, edit, and delete customer records (doctors, pharmacies, other) with location data for field visits.
- **Expense bill uploads**: Admin/Payroll can attach photo receipts/bills to expense claims with category, amount, and status tracking.
- **Per-employee allowance rules**: Override global TA/DA settings for individual employees, effective from a specific date.
- Roles: administrator (all features), HR (employee records without financial/tax/bank fields, attendance, and holidays), payroll (salary, revision, payroll, and payslip access), employee (self-service: punch in/out, view own travel/payslip/leave).

The workbook has attendance codes but no separate leave-balance or leave-approval model; CL/SL/L are recorded as paid attendance statuses. Biometric, GPS, shift-roster, employee self-service, statutory filing, bank payout, and tax-calculation integrations are not present in the workbook and are not represented as implemented features.

## Architecture

- Cloudflare Worker API (Hono) and static browser UI.
- Cloudflare D1 (SQLite) as the persistent relational source of truth; schema in `migrations/`.
- No third-party payroll or PDF services. Payslip PDF output uses the browser's built-in print-to-PDF flow.
- Authentication uses PBKDF2-SHA-256 password hashes (210,000 iterations) and random, hashed, expiring session tokens. Legacy 100,000-iteration password hashes are upgraded after a successful login. Cookies are `HttpOnly` and `SameSite=Strict`; production cookies are `Secure`. API mutations check same-origin requests. HR endpoints omit salary and sensitive statutory/bank fields.
- Payroll formulas in `src/calculator.js`; formula documentation and cached-result test vectors in `docs/excel-formula-map.md` and `test/`.

## Tests

```powershell
npm test
```

`npm run check` parses the Worker, calculator, and browser modules; development and deployment run this check automatically. Tests cover Excel rounding, source-derived employee components, saved workbook payroll examples, mid-month salary revision proration, attendance totals, payslip mappings, daily travel allowances, and custom payroll adjustments.

## Local password-recovery email

For local testing, copy `.dev.vars.example` to `.dev.vars` and fill in the Resend API key, a verified sender address, and a random `AUTH_OTP_SECRET` of at least 32 bytes. Wrangler loads `.dev.vars` for `npm run dev`; this file is ignored and must not be committed. Existing accounts need a recovery email configured in **Access control** or an email on their linked employee record.

Generate a secret with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

## Production setup

1. Create a Cloudflare account and install a D1 database:

   ```powershell
   npx wrangler login
   npx wrangler d1 create salary-payroll
   ```

2. Configure Wrangler's D1 binding to use the database ID from the create command. Apply remote migrations to that same database before deploying code that depends on the new schema:

   ```powershell
   npm run db:deploy
   ```

3. Configure the Resend sender and secrets for password recovery. Use a verified sender address and a randomly generated `AUTH_OTP_SECRET` of at least 32 bytes; enter each value at Wrangler's prompt rather than committing it:

   ```powershell
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put AUTH_EMAIL_FROM
   npx wrangler secret put AUTH_OTP_SECRET
   ```

   After deployment, add recovery emails to existing accounts in **Access control**. Employee accounts can also use the linked employee record's email. To request a reset, users can enter their username, employee ID, or the email address configured on their account.

4. Publish the app:

   ```powershell
   npm run deploy
   ```

5. Visit the generated `workers.dev` URL and create the first administrator. Employees can sign in with their username or linked employee ID. Restrict account access, use unique passwords, and do not put credentials in source files or deployment config.
6. Create and test an administrator JSON backup before importing business data or inviting payroll users.

If sign-in responds **“Invalid username or password”**, confirm the credentials or try the linked employee ID for an employee account. This response does not distinguish an unknown account from a wrong password. If it responds **“Sign-in is temporarily unavailable”**, check the Wrangler/Worker logs for `Login request failed`, then verify the Worker and `npm run db:deploy` use the same D1 database and that all migrations are applied. Production resources were not verified from this repository.

The free-tier option has limits and is not an uptime or backup guarantee. Cloudflare's published Workers Free limits include 100,000 requests/day and 10 ms CPU per invocation; D1 Free includes up to 5 million rows read/day, 100,000 rows written/day, 500 MB per database, and seven days of Time Travel. Time Travel is not an independent long-term backup. Keep encrypted off-platform backups and periodically test restore. A custom domain requires owning a domain; `workers.dev` is the no-domain-cost launch option.

Alternatives:

| Option | Useful free tier | Important limitations for payroll |
|---|---|---|
| Cloudflare Workers + D1 (this project) | Durable D1 storage, HTTPS, static assets and API within published quotas | Per-request CPU and database quotas; 500 MB free database cap and 7-day point-in-time recovery; no SLA for free tier. |
| Supabase Free | Managed PostgreSQL, 500 MB database and auth/storage features | Projects pause after one week of inactivity; 5 GB egress; do not assume production uptime or automatic free backups. |
| Render Free | Free web services and static sites; custom domains/TLS supported | Free web services sleep after 15 idle minutes and have an ephemeral filesystem; a local SQLite database is lost on restart/redeploy. Use an external database, not local files. |

Check current vendor limits before launch. A payroll system storing employee bank and tax identifiers should receive a security/privacy review and an independently tested backup plan before real production use. Free tiers may be suitable for pilots, not guaranteed production availability.

## Backup and recovery

- An administrator can download a JSON backup from **Access control**. It contains payroll data and employee identifiers but excludes password hashes and sessions; store it encrypted and restrict access.
- Restore from that screen using a previously downloaded backup. The restore is an upsert and does not delete records absent from the backup.
- For a Cloudflare-side export, use Wrangler's D1 export command and store the result separately from the service. Keep at least one encrypted off-platform copy and test restoration regularly.
- Cloudflare D1 Free Time Travel is limited to seven days; it is not a substitute for application-level exports.
- For local development, preserve `.wrangler/state/` or download an application backup before deleting local state.

## Documentation

| File | Purpose |
|---|---|
| `docs/PROJECT_CONTEXT.md` | Architecture, data flow, schema, features, and known limitations. Read this first in a new session. |
| `docs/DECISIONS.md` | Architectural and technical decisions, plus a log of corrective decisions from past sessions. |
| `docs/CHANGES.md` | What changed in each active development session, so you do not re-discover fixes. |
| `docs/excel-formula-map.md` | Workbook sheet data flow, migrated formulas, and cached-value test vectors. |
| `docs/website-launch-checklist.md` | SEO, analytics, HTTPS, mobile, and other website launch tasks. |

## Marketplace research and UX choices

Public vendor documentation for [Zoho Payroll](https://www.zoho.com/in/payroll/help/employer/basics/) describes employee records, payroll runs, reports, payslips, self-service, and a leave/attendance module with configurable leave types, holidays, work hours, and permissions ([leave and attendance](https://www.zoho.com/in/payroll/help/employer/leave-and-attendance/)). [greytHR payroll](https://www.greythr.com/payroll-software/) highlights configurable salary structures, payroll processing, and role-based access; its [attendance product](https://www.greythr.com/attendance-management-software/) highlights multiple capture methods, policies, shifts, and integration into leave/payroll.

The UI adopts the common high-value patterns (role-aware navigation, a month-scoped dashboard, editable employee and attendance tables, payroll review, explicit run status, and a printable employee payslip). This application does not reproduce vendor private interfaces or claim their integrations.
# TrackingDashboard
