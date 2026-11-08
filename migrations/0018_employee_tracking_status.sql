-- TrackOlap-style employee tracking status (live / idle / offline)
-- Adds a per-session status and last-seen timestamp so the Travel tab can
-- show all employees with their current state instead of only active GPS sessions.
ALTER TABLE travel_live_sessions
  ADD COLUMN status TEXT NOT NULL DEFAULT 'live';

ALTER TABLE travel_live_sessions
  ADD COLUMN last_point_at TEXT;

-- Keep an index on last_point_at so the status sort is cheap.
CREATE INDEX IF NOT EXISTS idx_travel_live_sessions_last_point
  ON travel_live_sessions (last_point_at DESC);