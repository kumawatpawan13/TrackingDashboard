-- Admin audit log for security requirement 12
-- Tracks all admin actions for accountability

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES users(id),
  admin_username TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_log(admin_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log(action, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_log(target_type, target_id);