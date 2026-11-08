-- Leave management system: leave types, accrual rules, balances, and requests.

CREATE TABLE IF NOT EXISTS leave_types (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  accrual_type TEXT NOT NULL DEFAULT 'monthly'
    CHECK (accrual_type IN ('monthly', 'annual', 'fixed', 'unlimited')),
  accrual_count REAL NOT NULL DEFAULT 0,
  accrual_cycle TEXT NOT NULL DEFAULT 'financial_year'
    CHECK (accrual_cycle IN ('financial_year', 'calendar_year', 'rolling', 'none')),
  encashable INTEGER NOT NULL DEFAULT 0 CHECK (encashable IN (0, 1)),
  max_per_year REAL,
  min_per_request REAL NOT NULL DEFAULT 0,
  max_consecutive REAL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS leave_balances (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  leave_type_id TEXT NOT NULL REFERENCES leave_types(id),
  year INTEGER NOT NULL,
  opening_balance REAL NOT NULL DEFAULT 0,
  accrued REAL NOT NULL DEFAULT 0,
  used REAL NOT NULL DEFAULT 0,
  encashed REAL NOT NULL DEFAULT 0,
  adjusted REAL NOT NULL DEFAULT 0,
  closing_balance REAL NOT NULL DEFAULT 0,
  UNIQUE (employee_id, leave_type_id, year)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  leave_type_id TEXT NOT NULL REFERENCES leave_types(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days REAL NOT NULL DEFAULT 1,
  half_day INTEGER NOT NULL DEFAULT 0 CHECK (half_day IN (0, 1)),
  half_day_period TEXT CHECK (half_day_period IN ('first', 'second')),
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS leave_holidays (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  holiday_date TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  paid INTEGER NOT NULL DEFAULT 1 CHECK (paid IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (holiday_date, name)
);

CREATE INDEX IF NOT EXISTS idx_leave_balances_employee ON leave_balances(employee_id, year);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id, start_date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON leave_requests(start_date, end_date);

-- Default leave types (India-standard)
INSERT OR IGNORE INTO leave_types (id, code, name, description, accrual_type, accrual_count, accrual_cycle, encashable, max_per_year, min_per_request, max_consecutive, color, active) VALUES
  ('lt-cl', 'CL', 'Casual Leave', 'Short-term leave for personal work or urgent matters.', 'monthly', 1, 'financial_year', 0, 12, 0.5, 3, '#6366f1', 1),
  ('lt-sl', 'SL', 'Sick Leave', 'Leave for illness, medical appointments, or family emergencies.', 'monthly', 1, 'financial_year', 0, 12, 0.5, 3, '#ef4444', 1),
  ('lt-lw', 'LW', 'Leave Without Pay', 'Unpaid leave for extended absence beyond available balance.', 'fixed', 0, 'none', 0, NULL, 0, NULL, '#6b7280', 1),
  ('lt-EL', 'EL', 'Earned Leave', 'Earned leave accrued based on months worked in the year.', 'annual', 2, 'financial_year', 1, 2, 1, 15, '#10b981', 1),
  ('lt-mat', 'MAT', 'Maternity Leave', 'Leave for new mothers after childbirth or adoption.', 'fixed', 0, 'none', 0, NULL, 1, 182, '#ec4899', 1),
  ('lt-pat', 'PAT', 'Paternity Leave', 'Leave for new fathers after childbirth.', 'fixed', 0, 'none', 0, NULL, 1, 15, '#8b5cf6', 1);