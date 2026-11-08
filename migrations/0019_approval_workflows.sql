-- ============================================================
-- Approval Workflow Configuration
-- Allows admins to configure configurable approval workflows
-- by request type (attendance, expenses, etc.)
-- ============================================================

-- Approval workflow configuration - defines the approval chain for each request type
CREATE TABLE IF NOT EXISTS approval_workflows (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6)))),
  request_type TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Approval levels within a workflow - defines each approver tier
-- order_index: 1 = highest approver (Finance), higher = closer to employee
-- The system auto-determined the next approver based on order_index
CREATE TABLE IF NOT EXISTS approval_workflow_levels (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6)))),
  workflow_id TEXT NOT NULL REFERENCES approval_workflows(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL CHECK (order_index >= 1),
  level_name TEXT NOT NULL,
  role_required TEXT,
  designation_required TEXT,
  min_hierarchy_level INTEGER DEFAULT 5 CHECK (min_hierarchy_level IN (1, 2, 3, 4, 5)),
  auto_approve BOOLEAN NOT NULL DEFAULT 0 CHECK (auto_approve IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workflow_id, order_index)
);

-- Create workflow records without preconfigured approval levels.
INSERT OR IGNORE INTO approval_workflows (request_type, name, description, is_active) VALUES
  ('expense', 'Expense Approval Workflow', 'Configure the approval levels for expense claims', 1);

INSERT OR IGNORE INTO approval_workflows (request_type, name, description, is_active) VALUES
  ('attendance', 'Attendance Correction Workflow', 'Configure the approval levels for attendance regularisation requests', 1);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_approvals_workflow_active ON approval_workflows(request_type, is_active);
CREATE INDEX IF NOT EXISTS idx_approval_levels_order ON approval_workflow_levels(workflow_id, order_index);

-- ============================================================
-- Update travel_expenses to use configurable approval levels
-- ============================================================

-- Add column to track which workflow is applied to each expense
ALTER TABLE travel_expenses ADD COLUMN approval_workflow_id TEXT REFERENCES approval_workflows(id);

-- ============================================================
-- Update attendance_regularisation to use configurable approval levels
-- ============================================================

-- Add column to track which workflow is applied to each request
ALTER TABLE attendance_regularisation ADD COLUMN approval_workflow_id TEXT REFERENCES approval_workflows(id);

-- ============================================================
-- Note on existing data migration
-- ============================================================
-- Existing expenses with current_approver_level = 4 (Area Manager) through 0 (Finance)
-- are mapped to the new workflow system. The level values correspond to:
-- Level 4 = Area Manager, Level 3 = Regional Manager, Level 2 = Department Head
-- Level 1 = HR Admin, Level 0 = Finance
-- This maps to order_index 5 through 1 in the new workflow_levels table.

-- ============================================================
-- Add approver tracking columns to existing tables
-- ============================================================
ALTER TABLE travel_expenses ADD COLUMN current_approver_name TEXT;

-- ============================================================
-- Create view for expense approval chain with approver names
-- ============================================================
CREATE VIEW IF NOT EXISTS expense_approval_chain AS
SELECT
  e.id AS expense_id,
  e.employee_id,
  emp.name AS employee_name,
  e.amount,
  e.expense_type,
  e.status,
  e.current_approver_level,
  e.current_approver_name,
  w.name AS workflow_name,
  wl.level_name,
  wl.role_required,
  al.action AS latest_action,
  al.comments AS latest_comments,
  al.created_at AS action_timestamp,
  u.username AS approver_username
FROM travel_expenses e
JOIN employees emp ON e.employee_id = emp.id
LEFT JOIN approval_workflows w ON e.approval_workflow_id = w.id
LEFT JOIN approval_workflow_levels wl ON w.id = wl.workflow_id AND wl.order_index = (5 - e.current_approver_level + 1)
LEFT JOIN travel_expense_approvals al ON e.id = al.expense_id AND al.created_at IS NOT NULL
  AND al.created_at = (SELECT MAX(created_at) FROM travel_expense_approvals WHERE expense_id = e.id)
LEFT JOIN users u ON al.approver_user_id = u.id
ORDER BY e.created_at DESC;