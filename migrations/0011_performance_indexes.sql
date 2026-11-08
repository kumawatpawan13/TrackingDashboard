-- Performance indexes for query optimization

CREATE INDEX IF NOT EXISTS idx_salary_revisions_employee_date ON salary_revisions(employee_id, effective_date DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_employee_workdate ON attendance_days(employee_id, work_date);

CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_month ON payroll_adjustments(payroll_month);

CREATE INDEX IF NOT EXISTS idx_payroll_recurring_employee_component ON payroll_recurring_items(employee_id, component_id);

CREATE INDEX IF NOT EXISTS idx_travel_expense_claims_employee_status ON travel_expense_claims(employee_id, status);

CREATE INDEX IF NOT EXISTS idx_leave_balances_year_type ON leave_balances(year, leave_type_id);