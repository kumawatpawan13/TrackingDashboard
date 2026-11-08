# Project instructions

- This repository is **Salary Desk**, an Excel-based payroll application. If a request calls it “Status Board,” confirm that the intended repository is this one before adding project-specific behavior.
- Before making changes, consult [`docs/PROJECT_CONTEXT.md`](../docs/PROJECT_CONTEXT.md) for the architecture and [`docs/DECISIONS.md`](../docs/DECISIONS.md) for established decisions. For salary, payslip, attendance, or Excel-import work, also read [`docs/excel-formula-map.md`](../docs/excel-formula-map.md).
- Preserve existing workbook formulas, rounding, blank handling, labels, and documented anomalies unless the user explicitly authorizes a business-rule change. Do not infer statutory rules.
- Keep D1 as the persisted source of truth and route payroll calculations through `src/calculator.js`; avoid duplicated calculation logic in the UI or API.
- Enforce authorization in API routes, not only in UI navigation. Treat local D1 state, workbook imports, backups, and employee bank/tax fields as sensitive.
- Follow existing JavaScript modules, Hono, Wrangler, vanilla UI, and Node test-runner patterns. Avoid new dependencies unless necessary.
- Validate changes with the narrowest relevant check; run `npm test` for calculator/business-rule changes. Do not claim production deployment, legal compliance, or untested flows.
- Keep documentation aligned with source. Do not modify application behavior for documentation-only requests.
