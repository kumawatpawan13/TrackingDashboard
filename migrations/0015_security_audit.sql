-- Security hardening: audit log table for admin action tracking.
-- travel_audit_log already exists from migration 0002 with columns:
--   id, journey_id, actor, action, field, from_value, to_value, created_at
-- This migration adds the security-audit columns the application code expects.

-- Add security audit columns that are missing from the original schema
ALTER TABLE travel_audit_log ADD COLUMN employee_id TEXT REFERENCES employees(id);
ALTER TABLE travel_audit_log ADD COLUMN details TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON travel_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_employee ON travel_audit_log(employee_id, created_at);
