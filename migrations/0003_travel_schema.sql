-- Allow multiple journeys per employee per date (route playback, DCR visits).
-- The old UNIQUE(employee_id, travel_date) constraint is dropped so that
-- consecutive visits on the same day can each create their own journey row.
-- The notes column is already present from migration 0002.

CREATE TABLE IF NOT EXISTS travel_journeys_new (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  travel_date TEXT NOT NULL,
  start_lat REAL,
  start_lng REAL,
  end_lat REAL,
  end_lng REAL,
  start_time TEXT,
  end_time TEXT,
  gps_distance_km REAL NOT NULL DEFAULT 0,
  road_distance_km REAL NOT NULL DEFAULT 0,
  approved_distance_km REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  rejection_reason TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO travel_journeys_new (id, employee_id, travel_date, start_lat, start_lng, end_lat, end_lng,
  start_time, end_time, gps_distance_km, road_distance_km, approved_distance_km, status,
  approved_by, approved_at, rejection_reason, notes, created_at, updated_at)
SELECT id, employee_id, travel_date, start_lat, start_lng, end_lat, end_lng,
  start_time, end_time, gps_distance_km, road_distance_km, approved_distance_km, status,
  approved_by, approved_at, rejection_reason, COALESCE(notes, ''), created_at, updated_at
FROM travel_journeys;

DROP TABLE travel_journeys;
ALTER TABLE travel_journeys_new RENAME TO travel_journeys;

CREATE INDEX IF NOT EXISTS idx_journeys_employee_date ON travel_journeys(employee_id, travel_date);
CREATE INDEX IF NOT EXISTS idx_journeys_status ON travel_journeys(status);
CREATE INDEX IF NOT EXISTS idx_visits_journey ON travel_visits(journey_id, visited_at);
CREATE INDEX IF NOT EXISTS idx_audit_journey ON travel_audit_log(journey_id, created_at);