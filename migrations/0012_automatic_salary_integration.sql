-- Automatic salary integration: punch-to-attendance, GPS distance from route
-- points, per-employee TA/DA rules in payroll, and approved expense-claim
-- TA/DA flowing into the monthly calculation.

-- Track which attendance days were auto-derived from punch events so a
-- subsequent manual attendance edit can override them. Empty string means
-- the day was entered by an administrator in the attendance grid.
ALTER TABLE attendance_days ADD COLUMN source TEXT NOT NULL DEFAULT ''
    CHECK (source IN ('', 'punch'));

CREATE INDEX IF NOT EXISTS idx_attendance_employee_source ON attendance_days(employee_id, work_date, source);