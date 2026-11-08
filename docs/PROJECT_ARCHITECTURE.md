# PROJECT_ARCHITECTURE.md — Salary Desk

Generated: 2026-11-07 · Stage 1 audit (read-only, no code modified)

## 1. Stack

| Layer | Technology | Evidence |
|-------|-----------|----------|
| Runtime | Cloudflare Workers (free tier) | `wrangler.toml` |
| Framework | Hono 4.10.4 | `src/index.js`, `package.json` |
| Database | Cloudflare D1 (SQLite) | `[[d1_databases]]` binding `DB`, migrations dir `migrations/` |
| Static assets | Worker `ASSETS` binding, SPA fallback | `not_found_handling = "single-page-application"` |
| Frontend | Vanilla JS, no bundler | `public/app.js` (5676 lines), `public/styles.css` (2682 lines) |
| Auth | Cookie-backed sessions, PBKDF2, Resend OTP | `src/index.js` auth routes |
| Dev tooling | Wrangler, Node built-in test runner | `package.json` scripts |

## 2. Repository layout

```
Salary_Application_new/
├── src/
│   ├── index.js        # Hono API: 6103 lines — all routes, auth, RBAC, D1 queries
│   └── calculator.js   # 496 lines — payroll math (workbook-derived)
├── public/
│   ├── index.html      # SPA shell
│   ├── app.js          # 5676 lines — all UI rendering, style filter engine
│   └── styles.css      # 2682 lines — design tokens, 16 UI styles, palettes
├── migrations/         # 22 SQL migrations (0001–0022)
├── test/               # 5 test files, Node built-in runner
├── docs/               # DESIGN_SYSTEM.md, PROJECT_CONTEXT.md, SECURITY_DESIGN_RULES.md, DECISIONS.md, CHANGES.md
├── scripts/            # export-workbook-data.py (openpyxl)
└── wrangler.toml
```

## 3. Backend architecture (`src/index.js`)

- Hono app with custom middleware: session cookie validation, role checks, input validation.
- Routes: `/api/session`, `/api/login`, `/api/logout`, `/api/register`, `/api/employees*`, `/api/attendance*`, `/api/payroll*`, `/api/travel*`, `/api/leave*`, `/api/expenses*`, `/api/settings*`, `/api/users*`, `/api/roles*`, `/api/organization*`, `/api/audit*`, `/api/recovery*`.
- D1 access via prepared statements; transactions used for approval + ledger writes.
- RBAC enforced at API layer (functional roles + module/action permissions, separate from account roles).
- Audit triggers protect approval/access rows from update/delete.

## 4. Frontend architecture (`public/app.js`)

- Single-page app; `state` object holds `view`, `month`, `user`, `stylePrefs`.
- `renderShell()` builds: `.navbar` (brand + category tabs + secondary subtab panels) → `.main` (`.topbar` + `.content#view-root`).
- `loadView()` dispatches to 27 render functions keyed by `state.view`.
- **Style Filter Engine** (`stylePrefs` + `applyStylePrefs()`): palette color derivation from `--palette-N-hsl` tokens, 16 UI styles via body classes, 6 bg motions, 10 hover motions, 4 speeds, 4 corners, 4 surfaces, light/dark mode. Persisted to `localStorage` (`salaryDeskStylePrefs`).
- Navigation: `NAV_GROUPS` (7 categories) with `direct` + `items` views, filtered by `visibleViews()`.

## 5. Data model (D1)

Core tables: `users`, `sessions`, `employees`, `salary_revisions`, `attendance_days`, `holidays`, `payroll_adjustments`, `payroll_component_definitions`, `payroll_recurring_items`, `payroll_one_off_items`, `travel_settings`, `travel_journeys`, `travel_live_sessions`, `travel_visits`, `travel_audit_log`, `payroll_settings`, `payroll_periods`, `travel_punch_events`, `travel_customers`, `travel_expense_bills`, `travel_allowance_rules`, `approval_workflows`, `approval_requests`, `access_roles`, `access_role_assignments`, `access_audit_log`, `admin_audit_log`.

## 6. Key integration points for redesign

- `applyStylePrefs()` is the single theme source of truth — every visual change must flow through it.
- `renderShell()` is the only place that builds nav/topbar — sidebar redesign touches here.
- `viewTitle()` / `.view-title-row` is the page-header pattern used by all 27 views.
- `renderEmployeeDetail()` (line 3998) is the largest single view — profile redesign target.
- `src/calculator.js` is off-limits for visual changes; payroll formulas must not change.

## 7. Known constraints

- No frontend framework/build step — changes are hand-edited in `app.js`/`styles.css`.
- No checked-in browser tests; Playwright/axe-core must be added.
- No CI workflow exists.
- Free-tier D1; `.wrangler/` local state is git-ignored and may contain sensitive payroll data.