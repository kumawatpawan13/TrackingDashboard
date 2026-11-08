-- Travel tracking for field-sales employees (TA/DA calculation).
-- Distances are stored in KM and represent the approved, payable distance.
-- GPS-recorded distance and map-estimated road distance are tracked separately
-- from the approved payable distance; only approved distance flows to payroll.

CREATE TABLE IF NOT EXISTS travel_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value REAL NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS travel_journeys (
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

CREATE TABLE IF NOT EXISTS travel_visits (
  id TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL REFERENCES travel_journeys(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  lat REAL,
  lng REAL,
  visited_at TEXT NOT NULL,
  distance_from_prev_km REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS travel_audit_log (
  id TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL REFERENCES travel_journeys(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  field TEXT NOT NULL DEFAULT '',
  from_value TEXT NOT NULL DEFAULT '',
  to_value TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_journeys_employee_date ON travel_journeys(employee_id, travel_date);
CREATE INDEX IF NOT EXISTS idx_journeys_status ON travel_journeys(status);
CREATE INDEX IF NOT EXISTS idx_visits_journey ON travel_visits(journey_id, visited_at);
CREATE INDEX IF NOT EXISTS idx_audit_journey ON travel_audit_log(journey_id, created_at);

INSERT OR IGNORE INTO travel_settings (setting_key, setting_value, description) VALUES
  ('ta_per_km', 5, 'Travel allowance per approved kilometre (INR).'),
  ('da_daily', 150, 'Daily allowance added when travel is approved (INR).'),
  ('min_daily_km', 0, 'Minimum approved KM required to trigger the daily DA.'),
  ('max_daily_km', 200, 'Maximum payable KM per day; excess is not reimbursed.'),
  ('road_vs_gps_tolerance', 1.15, 'Road distance may exceed GPS distance by at most this factor.'),
  ('gps_accuracy_m', 25, 'GPS readings worse than this (in metres) are rejected.'),
  ('min_speed_kmh', 120, 'Speed above this (KM/h) flags a suspicious GPS jump.');