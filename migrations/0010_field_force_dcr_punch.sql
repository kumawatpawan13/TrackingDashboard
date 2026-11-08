-- Field-force extension: DCR doctor visits, customer master, punch in/out
-- with selfie + GPS, expense bill uploads, per-employee allowance rules,
-- and live-location sharing. The travel_visits table from migration 0002 is
-- reused for DCR visits; this migration adds the supporting tables.

CREATE TABLE IF NOT EXISTS travel_customers (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  name TEXT NOT NULL,
  customer_type TEXT NOT NULL DEFAULT 'doctor'
    CHECK (customer_type IN ('doctor', 'pharmacy', 'other')),
  location TEXT NOT NULL DEFAULT '',
  lat REAL,
  lng REAL,
  territory TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Punch in / punch out events. One row per punch; a working day has one
-- 'in' and one 'out'. Selfie and GPS are captured at punch time.
CREATE TABLE IF NOT EXISTS travel_punch_events (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  punch_date TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  lat REAL,
  lng REAL,
  accuracy REAL,
  selfie_url TEXT NOT NULL DEFAULT '',
  face_verified INTEGER NOT NULL DEFAULT 0 CHECK (face_verified IN (0, 1)),
  notes TEXT NOT NULL DEFAULT '',
  recorded_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (employee_id, punch_date, direction)
);

-- Expense bill / receipt uploads attached to a claim or a journey.
CREATE TABLE IF NOT EXISTS travel_expense_bills (
  id TEXT PRIMARY KEY,
  claim_id TEXT REFERENCES travel_expense_claims(id) ON DELETE CASCADE,
  journey_id TEXT REFERENCES travel_journeys(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  bill_date TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'travel',
  amount REAL NOT NULL DEFAULT 0 CHECK (amount >= 0),
  description TEXT NOT NULL DEFAULT '',
  photo_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Per-employee allowance-rule overrides. employee_id NULL = global default.
CREATE TABLE IF NOT EXISTS travel_allowance_rules (
  id TEXT PRIMARY KEY,
  employee_id TEXT REFERENCES employees(id),
  effective_from TEXT NOT NULL,
  ta_per_km REAL NOT NULL DEFAULT 5,
  da_daily REAL NOT NULL DEFAULT 150,
  min_daily_km REAL NOT NULL DEFAULT 0,
  max_daily_km REAL NOT NULL DEFAULT 200,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customers_employee ON travel_customers(employee_id, active);
CREATE INDEX IF NOT EXISTS idx_customers_territory ON travel_customers(territory);
CREATE INDEX IF NOT EXISTS idx_punch_employee_date ON travel_punch_events(employee_id, punch_date);
CREATE INDEX IF NOT EXISTS idx_expense_bills_claim ON travel_expense_bills(claim_id);
CREATE INDEX IF NOT EXISTS idx_expense_bills_employee ON travel_expense_bills(employee_id, bill_date);
CREATE INDEX IF NOT EXISTS idx_allowance_rules_employee ON travel_allowance_rules(employee_id, effective_from);