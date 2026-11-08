# Excel workbook calculation map

Source reviewed: `Salary_Slip_Automation_Test.xlsx` in the workspace. The workbook contains 10 worksheets, 17,595 formula cells, 327 defined names, and saved results in the formula cells. Formula results below are migrated in `src/calculator.js`; the importer reads saved cell values only and never executes Excel formulas.

## Workbook flow

`Employee List` is the salary-structure source. `Salary Revision` supplies effective-dated CTC values. `Attendance` provides monthly day statuses and paid days. `Holiday List` drives generated holiday statuses. `Payroll` prorates CTC and salary components, applies manual reimbursements and advance deductions, and calculates net/final payable. `Salary Slip` displays values selected from payroll. `Rule Settings` stores a small subset of percentages; other formula constants are hardcoded in the workbook. `Original Data Backup`, `Slip Lists`, and `Attendance Lists` are legacy values/lookups rather than calculation sources.

## Employee List formulas

Active employee rows use the following formulas, with Excel `ROUND` behavior:

| Column | Meaning | Formula behavior |
|---|---|---|
| AB | Gross salary | Derive from CTC and PF/ESIC eligibility using the divisors below, then round to whole rupees. |
| K | Basic | `ROUND(AB * 50%, 0)` |
| L | HRA | `ROUND(K * 40%, 0)` |
| M | Education allowance | Zero when gross exists. |
| N / X | Bonus | `ROUND(K * 8.33%, 0)` |
| O | Other allowance | `MAX(0, ROUND(AB - K - L - M - N, 0))` |
| AC / AG | Employer / employee PF | If PF applies, `ROUND(MIN(K, 15000) * 12%, 0)`; otherwise zero. |
| AD | Employer ESIC | If ESIC applies and gross is at most 21,000, `ROUND(AB * 3.25%, 0)`; otherwise zero. |
| AH | Employee ESIC | If ESIC applies and gross is at most 21,000, `ROUND(AB * 0.75%, 0)`; otherwise zero. |
| AI | Professional tax | 200 when gross exists. |
| Y / Z | Wage base / excess add-back | `Y = ROUND(K + Z, 0)`; `Z` is explicitly zero in the workbook. |
| P | Net payable preview | Active rows 4–5 subtract employee and employer PF/ESIC and PT from gross plus bonus. A blank template row 26 has a different formula. |
| AE / AF | CTC reconciliation | `AE = ROUND(AB + AC + AD + N, 0)`; `AF = ROUND(AE - H, 0)`. |
| AA | CTC check | The workbook formula subtracts the employee-entered CTC from the two bonus cells; it is not the AE/AF reconciliation. |

Gross derivation, where `H` is monthly CTC:

- PF and ESIC: `ROUND(H / 1.13415, 0)`.
- PF only: use `H / 1.10165` when that quotient is at most 30,000; otherwise use `(H - 1,800) / 1.07415`, then round.
- ESIC only: use `H / 1.07415` when that quotient is at most 21,000; otherwise use `(H - 1,800) / 1.04165`, then round.
- Neither: `ROUND(H / 1.04165, 0)`.

The `50% Wage Rule` in `Rule Settings` is not used to compute a positive add-back: the source add-back formula is zero. The application stores that observed zero as a setting rather than inventing a statutory interpretation.

## Salary Revision

Employee ID and employee name are linked to `Employee List`; previous CTC looks up the last earlier revision or falls back to employee CTC. Revision difference is `new CTC - previous CTC`. For the payroll month, a revision effective within the month is prorated by the number of calendar days before and from the effective date. Without an in-month revision, payroll uses the last revision effective on or before month-end, falling back to employee CTC. The formula uses worksheet row order for `LOOKUP`; the app retains import/source order for that behavior.

## Attendance and holidays

- Each month has a 31-day grid; dates beyond that month's calendar length are blank.
- Weekdays are input; Sundays are prefilled as `WO`; paid dates in `Holiday List` are prefilled as `H`. Manually saved attendance takes precedence over a generated default.
- Valid codes are `P`, `R`, `A`, `CL`, `SL`, `L`, `WO`, and `H`.
- Paid days count `P + R + CL + SL + L + WO + H`; absent days count `A`; leave counts `CL + SL + L`; present/reported counts `P + R`; no-report is calendar days minus paid days minus absent days.
- Completion status follows the workbook's formula, including its addition of leave days on top of a paid-day count that already includes leave. This can classify some leave months as `Open / Check`.
- Holiday year is derived from the holiday date. The workbook includes 300 holiday rows and defined attendance dropdown names from 2020 through 2035.

## Payroll

For each active employee:

1. `daysInMonth` is the calendar-day count; `paidDays` comes from Attendance.
2. CTC is selected/prorated using the Salary Revision rules above and multiplied by `paidDays / daysInMonth`; the result is rounded to two decimals.
3. Gross, basic, HRA, education, bonus, other allowance, employee PF/ESIC, and employer PF/ESIC are linked from Employee List and prorated by the same paid-day ratio, rounded to two decimals.
4. Professional tax is zero when paid days are zero; otherwise it is 200.
5. TA & DA / reimbursement (`N`) and advance deduction (`T`) are manual inputs. The application also keeps approved travel TA/DA separate from this manual field; it sums approved distance by employee/date, applies the daily cap, and adds DA once on each eligible date.
6. `Net Payable = MAX(0, ROUND(CTC - SUM(Employee PF, Employee ESIC, PT, Employer PF, Employer ESIC, Advance), 0))`.
7. `Final Payable = ROUND(MAX(0, Net Payable + Reimbursement), 0)`.
8. Reconciliation is `Calculated CTC = Gross + Bonus + Employer PF + Employer ESIC`; `CTC Difference = CTC - Calculated CTC`.

The formula's deduction range includes employer PF and ESIC. This exact behavior is preserved at the user's request; it is not a legal/payroll recommendation.

The application supports additional one-off or recurring earning/deduction items as an extension after the workbook calculation: they adjust `Final Payable`, while the workbook-derived `Net Payable` remains unchanged. This is not a migrated workbook formula.

## Salary Slip formula mapping and source anomalies

The slip selects employee identity/details from Employee List and sums Payroll values by selected month and employee. Its display labels and formulas are preserved exactly:

- “Statutory Wage Base (50% Rule)” reads Payroll `M` (Other Allowances).
- “50% Excess Add-back” reads Payroll `N` (TA & DA / reimbursement); the same amount is also displayed as TA & DA.
- Employer PF and employer ESIC each appear twice in the slip deduction list.
- Total Deduction sums rows 15–20, including those repeated employer contributions.
- Net Payable and Final Payable come from Payroll `U` and `V`.

These are observed label/formula mismatches. The app does not silently rename or reclassify them.

## Calculation verification fixtures

The checked workbook row for employee `EMP001` has saved results: CTC 19,110; gross 16,850; basic 8,425; HRA 3,370; bonus 702; employee PF 1,011; employee ESIC 126; employer PF 1,011; employer ESIC 548; PT 200; payroll net payable 16,214; TA & DA 7,756; final payable 23,970. Automated tests assert these values and an effective-date CTC prorating example.

The workbook contains two populated employee rows in its current Employee List and two populated attendance rows for September 2026; many other rows are formula/validation templates. Importing uses saved values and excludes formulas with no cached result.
