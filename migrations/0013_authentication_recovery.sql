ALTER TABLE users ADD COLUMN recovery_email TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS auth_recovery_challenges (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  salt TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  last_sent_at INTEGER NOT NULL
);
