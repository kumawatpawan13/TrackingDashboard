export const DEFAULT_SETTINGS = Object.freeze({
  basic_pct: 0.5,
  hra_pct: 0.4,
  bonus_pct: 0.0833,
  statutory_wage_pct: 0.5,
  statutory_wage_addback: 0,
  pf_rate: 0.12,
  pf_wage_cap: 15000,
  pf_ctc_threshold: 30000,
  esic_employee_rate: 0.0075,
  esic_employer_rate: 0.0325,
  esic_wage_cap: 21000,
  professional_tax: 200,
  pf_admin_charges_annual: 1800,
  ctc_factor_both: 1.13415,
  ctc_factor_pf_below: 1.10165,
  ctc_factor_pf_above: 1.07415,
  ctc_factor_esic_below: 1.07415,
  ctc_factor_esic_above: 1.04165
});

export const ATTENDANCE_CODES = Object.freeze({
  P: 'Present',
  R: 'Regularized',
  A: 'Absent',
  CL: 'Casual leave',
  SL: 'Sick leave',
  L: 'Leave',
  WO: 'Weekly off',
  H: 'Paid holiday'
});

const PAID_CODES = new Set(['P', 'R', 'CL', 'SL', 'WO', 'H']);
const LEAVE_CODES = new Set(['CL', 'SL', 'L']);
const UNPAID_LEAVE_CODES = new Set(['L']);

export function excelRound(value, digits = 0) {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  const scaled = Math.abs(value) * scale;
  const rounded = Math.floor(scaled + 0.5 + Number.EPSILON * scaled * 2);
  return Math.sign(value) * rounded / scale;
}

export function daysInMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

// Default status for a calendar day with no explicit attendance record.
// Unset weekdays default to Present, Sundays to Weekly off, paid dates to Holiday.
export function defaultAttendanceStatus(date, paidHolidays = []) {
  const holidaySet = new Set(paidHolidays);
  if (holidaySet.has(date)) return 'H';
  return new Date(`${date}T00:00:00Z`).getUTCDay() === 0 ? 'WO' : 'P';
}

// Reference examples for the Rule Settings panel, computed from a sample CTC
// so edited constants display live example outputs.
export function settingExamples(settings = DEFAULT_SETTINGS) {
  const sample = { monthly_ctc: 19110, pf_applicable: 1, esic_applicable: 1 };
  const c = employeeComponents(sample, settings);
  const money = (value) => Number(value || 0).toLocaleString('en-IN');
  return {
    basic_pct: `Example: gross ${money(c.gross)} × ${settings.basic_pct} → basic ${money(c.basic)}`,
    hra_pct: `Example: basic ${money(c.basic)} × ${settings.hra_pct} → HRA ${money(c.hra)}`,
    bonus_pct: `Example: basic ${money(c.basic)} × ${settings.bonus_pct} → bonus ${money(c.bonus)}`,
    statutory_wage_pct: `Reference-only: wage base is basic × ${settings.statutory_wage_pct}; add-back is zero.`,
    statutory_wage_addback: `Reference-only: source formula returns ${money(settings.statutory_wage_addback)}.`,
    pf_rate: `Example: basic ${money(c.basic)} (cap ${money(settings.pf_wage_cap)}) × ${settings.pf_rate} → PF ${money(c.employeePf)}`,
    pf_wage_cap: `Example: PF wage base is capped at ${money(settings.pf_wage_cap)} before applying ${settings.pf_rate}.`,
    pf_ctc_threshold: `Example: PF-only branch threshold is ${money(settings.pf_ctc_threshold)}.`,
    esic_employee_rate: `Example: gross ${money(c.gross)} × ${settings.esic_employee_rate} → employee ESIC ${money(c.employeeEsic)}`,
    esic_employer_rate: `Example: gross ${money(c.gross)} × ${settings.esic_employer_rate} → employer ESIC ${money(c.employerEsic)}`,
    esic_wage_cap: `Example: ESIC applies when gross ≤ ${money(settings.esic_wage_cap)}.`,
    professional_tax: `Example: PT ${money(settings.professional_tax)} when paid days > 0.`,
    ctc_factor_both: `Example: CTC ÷ ${settings.ctc_factor_both} → gross for PF+ESIC employees.`,
    ctc_factor_pf_below: `Example: CTC ÷ ${settings.ctc_factor_pf_below} for PF-only at/below threshold.`,
    ctc_factor_pf_above: `Example: (CTC − 1,800) ÷ ${settings.ctc_factor_pf_above} for PF-only above threshold.`,
    ctc_factor_esic_below: `Example: CTC ÷ ${settings.ctc_factor_esic_below} for ESIC-only at/below threshold.`,
    ctc_factor_esic_above: `Example: CTC ÷ ${settings.ctc_factor_esic_above} for none/above-threshold ESIC.`
  };
}

// Travel tracking helpers. Distances are stored in KM; only the approved,
// payable distance flows into payroll. GPS-recorded and map-estimated road
// distances are kept separately for audit.

export const DEFAULT_TRAVEL_SETTINGS = Object.freeze({
  ta_per_km: 5,
  da_daily: 150,
  min_daily_km: 0,
  max_daily_km: 200,
  road_vs_gps_tolerance: 1.15,
  gps_accuracy_m: 25,
  min_speed_kmh: 120
});

// Haversine great-circle distance between two lat/lng pairs, in KM.
export function haversineKm(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return 0;
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

// Validate a GPS point: coordinates must be plausible and accuracy good enough.
export function validGpsPoint(point, settings = DEFAULT_TRAVEL_SETTINGS) {
  if (!point) return false;
  const lat = Number(point.lat);
  const lng = Number(point.lng);
  const accuracy = Number(point.accuracy ?? 0);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (accuracy && accuracy > settings.gps_accuracy_m) return false;
  return true;
}

// Detect suspicious jumps: straight-line distance implies a speed above the
// configured threshold given the elapsed time in minutes.
export function suspiciousJump(lat1, lng1, lat2, lng2, minutes, settings = DEFAULT_TRAVEL_SETTINGS) {
  if (minutes <= 0) return false;
  const km = haversineKm(lat1, lng1, lat2, lng2);
  const speedKmh = (km / minutes) * 60;
  return speedKmh > settings.min_speed_kmh;
}

// Approved payable distance, capped per day and reconciled against the road
// distance when one is available.
export function approvedDistance(gpsKm, roadKm, settings = DEFAULT_TRAVEL_SETTINGS) {
  const base = roadKm > 0 ? Math.max(gpsKm, roadKm) : gpsKm;
  if (base <= 0) return 0;
  if (roadKm > 0 && roadKm > gpsKm * settings.road_vs_gps_tolerance) return 0;
  return Math.min(base, settings.max_daily_km);
}

// TA = approved KM × per-KM rate; DA added only when approved KM meets the
// minimum and the journey is approved.
export function travelAllowance(approvedKm, settings = DEFAULT_TRAVEL_SETTINGS) {
  if (approvedKm <= 0) return { ta: 0, da: 0, total: 0 };
  const payableKm = Math.min(approvedKm, settings.max_daily_km);
  if (payableKm <= 0) return { ta: 0, da: 0, total: 0 };
  const ta = excelRound(payableKm * settings.ta_per_km, 2);
  const da = payableKm >= settings.min_daily_km ? settings.da_daily : 0;
  return { ta, da, total: excelRound(ta + da, 2) };
}

// Resolve the effective travel allowance settings for an employee on a date.
// Per-employee allowance rules override the global travel_settings when they
// are active and effective on the given date; later rules win over earlier ones.
export function resolveAllowanceSettings(employeeId, date, travelSettings, employeeRules = []) {
  let settings = travelSettings;
  for (const rule of employeeRules) {
    if (rule.employee_id !== employeeId) continue;
    if (!rule.active) continue;
    if (rule.effective_from && rule.effective_from > date) continue;
    settings = {
      ta_per_km: Number(rule.ta_per_km),
      da_daily: Number(rule.da_daily),
      min_daily_km: Number(rule.min_daily_km),
      max_daily_km: Number(rule.max_daily_km)
    };
  }
  return settings;
}

// TA/DA for a single day's approved KM, using the resolved settings.
export function allowanceForDay(approvedKm, settings = DEFAULT_TRAVEL_SETTINGS) {
  return travelAllowance(approvedKm, settings);
}

export function travelAllowanceForDays(dailyApprovedKm, settings = DEFAULT_TRAVEL_SETTINGS) {
  const days = dailyApprovedKm.map((approvedKm) => travelAllowance(approvedKm, settings));
  const ta = excelRound(days.reduce((sum, day) => sum + day.ta, 0), 2);
  const da = excelRound(days.reduce((sum, day) => sum + day.da, 0), 2);
  const payableKm = excelRound(dailyApprovedKm.reduce(
    (sum, approvedKm) => sum + Math.min(Math.max(0, approvedKm), settings.max_daily_km),
    0
  ), 2);
  return { ta, da, total: excelRound(ta + da, 2), payableKm };
}

// TA/DA for one employee across several days, applying per-employee
// allowance rules when they are active and effective on each date.
// `days` is an array of { date, km }; `employeeRules` is the list of
// travel_allowance_rules rows for that employee.
export function allowanceForDays(employeeId, days, settings = DEFAULT_TRAVEL_SETTINGS, employeeRules = []) {
  const daily = days.map((day) => {
    const daySettings = resolveAllowanceSettings(employeeId, day.date, settings, employeeRules);
    return travelAllowance(Number(day.km || 0), daySettings);
  });
  const ta = excelRound(daily.reduce((sum, day) => sum + day.ta, 0), 2);
  const da = excelRound(daily.reduce((sum, day) => sum + day.da, 0), 2);
  const payableKm = excelRound(days.reduce(
    (sum, day) => sum + Math.min(Math.max(0, Number(day.km || 0)), settings.max_daily_km),
    0
  ), 2);
  return { ta, da, total: excelRound(ta + da, 2), payableKm };
}

export function attendanceSummary(statuses, month) {
  const dayCount = daysInMonth(month);
  let paidDays = 0;
  let absentDays = 0;
  let presentReportedDays = 0;
  let leaveDays = 0;
  let weeklyOffDays = 0;
  let holidayDays = 0;

  for (const status of statuses) {
    if (PAID_CODES.has(status)) paidDays += 1;
    if (UNPAID_LEAVE_CODES.has(status)) leaveDays += 1;
    if (LEAVE_CODES.has(status) && !UNPAID_LEAVE_CODES.has(status)) leaveDays += 1;
    if (status === 'A') absentDays += 1;
    if (status === 'P' || status === 'R') presentReportedDays += 1;
    if (status === 'WO') weeklyOffDays += 1;
    if (status === 'H') holidayDays += 1;
  }

  const noReportDays = dayCount - paidDays - absentDays;
  const complete = paidDays + absentDays + leaveDays + noReportDays + weeklyOffDays === dayCount;
  return {
    daysInMonth: dayCount,
    paidDays,
    absentDays,
    presentReportedDays,
    leaveDays,
    noReportDays,
    weeklyOffDays,
    holidayDays,
    status: complete ? 'Complete' : 'Open / Check'
  };
}

export function employeeComponents(employee, settings = DEFAULT_SETTINGS) {
  if (!employee || employee.monthly_ctc === null || employee.monthly_ctc === undefined || employee.monthly_ctc === '') {
    return null;
  }

  const ctc = Number(employee.monthly_ctc);
  const pf = Boolean(Number(employee.pf_applicable));
  const esic = Boolean(Number(employee.esic_applicable));
  let gross;

  if (pf && esic) {
    gross = ctc / settings.ctc_factor_both;
  } else if (pf) {
    gross = ctc / settings.ctc_factor_pf_below <= settings.pf_ctc_threshold
      ? ctc / settings.ctc_factor_pf_below
      : (ctc - settings.pf_admin_charges_annual) / settings.ctc_factor_pf_above;
  } else if (esic) {
    gross = ctc / settings.ctc_factor_esic_below <= settings.esic_wage_cap
      ? ctc / settings.ctc_factor_esic_below
      : (ctc - settings.pf_admin_charges_annual) / settings.ctc_factor_esic_above;
  } else {
    gross = ctc / settings.ctc_factor_esic_above;
  }

  gross = excelRound(gross);
  const basic = excelRound(gross * settings.basic_pct);
  const hra = excelRound(basic * settings.hra_pct);
  const educationAllowance = 0;
  const bonus = excelRound(basic * settings.bonus_pct);
  const otherAllowance = Math.max(0, excelRound(gross - basic - hra - educationAllowance - bonus));
  const employerPf = pf ? excelRound(Math.min(basic, settings.pf_wage_cap) * settings.pf_rate) : 0;
  const employeePf = employerPf;
  const eligibleEsic = esic && gross <= settings.esic_wage_cap;
  const employerEsic = eligibleEsic ? excelRound(gross * settings.esic_employer_rate) : 0;
  const employeeEsic = eligibleEsic ? excelRound(gross * settings.esic_employee_rate) : 0;
  const professionalTax = settings.professional_tax;
  const masterNetPayable = excelRound(
    gross + bonus - employeePf - employerPf - employeeEsic - employerEsic - professionalTax
  );

  return {
    gross,
    basic,
    hra,
    educationAllowance,
    bonus,
    otherAllowance,
    statutoryWageBase: excelRound(basic + settings.statutory_wage_addback),
    statutoryWageAddback: settings.statutory_wage_addback,
    employeePf,
    employerPf,
    employeeEsic,
    employerEsic,
    professionalTax,
    masterNetPayable
  };
}

function lastBySourceOrder(rows) {
  return rows.reduce((last, row) => (
    !last || Number(row.source_order || 0) >= Number(last.source_order || 0) ? row : last
  ), null);
}

export function ctcForPayrollMonth(employee, revisions, month, paidDays, settings = DEFAULT_SETTINGS) {
  const firstDay = `${month}-01`;
  const lastDay = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  const employeeRevisions = revisions
    .filter((revision) => revision.employee_id === employee.id)
    .sort((a, b) => Number(a.source_order || 0) - Number(b.source_order || 0));
  const inMonth = employeeRevisions.filter((revision) => (
    revision.effective_date >= firstDay && revision.effective_date <= lastDay
  ));
  let monthlyCtc;

  if (inMonth.length) {
    const lastRevisionInMonth = lastBySourceOrder(inMonth);
    const revisionDate = lastRevisionInMonth.effective_date;
    const priorRevision = lastBySourceOrder(
      employeeRevisions.filter((revision) => revision.effective_date < revisionDate)
    );
    const priorCtc = priorRevision ? Number(priorRevision.monthly_ctc) : Number(employee.monthly_ctc);
    const revisionCtcForDate = employeeRevisions
      .filter((revision) => revision.effective_date === revisionDate)
      .reduce((sum, revision) => sum + Number(revision.monthly_ctc), 0);
    const beforeDays = Math.max(
      0,
      (Date.parse(`${revisionDate}T00:00:00Z`) - Date.parse(`${firstDay}T00:00:00Z`)) / 86400000
    );
    const afterDays = daysInMonth(month) - beforeDays;
    monthlyCtc = (priorCtc * beforeDays + revisionCtcForDate * afterDays) / daysInMonth(month);
  } else {
    const effectiveRevision = lastBySourceOrder(
      employeeRevisions.filter((revision) => revision.effective_date <= lastDay)
    );
    monthlyCtc = effectiveRevision ? Number(effectiveRevision.monthly_ctc) : Number(employee.monthly_ctc);
  }

  const days = daysInMonth(month);
  return days === 0 ? 0 : excelRound(monthlyCtc * paidDays / days, 2);
}

export function calculatePayroll(
  employee,
  attendance,
  revisions,
  adjustment,
  month,
  settings = DEFAULT_SETTINGS,
  travelReimbursement = 0,
  payrollItems = []
) {
  const summary = attendanceSummary(attendance, month);
  const ratio = summary.daysInMonth === 0 ? 0 : summary.paidDays / summary.daysInMonth;
  const components = employeeComponents(employee, settings);
  const ctc = ctcForPayrollMonth(employee, revisions, month, summary.paidDays, settings);
  const prorate = (value) => excelRound((components?.[value] || 0) * ratio, 2);
  const reimbursement = Number(adjustment?.reimbursement || 0);
  const travel = typeof travelReimbursement === 'number'
    ? { ta: 0, da: 0, total: travelReimbursement }
    : travelReimbursement;
  const travelTa = Number(travel?.ta || 0);
  const travelDa = Number(travel?.da || 0);
  const travelTotal = Number(travel?.total || 0);
  const customItems = payrollItems.map((item) => ({
    id: item.id,
    label: item.label,
    kind: item.kind,
    amount: excelRound(Number(item.amount || 0), 2),
    recurring: Boolean(item.recurring)
  }));
  const customEarnings = excelRound(
    customItems.filter((item) => item.kind === 'earning').reduce((sum, item) => sum + item.amount, 0),
    2
  );
  const customDeductions = excelRound(
    customItems.filter((item) => item.kind === 'deduction').reduce((sum, item) => sum + item.amount, 0),
    2
  );
  const advanceDeduction = Number(adjustment?.advance_deduction || 0);
  const professionalTax = summary.paidDays === 0 ? 0 : settings.professional_tax;
  const gross = prorate('gross');
  const basic = prorate('basic');
  const hra = prorate('hra');
  const educationAllowance = prorate('educationAllowance');
  const bonus = prorate('bonus');
  const otherAllowance = prorate('otherAllowance');
  const employeePf = prorate('employeePf');
  const employeeEsic = prorate('employeeEsic');
  const employerPf = prorate('employerPf');
  const employerEsic = prorate('employerEsic');

  const netPayable = Math.max(0, excelRound(
    ctc - employeePf - employeeEsic - professionalTax - employerPf - employerEsic - advanceDeduction
  ));
  const finalPayable = excelRound(Math.max(
    0,
    netPayable + reimbursement + travelTotal + customEarnings - customDeductions
  ));

  return {
    month,
    employeeId: employee.id,
    employeeName: employee.name,
    ctc,
    ...summary,
    gross,
    basic,
    hra,
    educationAllowance,
    bonus,
    otherAllowance,
    reimbursement,
    travelTa,
    travelDa,
    travelTotal,
    customItems,
    customEarnings,
    customDeductions,
    employeePf,
    employeeEsic,
    professionalTax,
    employerPf,
    employerEsic,
    advanceDeduction,
    netPayable,
    finalPayable,
    calculatedCtc: excelRound(gross + bonus + employerPf + employerEsic, 2),
    ctcDifference: excelRound(ctc - (gross + bonus + employerPf + employerEsic), 2),
    payrollStatus: summary.paidDays === 0 ? 'No Paid Days' : 'Calculated'
  };
}

export function salarySlip(employee, payroll) {
  const earnings = [
    ['CTC', payroll.ctc],
    ['Gross Salary', payroll.gross],
    ['Basic', payroll.basic],
    ['HRA', payroll.hra],
    ['Educational Allowance', payroll.educationAllowance],
    ['Bonus', payroll.bonus],
    ['Statutory Wage Base (50% Rule)', payroll.otherAllowance],
    ['50% Excess Add-back', payroll.reimbursement],
    ['Travel Allowance (TA)', payroll.travelTa],
    ['Daily Allowance (DA)', payroll.travelDa],
    ...payroll.customItems
      .filter((item) => item.kind === 'earning')
      .map((item) => [item.label, item.amount]),
    ['Employer PF', payroll.employerPf],
    ['Employer ESIC', payroll.employerEsic]
  ];
  const deductions = [
    ['Employee PF', payroll.employeePf],
    ['Employer PF', payroll.employerPf],
    ['Employee ESIC', payroll.employeeEsic],
    ['Employer ESIC', payroll.employerEsic],
    ['PT', payroll.professionalTax],
    ['Advance Deduction', payroll.advanceDeduction],
    ...payroll.customItems
      .filter((item) => item.kind === 'deduction')
      .map((item) => [item.label, item.amount])
  ];
  return {
    employee: {
      id: employee.id,
      name: employee.name,
      joiningDate: employee.joining_date,
      relievingDate: employee.relieving_date,
      designation: employee.designation,
      department: employee.department,
      pan: employee.pan || '',
      uan: employee.uan || '',
      esicNumber: employee.esic_number || '',
      email: employee.email || '',
      bankAccount: employee.bank_account || '',
      ifsc: employee.ifsc || ''
    },
    month: payroll.month,
    paidDays: payroll.paidDays,
    daysInMonth: payroll.daysInMonth,
    leaveDays: payroll.leaveDays,
    absentDays: payroll.absentDays,
    presentReportedDays: payroll.presentReportedDays,
    weeklyOffDays: payroll.weeklyOffDays,
    holidayDays: payroll.holidayDays,
    earnings,
    deductions,
    totalDeduction: excelRound(deductions.reduce((sum, [, value]) => sum + value, 0)),
    netPayable: payroll.netPayable,
    reimbursement: payroll.reimbursement,
    travelTa: payroll.travelTa,
    travelDa: payroll.travelDa,
    travelTotal: payroll.travelTotal,
    customEarnings: payroll.customEarnings,
    customDeductions: payroll.customDeductions,
    finalPayable: payroll.finalPayable
  };
}
