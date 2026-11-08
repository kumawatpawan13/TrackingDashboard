# PAGE_INVENTORY.md — Salary Desk

Generated: 2026-11-07 · Stage 1 audit

All 27 views live in `public/app.js`. Each is rendered by a `render*()` function into `#view-root`. Shell (nav + topbar) is built by `renderShell()`.

## Navigation groups (`NAV_GROUPS`, app.js:627)

| Group | Label | Views |
|-------|-------|-------|
| overview | Overview | `dashboard` (direct) |
| people | People | `employees`, `employee-detail`, `dashboard-kpis`, `users` |
| payroll | Payroll | `revisions`, `payroll`, `expenses`, `my-slip` |
| workforce | Workforce | `attendance`, `shifts`, `leave`, `holidays`, `my-approvals`, `my-attendance`, `my-leave`, `punch` |
| fieldOps | Field Operations | `tasks`, `samples`, `travel`, `route-playback`, `my-travel`, `my-route` |
| sales | Sales | `customers`, `orders` |
| settings | Settings | `settings` |

## Full view inventory

| # | View | Renderer | Module | Priority | Notes |
|---|------|----------|--------|----------|-------|
| 1 | `dashboard` | `renderDashboard` | overview | **P1** | KPIs, shortcuts, attendance totals |
| 2 | `employees` | `renderEmployees` | people | **P1** | Directory list + search |
| 3 | `employee-detail` | `renderEmployeeDetail` | people | **P1** | Largest view (app.js:3998); profile sections |
| 4 | `revisions` | `renderRevisions` | payroll | P2 | CTC history |
| 5 | `payroll` | `renderPayroll` | payroll | **P1** | Monthly calc, manual inputs, payslips |
| 6 | `travel` | `renderTravel` | fieldOps | P2 | Journeys, TA/DA, approvals |
| 7 | `expenses` | `renderExpenses` | payroll | **P1** | Claims, approval progress |
| 8 | `route-playback` | `renderRoutePlayback` | fieldOps | P3 | GPS routes + selfies |
| 9 | `holidays` | `renderHolidays` | workforce | P3 | Paid holiday list |
| 10 | `settings` | `renderSettings` | settings | P2 | Rule settings (4 tabs) |
| 11 | `users` | `renderUsers` | people | P3 | Access control |
| 12 | `leave` | `renderLeave` | workforce | P2 | Leave types/balances |
| 13 | `my-attendance` | `renderMyAttendance` | workforce | P3 | Self view |
| 14 | `my-approvals` | `renderMyApprovals` | workforce | P2 | Actionable approvals |
| 15 | `my-travel` | `renderMyTravel` | fieldOps | P3 | Self journeys |
| 16 | `my-slip` | `renderMySlip` | payroll | P3 | Self payslip |
| 17 | `my-leave` | `renderMyLeave` | workforce | P3 | Self leave |
| 18 | `my-route` | `renderMyRoute` | fieldOps | P3 | Self GPS |
| 19 | `punch` | `renderPunch` | workforce | P3 | Punch in/out |
| 20 | `customers` | `renderCustomers` | sales | P3 | Customer master |
| 21 | `samples` | `renderSamples` | fieldOps | P4 | TrackOlap |
| 22 | `orders` | `renderOrders` | sales | P4 | TrackOlap |
| 23 | `shifts` | `renderShifts` | workforce | P4 | TrackOlap |
| 24 | `tasks` | `renderTasks` | fieldOps | P4 | TrackOlap |
| 25 | `dashboard-kpis` | `renderDashboardKpis` | people | P3 | Manager KPIs |

Plus non-view UI: `authScreen()` (login/setup/recovery), `renderProfileModal()`, `openStyleFilterModal()`, `openModal()`.

## Shared UI patterns (all views)

- Page header: `viewTitle(title, description, actions)` → `.view-title-row` with `.view-title` + `.view-description` + `.actions`.
- Month selector: `.control.month-select` rendered conditionally for 9 views.
- Buttons: `.button` (+ `.primary`/`.ghost`/`.danger`/`.small`).
- Cards: `.cards` grid, `.card`, `.stat-card`, `.neumorphic-card`.
- Tables: `.table-wrap` > `table` with `.primary-cell`/`.muted`.
- Modals: `openModal(title, bodyHtml)` → `.modal-backdrop` > `.modal`.
- Forms: `.field`, `.control`, `.form-grid`, `.inline-actions`.

## Pages NOT yet implemented (spec mentions but code lacks)

- Breadcrumbs (mentioned in spec; no `.breadcrumb` exists).
- Sticky table headers (no `position: sticky` on `th`).
- Pagination (tables render all rows client-side).
- Department/regional analytics charts (no chart library loaded).
- Notification center (no notification view; `#toast` only).
- Compact approval progress indicators (hierarchy rendered inline per row).