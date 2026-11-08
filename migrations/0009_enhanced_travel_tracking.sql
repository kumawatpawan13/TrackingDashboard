-- Enhanced travel tracking: route history, stoppage detection, odometer verification, expense validation.

CREATE TABLE IF NOT EXISTS travel_route_points (
  id TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL REFERENCES travel_journeys(id) ON DELETE CASCADE,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  accuracy REAL,
  speed_kmh REAL,
  heading_deg REAL,
  recorded_at TEXT NOT NULL,
  distance_from_prev_km REAL NOT NULL DEFAULT 0,
  cumulative_km REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS travel_stoppages (
  id TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL REFERENCES travel_journeys(id) ON DELETE CASCADE,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  duration_minutes REAL NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  recorded_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS travel_odometer (
  id TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL REFERENCES travel_journeys(id) ON DELETE CASCADE,
  before_photo_url TEXT NOT NULL DEFAULT '',
  after_photo_url TEXT NOT NULL DEFAULT '',
  before_odometer_km REAL,
  after_odometer_km REAL,
  actual_km REAL,
  claimed_km REAL,
  discrepancy_km REAL,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  recorded_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS travel_expense_claims (
  id TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL REFERENCES travel_journeys(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  claimed_km REAL NOT NULL DEFAULT 0,
  approved_km REAL NOT NULL DEFAULT 0,
  ta_amount REAL NOT NULL DEFAULT 0,
  da_amount REAL NOT NULL DEFAULT 0,
  total_claim REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'adjusted')),
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS travel_route_plans (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  planned_date TEXT NOT NULL,
  planned_route TEXT NOT NULL DEFAULT '',
  planned_km REAL NOT NULL DEFAULT 0,
  actual_km REAL,
  deviation_km REAL,
  deviation_pct REAL,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_progress', 'completed', 'deviated')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_route_points_journey ON travel_route_points(journey_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_stoppages_journey ON travel_stoppages(journey_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_odometer_journey ON travel_odometer(journey_id);
CREATE INDEX IF NOT EXISTS idx_expense_claims_journey ON travel_expense_claims(journey_id);
CREATE INDEX IF NOT EXISTS idx_route_plans_employee_date ON travel_route_plans(employee_id, planned_date);