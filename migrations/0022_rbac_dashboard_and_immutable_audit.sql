INSERT OR IGNORE INTO access_role_permissions (role_id, module_key, action_key)
SELECT id, 'dashboard', 'view'
FROM access_roles
WHERE code IN ('department_head', 'regional_manager', 'area_manager', 'finance');

CREATE TRIGGER IF NOT EXISTS prevent_access_audit_update
BEFORE UPDATE ON access_audit_log
BEGIN
  SELECT RAISE(ABORT, 'Access audit records are immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_access_audit_delete
BEFORE DELETE ON access_audit_log
BEGIN
  SELECT RAISE(ABORT, 'Access audit records are immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_expense_approval_update
BEFORE UPDATE ON travel_expense_approvals
BEGIN
  SELECT RAISE(ABORT, 'Expense approval history is immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_expense_approval_delete
BEFORE DELETE ON travel_expense_approvals
BEGIN
  SELECT RAISE(ABORT, 'Expense approval history is immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_attendance_approval_update
BEFORE UPDATE ON attendance_regularisation_approvals
BEGIN
  SELECT RAISE(ABORT, 'Attendance approval history is immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_attendance_approval_delete
BEFORE DELETE ON attendance_regularisation_approvals
BEGIN
  SELECT RAISE(ABORT, 'Attendance approval history is immutable');
END;
