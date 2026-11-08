import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  DEFAULT_TRAVEL_SETTINGS,
  allowanceForDays,
  attendanceSummary,
  calculatePayroll,
  employeeComponents,
  excelRound,
  salarySlip,
  travelAllowance,
  travelAllowanceForDays
} from '../src/calculator.js';

const santosh = {
  id: 'EMP001',
  name: 'Workbook fixture',
  monthly_ctc: 19110,
  pf_applicable: 1,
  esic_applicable: 1
};

test('Excel rounding matches positive, negative, and decimal ROUND behavior', () => {
  assert.equal(excelRound(1.5), 2);
  assert.equal(excelRound(-1.5), -2);
  assert.equal(excelRound(1.235, 2), 1.24);
});

test('employee salary formulas match cached workbook values', () => {
  assert.deepEqual(employeeComponents(santosh), {
    gross: 16850,
    basic: 8425,
    hra: 3370,
    educationAllowance: 0,
    bonus: 702,
    otherAllowance: 4353,
    statutoryWageBase: 8425,
    statutoryWageAddback: 0,
    employeePf: 1011,
    employerPf: 1011,
    employeeEsic: 126,
    employerEsic: 548,
    professionalTax: 200,
    masterNetPayable: 14656
  });
});

test('payroll calculation reproduces workbook cached payroll row', () => {
  const attendance = Array(30).fill('P');
  const payroll = calculatePayroll(
    santosh,
    attendance,
    [],
    { reimbursement: 7756, advance_deduction: 0 },
    '2026-09'
  );

  assert.equal(payroll.daysInMonth, 30);
  assert.equal(payroll.paidDays, 30);
  assert.equal(payroll.ctc, 19110);
  assert.equal(payroll.gross, 16850);
  assert.equal(payroll.basic, 8425);
  assert.equal(payroll.hra, 3370);
  assert.equal(payroll.employeePf, 1011);
  assert.equal(payroll.employeeEsic, 126);
  assert.equal(payroll.professionalTax, 200);
  assert.equal(payroll.employerPf, 1011);
  assert.equal(payroll.employerEsic, 548);
  assert.equal(payroll.netPayable, 16214);
  assert.equal(payroll.finalPayable, 23970);
});

test('revision effective mid-month prorates old and new CTC as the workbook does', () => {
  const employee = { ...santosh, id: 'EMP003', monthly_ctc: 75000, pf_applicable: 1, esic_applicable: 0 };
  const revisions = [{
    employee_id: employee.id,
    effective_date: '2026-09-16',
    monthly_ctc: 45000,
    source_order: 1
  }];
  const payroll = calculatePayroll(employee, Array(30).fill('P'), revisions, {}, '2026-09');
  assert.equal(payroll.ctc, 60000);
});

test('attendance day totals and completion status preserve the workbook formula quirk', () => {
  const summary = attendanceSummary([
    ...Array(24).fill('P'),
    ...Array(4).fill('WO'),
    ...Array(2).fill('H')
  ], '2026-09');
  assert.equal(summary.paidDays, 30);
  assert.equal(summary.absentDays, 0);
  assert.equal(summary.noReportDays, 0);
  assert.equal(summary.status, 'Open / Check');
});

test('salary slip keeps the workbook labels and repeated employer contributions', () => {
  const payroll = calculatePayroll(santosh, Array(30).fill('P'), [], {}, '2026-09');
  const slip = salarySlip(santosh, payroll);
  assert.equal(slip.earnings[6][0], 'Statutory Wage Base (50% Rule)');
  assert.equal(slip.earnings[7][0], '50% Excess Add-back');
  assert.deepEqual(slip.deductions.map(([label]) => label), [
    'Employee PF', 'Employer PF', 'Employee ESIC', 'Employer ESIC', 'PT', 'Advance Deduction'
  ]);
  assert.equal(slip.deductions[1][1], 1011);
});

test('second populated payroll row matches the workbook cached result', () => {
  const employee = { ...santosh, id: 'EMP003', monthly_ctc: 75000, pf_applicable: 1, esic_applicable: 0 };
  const revisions = [{
    employee_id: employee.id,
    effective_date: '2026-09-16',
    monthly_ctc: 45000,
    source_order: 1
  }];
  const payroll = calculatePayroll(
    employee,
    Array(30).fill('P'),
    revisions,
    { reimbursement: 16425, advance_deduction: 0 },
    '2026-09'
  );
  assert.equal(payroll.ctc, 60000);
  assert.equal(payroll.gross, 68147);
  assert.equal(payroll.netPayable, 56200);
  assert.equal(payroll.finalPayable, 72625);
});

test('default calculation settings are the workbook values', () => {
  assert.equal(DEFAULT_SETTINGS.basic_pct, 0.5);
  assert.equal(DEFAULT_SETTINGS.hra_pct, 0.4);
  assert.equal(DEFAULT_SETTINGS.bonus_pct, 0.0833);
  assert.equal(DEFAULT_SETTINGS.statutory_wage_addback, 0);
});

test('approved travel adds TA per capped travel day and DA once per approved date', () => {
  assert.deepEqual(travelAllowanceForDays([10, 25, 0], DEFAULT_TRAVEL_SETTINGS), {
    ta: 175,
    da: 300,
    total: 475,
    payableKm: 35
  });
  assert.deepEqual(travelAllowance(250, DEFAULT_TRAVEL_SETTINGS), {
    ta: 1000,
    da: 150,
    total: 1150
  });
  assert.deepEqual(travelAllowanceForDays([250, 10], DEFAULT_TRAVEL_SETTINGS), {
    ta: 1050,
    da: 300,
    total: 1350,
    payableKm: 210
  });
  assert.deepEqual(travelAllowance(10, { ...DEFAULT_TRAVEL_SETTINGS, max_daily_km: 0 }), {
    ta: 0,
    da: 0,
    total: 0
  });
});

test('custom payroll earnings and deductions adjust final payable after the workbook net floor', () => {
  const attendance = Array(30).fill('P');
  const base = calculatePayroll(santosh, attendance, [], {}, '2026-09');
  const adjusted = calculatePayroll(
    santosh,
    attendance,
    [],
    {},
    '2026-09',
    DEFAULT_SETTINGS,
    { ta: 50, da: 150, total: 200 },
    [
      { id: 'one-off', label: 'Bonus', kind: 'earning', amount: 500 },
      { id: 'monthly', label: 'Loan recovery', kind: 'deduction', amount: 200, recurring: 1 }
    ]
  );
  const slip = salarySlip(santosh, adjusted);

  assert.equal(adjusted.netPayable, base.netPayable);
  assert.equal(adjusted.finalPayable, base.finalPayable + 500);
  assert.equal(adjusted.travelTa, 50);
  assert.equal(adjusted.travelDa, 150);
  assert.equal(adjusted.travelTotal, 200);
  assert.equal(adjusted.customEarnings, 500);
  assert.equal(adjusted.customDeductions, 200);
  assert.ok(slip.earnings.some(([label, amount]) => label === 'Bonus' && amount === 500));
  assert.ok(slip.deductions.some(([label, amount]) => label === 'Loan recovery' && amount === 200));
  assert.equal(slip.travelTa, 50);
  assert.equal(slip.travelDa, 150);

  const floored = calculatePayroll(
    santosh,
    attendance,
    [],
    {},
    '2026-09',
    DEFAULT_SETTINGS,
    0,
    [{ id: 'large-deduction', label: 'Large recovery', kind: 'deduction', amount: 100000 }]
  );
  assert.equal(floored.netPayable, base.netPayable);
  assert.equal(floored.finalPayable, 0);
});

test('allowanceForDays applies per-employee rules when effective', () => {
  const days = [{ date: '2026-01-10', km: 120 }, { date: '2026-01-15', km: 80 }];
  const base = allowanceForDays('EMP001', days, DEFAULT_TRAVEL_SETTINGS, []);
  // Global: 5/km, DA 150 when km >= 0 -> both days eligible.
  assert.equal(base.ta, excelRound(120 * 5 + 80 * 5, 2));
  assert.equal(base.da, 300);

  const rules = [{
    employee_id: 'EMP001',
    effective_from: '2026-01-01',
    ta_per_km: 8,
    da_daily: 250,
    min_daily_km: 50,
    max_daily_km: 150,
    active: 1
  }];
  const overridden = allowanceForDays('EMP001', days, DEFAULT_TRAVEL_SETTINGS, rules);
  assert.equal(overridden.ta, excelRound(120 * 8 + 80 * 8, 2));
  assert.equal(overridden.da, 500);

  // A rule effective after a date does not apply to that date.
  const lateRules = [{
    employee_id: 'EMP001',
    effective_from: '2026-01-20',
    ta_per_km: 8,
    da_daily: 250,
    min_daily_km: 50,
    max_daily_km: 150,
    active: 1
  }];
  const late = allowanceForDays('EMP001', days, DEFAULT_TRAVEL_SETTINGS, lateRules);
  assert.equal(late.ta, base.ta);
  assert.equal(late.da, base.da);

  // A different employee is unaffected.
  const other = allowanceForDays('EMP002', days, DEFAULT_TRAVEL_SETTINGS, rules);
  assert.equal(other.ta, base.ta);
  assert.equal(other.da, base.da);
});

test('allowanceForDays caps daily payable KM', () => {
  const days = [{ date: '2026-01-10', km: 500 }];
  const result = allowanceForDays('EMP001', days, DEFAULT_TRAVEL_SETTINGS, []);
  assert.equal(result.payableKm, DEFAULT_TRAVEL_SETTINGS.max_daily_km);
  assert.equal(result.ta, excelRound(DEFAULT_TRAVEL_SETTINGS.max_daily_km * DEFAULT_TRAVEL_SETTINGS.ta_per_km, 2));
});
