ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1));

CREATE TABLE access_roles (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE access_role_permissions (
  role_id TEXT NOT NULL REFERENCES access_roles(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  action_key TEXT NOT NULL CHECK (action_key IN (
    'view', 'create', 'edit', 'delete', 'approve', 'reject', 'export', 'manage'
  )),
  PRIMARY KEY (role_id, module_key, action_key)
);

CREATE TABLE user_access_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES access_roles(id) ON DELETE CASCADE,
  assigned_by TEXT REFERENCES users(id),
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE access_audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id),
  actor_username TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  old_values TEXT,
  new_values TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE approval_workflow_levels ADD COLUMN approver_source TEXT NOT NULL DEFAULT 'assigned_role'
  CHECK (approver_source IN ('assigned_role', 'designation', 'reporting_manager', 'hierarchy'));
ALTER TABLE approval_workflow_levels ADD COLUMN minimum_amount REAL CHECK (minimum_amount IS NULL OR minimum_amount >= 0);
ALTER TABLE approval_workflow_levels ADD COLUMN maximum_amount REAL CHECK (maximum_amount IS NULL OR maximum_amount >= 0);

CREATE INDEX idx_user_access_roles_role ON user_access_roles(role_id, user_id);
CREATE INDEX idx_access_role_permissions_module ON access_role_permissions(module_key, action_key, role_id);
CREATE INDEX idx_access_audit_target ON access_audit_log(target_type, target_id, created_at);
CREATE INDEX idx_access_audit_actor ON access_audit_log(actor_user_id, created_at);

INSERT INTO access_roles (id, code, name, description, is_system) VALUES
  ('role-super-admin', 'super_admin', 'Super Admin', 'Full company and access-control administration.', 1),
  ('role-hr-admin', 'hr_admin', 'HR Admin', 'Employee and HR administration across the company.', 1),
  ('role-department-head', 'department_head', 'Department Head', 'Access limited to the assigned department.', 1),
  ('role-regional-manager', 'regional_manager', 'Regional Manager', 'Access limited to the assigned region and reporting tree.', 1),
  ('role-area-manager', 'area_manager', 'Area Manager', 'Access limited to the assigned area and reporting tree.', 1),
  ('role-finance', 'finance', 'Finance', 'Payroll and approved financial operations.', 1),
  ('role-employee', 'employee', 'Employee / Field Executive', 'Self-service access to the linked employee record.', 1);

WITH modules(module_key) AS (VALUES
  ('dashboard'), ('employees'), ('salary-revisions'), ('payroll'), ('attendance'),
  ('leave-management'), ('holidays'), ('shifts'), ('field-tasks'), ('sample-tracking'),
  ('travel'), ('route-playback'), ('expenses'), ('customers'), ('chemist-orders'),
  ('reports'), ('rule-settings'), ('access-control')
), actions(action_key) AS (VALUES
  ('view'), ('create'), ('edit'), ('delete'), ('approve'), ('reject'), ('export'), ('manage')
)
INSERT INTO access_role_permissions (role_id, module_key, action_key)
SELECT 'role-super-admin', module_key, action_key FROM modules CROSS JOIN actions;

WITH modules(module_key) AS (VALUES
  ('dashboard'), ('employees'), ('attendance'), ('leave-management'), ('holidays'),
  ('shifts'), ('field-tasks'), ('sample-tracking'), ('travel'), ('route-playback'),
  ('expenses'), ('customers'), ('chemist-orders'), ('reports'), ('rule-settings')
), actions(action_key) AS (VALUES
  ('view'), ('create'), ('edit'), ('approve'), ('reject'), ('export')
)
INSERT INTO access_role_permissions (role_id, module_key, action_key)
SELECT 'role-hr-admin', module_key, action_key FROM modules CROSS JOIN actions;

INSERT INTO access_role_permissions (role_id, module_key, action_key) VALUES
  ('role-department-head', 'employees', 'view'),
  ('role-department-head', 'attendance', 'view'),
  ('role-department-head', 'attendance', 'approve'),
  ('role-department-head', 'attendance', 'reject'),
  ('role-department-head', 'leave-management', 'view'),
  ('role-department-head', 'leave-management', 'approve'),
  ('role-department-head', 'leave-management', 'reject'),
  ('role-department-head', 'expenses', 'view'),
  ('role-department-head', 'expenses', 'approve'),
  ('role-department-head', 'expenses', 'reject'),
  ('role-regional-manager', 'employees', 'view'),
  ('role-regional-manager', 'attendance', 'view'),
  ('role-regional-manager', 'attendance', 'approve'),
  ('role-regional-manager', 'attendance', 'reject'),
  ('role-regional-manager', 'leave-management', 'view'),
  ('role-regional-manager', 'leave-management', 'approve'),
  ('role-regional-manager', 'leave-management', 'reject'),
  ('role-regional-manager', 'expenses', 'view'),
  ('role-regional-manager', 'expenses', 'approve'),
  ('role-regional-manager', 'expenses', 'reject'),
  ('role-area-manager', 'employees', 'view'),
  ('role-area-manager', 'attendance', 'view'),
  ('role-area-manager', 'attendance', 'approve'),
  ('role-area-manager', 'attendance', 'reject'),
  ('role-area-manager', 'leave-management', 'view'),
  ('role-area-manager', 'leave-management', 'approve'),
  ('role-area-manager', 'leave-management', 'reject'),
  ('role-area-manager', 'expenses', 'view'),
  ('role-area-manager', 'expenses', 'approve'),
  ('role-area-manager', 'expenses', 'reject'),
  ('role-finance', 'payroll', 'view'),
  ('role-finance', 'payroll', 'edit'),
  ('role-finance', 'payroll', 'approve'),
  ('role-finance', 'expenses', 'view'),
  ('role-finance', 'expenses', 'approve'),
  ('role-finance', 'expenses', 'reject'),
  ('role-finance', 'expenses', 'edit'),
  ('role-finance', 'salary-revisions', 'view'),
  ('role-finance', 'reports', 'view'),
  ('role-finance', 'reports', 'export'),
  ('role-employee', 'dashboard', 'view'),
  ('role-employee', 'employees', 'view'),
  ('role-employee', 'attendance', 'view'),
  ('role-employee', 'attendance', 'create'),
  ('role-employee', 'leave-management', 'view'),
  ('role-employee', 'leave-management', 'create'),
  ('role-employee', 'travel', 'view'),
  ('role-employee', 'travel', 'create'),
  ('role-employee', 'expenses', 'view'),
  ('role-employee', 'expenses', 'create'),
  ('role-employee', 'customers', 'view'),
  ('role-employee', 'chemist-orders', 'view');

INSERT INTO user_access_roles (user_id, role_id)
SELECT id,
  CASE role
    WHEN 'admin' THEN 'role-super-admin'
    WHEN 'hr' THEN 'role-hr-admin'
    WHEN 'payroll' THEN 'role-finance'
    ELSE 'role-employee'
  END
FROM users;

INSERT INTO access_role_permissions (role_id, module_key, action_key) VALUES
  ('role-hr-admin', 'rule-settings', 'manage');
