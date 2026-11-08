CREATE TABLE IF NOT EXISTS payroll_component_definitions (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL COLLATE NOCASE,
  kind TEXT NOT NULL CHECK (kind IN ('earning', 'deduction')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (label, kind)
);

CREATE TABLE IF NOT EXISTS payroll_recurring_items (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  component_id TEXT NOT NULL REFERENCES payroll_component_definitions(id),
  amount REAL NOT NULL CHECK (amount >= 0),
  start_month TEXT NOT NULL,
  end_month TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_month IS NULL OR end_month >= start_month)
);

CREATE TABLE IF NOT EXISTS payroll_one_off_items (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  payroll_month TEXT NOT NULL,
  component_id TEXT REFERENCES payroll_component_definitions(id),
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('earning', 'deduction')),
  amount REAL NOT NULL CHECK (amount >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payroll_recurring_employee_month
  ON payroll_recurring_items(employee_id, start_month, end_month);
CREATE INDEX IF NOT EXISTS idx_payroll_one_off_employee_month
  ON payroll_one_off_items(employee_id, payroll_month);
