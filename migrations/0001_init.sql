CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'hr', 'payroll')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  designation TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  joining_date TEXT,
  relieving_date TEXT,
  monthly_ctc REAL NOT NULL CHECK (monthly_ctc >= 0),
  pf_applicable INTEGER NOT NULL DEFAULT 0 CHECK (pf_applicable IN (0, 1)),
  esic_applicable INTEGER NOT NULL DEFAULT 0 CHECK (esic_applicable IN (0, 1)),
  pan TEXT NOT NULL DEFAULT '',
  uan TEXT NOT NULL DEFAULT '',
  esic_number TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  bank_account TEXT NOT NULL DEFAULT '',
  ifsc TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS salary_revisions (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  effective_date TEXT NOT NULL,
  monthly_ctc REAL NOT NULL CHECK (monthly_ctc >= 0),
  reason TEXT NOT NULL DEFAULT '',
  source_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS attendance_days (
  employee_id TEXT NOT NULL REFERENCES employees(id),
  work_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('P', 'R', 'A', 'CL', 'SL', 'L', 'WO', 'H', '')),
  PRIMARY KEY (employee_id, work_date)
);

CREATE TABLE IF NOT EXISTS holidays (
  id TEXT PRIMARY KEY,
  holiday_date TEXT NOT NULL,
  name TEXT NOT NULL,
  paid INTEGER NOT NULL DEFAULT 1 CHECK (paid IN (0, 1)),
  UNIQUE (holiday_date, name)
);

CREATE TABLE IF NOT EXISTS payroll_adjustments (
  employee_id TEXT NOT NULL REFERENCES employees(id),
  payroll_month TEXT NOT NULL,
  reimbursement REAL NOT NULL DEFAULT 0 CHECK (reimbursement >= 0),
  advance_deduction REAL NOT NULL DEFAULT 0 CHECK (advance_deduction >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (employee_id, payroll_month)
);

CREATE TABLE IF NOT EXISTS payroll_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value REAL NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS payroll_periods (
  payroll_month TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'approved', 'paid')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_employees_active_name ON employees(active, name);
CREATE INDEX IF NOT EXISTS idx_revisions_employee_date ON salary_revisions(employee_id, effective_date, source_order);
CREATE INDEX IF NOT EXISTS idx_attendance_date_status ON attendance_days(work_date, status);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(holiday_date);

INSERT OR IGNORE INTO payroll_settings (setting_key, setting_value, description) VALUES
  ('basic_pct', 0.5, 'Employee List: basic salary is 50% of calculated gross.'),
  ('hra_pct', 0.4, 'Employee List: HRA is 40% of basic.'),
  ('bonus_pct', 0.0833, 'Employee List: bonus provision is 8.33% of basic.'),
  ('statutory_wage_pct', 0.5, 'Workbook setting; no additional wage-base amount is calculated.'),
  ('statutory_wage_addback', 0, 'Employee List formula returns zero for the 50% excess add-back.'),
  ('pf_rate', 0.12, 'PF contribution rate used by the workbook.'),
  ('pf_wage_cap', 15000, 'PF contribution wage cap used by the workbook.'),
  ('pf_ctc_threshold', 30000, 'CTC-to-gross branch threshold for PF-applicable employees.'),
  ('esic_employee_rate', 0.0075, 'Employee ESIC rate used by the workbook.'),
  ('esic_employer_rate', 0.0325, 'Employer ESIC rate used by the workbook.'),
  ('esic_wage_cap', 21000, 'ESIC eligibility threshold used by the workbook.'),
  ('professional_tax', 200, 'Professional tax amount used by the workbook.'),
  ('ctc_factor_both', 1.13415, 'CTC-to-gross divisor when PF and ESIC both apply.'),
  ('ctc_factor_pf_below', 1.10165, 'CTC-to-gross divisor for PF-only CTC at or below its threshold.'),
  ('ctc_factor_pf_above', 1.07415, 'CTC-to-gross divisor for PF-only CTC above its threshold.'),
  ('ctc_factor_esic_below', 1.07415, 'CTC-to-gross divisor for ESIC-only CTC at or below its threshold.'),
  ('ctc_factor_esic_above', 1.04165, 'CTC-to-gross divisor for ESIC-only CTC above its threshold.');
