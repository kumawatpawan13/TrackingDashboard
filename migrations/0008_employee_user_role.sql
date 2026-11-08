CREATE TABLE migration_0008_sessions_backup AS
SELECT token_hash, user_id, expires_at FROM sessions;

CREATE TABLE migration_0008_approvals_backup AS
SELECT id, approved_by
FROM travel_journeys
WHERE approved_by IS NOT NULL;

UPDATE travel_journeys SET approved_by = NULL WHERE approved_by IS NOT NULL;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'hr', 'payroll', 'employee')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  employee_id TEXT REFERENCES employees(id)
);

INSERT INTO users_new (id, username, password_salt, password_hash, role, created_at, employee_id)
SELECT id, username, password_salt, password_hash, role, created_at, employee_id
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE INDEX IF NOT EXISTS idx_users_employee_id ON users(employee_id);

INSERT INTO sessions (token_hash, user_id, expires_at)
SELECT token_hash, user_id, expires_at FROM migration_0008_sessions_backup;

UPDATE travel_journeys
SET approved_by = (
  SELECT approved_by FROM migration_0008_approvals_backup
  WHERE migration_0008_approvals_backup.id = travel_journeys.id
)
WHERE id IN (SELECT id FROM migration_0008_approvals_backup);

DROP TABLE migration_0008_sessions_backup;
DROP TABLE migration_0008_approvals_backup;
