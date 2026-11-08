-- 5-level reporting hierarchy + expense management with sequential approvals
-- TrackOlap-style: Area Manager → Regional Manager → Department Head → HR → Finance

-- ============================================================
-- Reporting hierarchy columns on employees
-- NOTE: designation, department, area already exist from migration 0001
-- ============================================================
ALTER TABLE employees ADD COLUMN reports_to TEXT REFERENCES employees(id);
ALTER TABLE employees ADD COLUMN hierarchy_level INTEGER NOT NULL DEFAULT 5
  CHECK (hierarchy_level IN (1, 2, 3, 4, 5));
ALTER TABLE employees ADD COLUMN region TEXT NOT NULL DEFAULT '';

-- ============================================================
-- Expense management tables
-- ============================================================
CREATE TABLE IF NOT EXISTS travel_expenses (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  expense_type TEXT NOT NULL CHECK (expense_type IN ('travel', 'food', 'hotel', 'fuel', 'toll', 'parking', 'accommodation', 'other')),
  amount REAL NOT NULL CHECK (amount >= 0),
  description TEXT NOT NULL DEFAULT '',
  expense_date TEXT NOT NULL,
  bill_photo TEXT,
  journey_id TEXT REFERENCES travel_journeys(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'area_approved', 'regional_approved', 'dept_approved', 'finance_approved', 'rejected', 'returned', 'paid')),
  current_approver_level INTEGER NOT NULL DEFAULT 4,
  rejection_reason TEXT,
  returned_reason TEXT,
  paid_at TEXT,
  paid_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Expense approval audit trail - one row per approval step
CREATE TABLE IF NOT EXISTS travel_expense_approvals (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES travel_expenses(id) ON DELETE CASCADE,
  approver_user_id TEXT NOT NULL REFERENCES users(id),
  approver_level INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approved', 'rejected', 'returned')),
  comments TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Odometer verification for travel expenses
CREATE TABLE IF NOT EXISTS travel_odometer (
  id TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL REFERENCES travel_journeys(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  before_odometer_km REAL NOT NULL DEFAULT 0,
  after_odometer_km REAL NOT NULL DEFAULT 0,
  actual_km REAL NOT NULL DEFAULT 0,
  claimed_km REAL NOT NULL DEFAULT 0,
  discrepancy_km REAL NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Attendance regularisation requests (missed punch, correction)
-- ============================================================
CREATE TABLE IF NOT EXISTS attendance_regularisation (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  work_date TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('missed_punch_in', 'missed_punch_out', 'incorrect_punch', 'late_in', 'early_out', 'other')),
  requested_status TEXT NOT NULL DEFAULT 'P',
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'area_approved', 'regional_approved', 'dept_approved', 'hr_finalised', 'rejected', 'returned')),
  current_approver_level INTEGER NOT NULL DEFAULT 4,
  rejection_reason TEXT,
  returned_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Attendance regularisation approval audit trail
CREATE TABLE IF NOT EXISTS attendance_regularisation_approvals (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES attendance_regularisation(id) ON DELETE CASCADE,
  approver_user_id TEXT NOT NULL REFERENCES users(id),
  approver_level INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approved', 'rejected', 'returned')),
  comments TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Leave request approval audit trail
-- ============================================================
CREATE TABLE IF NOT EXISTS leave_request_approvals (
  id TEXT PRIMARY KEY,
  leave_request_id TEXT NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  approver_user_id TEXT NOT NULL REFERENCES users(id),
  approver_level INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approved', 'rejected', 'returned')),
  comments TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_expenses_employee ON travel_expenses(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON travel_expenses(status, current_approver_level);
CREATE INDEX IF NOT EXISTS idx_expense_approvals ON travel_expense_approvals(expense_id, approver_level);
CREATE INDEX IF NOT EXISTS idx_odometer_journey ON travel_odometer(journey_id);
CREATE INDEX IF NOT EXISTS idx_att_reg_employee ON attendance_regularisation(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_att_reg_approvals ON attendance_regularisation_approvals(request_id, approver_level);
CREATE INDEX IF NOT EXISTS idx_leave_approvals ON leave_request_approvals(leave_request_id, approver_level);
CREATE INDEX IF NOT EXISTS idx_employees_reports_to ON employees(reports_to);
CREATE INDEX IF NOT EXISTS idx_employees_hierarchy ON employees(hierarchy_level, department, region, area);

-- ============================================================
-- Default hierarchy levels for existing employees
-- ============================================================
-- Level 5 = Employee / Field Executive (default)
-- Level 4 = Area Manager
-- Level 3 = Regional Manager
-- Level 2 = Department Head
-- Level 1 = Super Admin / HR Admin