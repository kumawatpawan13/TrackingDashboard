-- Field-force enhancements: employee detail dashboard, route playback with selfies,
-- attendance from customer visits, and security audit improvements.

-- Selfie tracking: store selfie photos with their journey context for security/audit
CREATE TABLE IF NOT EXISTS travel_selfies (
  id TEXT PRIMARY KEY,
  journey_id TEXT REFERENCES travel_journeys(id) ON DELETE CASCADE,
  punch_id TEXT REFERENCES travel_punch_events(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  image_data TEXT NOT NULL,  -- base64 JPEG data URL
  face_verified INTEGER NOT NULL DEFAULT 0 CHECK (face_verified IN (0, 1)),
  recorded_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Employee location audit: track all location lookups for privacy/security
CREATE TABLE IF NOT EXISTS employee_location_audits (
  id TEXT PRIMARY KEY,
  viewer_user_id TEXT NOT NULL REFERENCES users(id),
  viewer_role TEXT NOT NULL,
  target_employee_id TEXT NOT NULL REFERENCES employees(id),
  action TEXT NOT NULL CHECK (action IN ('view_route', 'view_selfies', 'view_live', 'view_journey')),
  reference_id TEXT,  -- journey_id or punch_id if applicable
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Attendance actions: link attendance entries to their source (manual, punch, or customer visit)
CREATE TABLE IF NOT EXISTS attendance_actions (
  attendance_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'punch', 'customer_visit')),
  reference_id TEXT,  -- punch event id or customer visit id
  action_by TEXT REFERENCES users(id),
  action_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT NOT NULL DEFAULT ''
);

-- Customer visit attendance tracking: when a DCR visit is completed and marked
-- Ensure travel_visits has employee_id column for attendance linkage
ALTER TABLE travel_visits ADD COLUMN employee_id TEXT REFERENCES employees(id);
ALTER TABLE travel_visits ADD COLUMN attendance_marked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE travel_visits ADD COLUMN attendance_date TEXT;  -- date the visit marks as attendance

-- Employee dashboard settings
CREATE TABLE IF NOT EXISTS employee_dashboard_settings (
  employee_id TEXT PRIMARY KEY REFERENCES employees(id),
  show_route_on_login INTEGER NOT NULL DEFAULT 0 CHECK (show_route_on_login IN (0, 1)),
  preferred_map_type TEXT NOT NULL DEFAULT 'road' CHECK (preferred_map_type IN ('road', 'satellite', 'hybrid')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Employee shift requests (future feature)
CREATE TABLE IF NOT EXISTS employee_shift_swaps (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  requested_shift_id TEXT REFERENCES travel_shifts(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Manager view preferences (saved viewport, filters)
CREATE TABLE IF NOT EXISTS manager_view_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  last_view TEXT NOT NULL DEFAULT 'dashboard',
  view_settings TEXT NOT NULL DEFAULT '{}',  -- JSON: filters, columns, sort order
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Route playback settings per employee
CREATE TABLE IF NOT EXISTS route_playback_settings (
  employee_id TEXT PRIMARY KEY REFERENCES employees(id),
  show_selfies INTEGER NOT NULL DEFAULT 1 CHECK (show_selfies IN (0, 1)),
  animate_weeks INTEGER NOT NULL DEFAULT 2000,  -- animation duration in ms
  color_by_status INTEGER NOT NULL DEFAULT 1,  -- color route by attendance status
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes (after all tables are created)
CREATE INDEX IF NOT EXISTS idx_selfies_employee ON travel_selfies(employee_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_selfies_journey ON travel_selfies(journey_id);
CREATE INDEX IF NOT EXISTS idx_selfies_punch ON travel_selfies(punch_id);

CREATE INDEX IF NOT EXISTS idx_location_audits_target ON employee_location_audits(target_employee_id, created_at);
CREATE INDEX IF NOT EXISTS idx_location_audits_viewer ON employee_location_audits(viewer_user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_attendance_actions_source ON attendance_actions(source_type);
CREATE INDEX IF NOT EXISTS idx_attendance_actions_attendance ON attendance_actions(attendance_id);

CREATE INDEX IF NOT EXISTS idx_visits_attendance ON travel_visits(employee_id, attendance_marked, visited_at);

-- Update the attendance_days source column comment via schema evolution
-- Note: source column already exists from migration 0012, this is documentation
-- Valid sources: '' (manual), 'punch' (punch-synced), 'customer_visit' (DCR visit)

-- Default employee dashboard settings for field force employees
INSERT OR IGNORE INTO employee_dashboard_settings (employee_id, show_route_on_login, preferred_map_type)
  SELECT id, 1, 'road' FROM employees WHERE id IN (SELECT employee_id FROM travel_journeys WHERE employee_id IS NOT NULL);

-- Ensure company_settings has dashboard display options
INSERT OR IGNORE INTO company_settings (setting_key, setting_value, description) VALUES
  ('show_route_playback', '1', 'Enable route playback view for employees'),
  ('enable_satellite_view', '1', 'Allow employees to switch to satellite map view'),
  ('track_selfie_views', '1', 'Log every selfie photo view for audit trail');
