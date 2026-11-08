-- Field-force extensions: sample tracking, chemist order booking,
-- shift/roster management, field task management, and manager dashboard KPIs.
-- These tables complete the TrackOlap-style feature set on top of the
-- existing travel/punch/attendance infrastructure.

-- Sample / promotional input tracking with batch numbers.
CREATE TABLE IF NOT EXISTS travel_samples (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  customer_id TEXT REFERENCES travel_customers(id),
  sample_name TEXT NOT NULL,
  batch_number TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  unit TEXT NOT NULL DEFAULT 'piece',
  allocated_at TEXT NOT NULL,
  returned_at TEXT,
  status TEXT NOT NULL DEFAULT 'allocated'
    CHECK (status IN ('allocated', 'returned', 'consumed', 'lost')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Product catalog for chemist order booking.
CREATE TABLE IF NOT EXISTS travel_products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT,
  category TEXT NOT NULL DEFAULT 'medicine',
  unit_price REAL NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  scheme_tag TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Chemist order booking: one-tap capture, automatic stockist dispatch.
CREATE TABLE IF NOT EXISTS travel_chemist_orders (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  customer_id TEXT REFERENCES travel_customers(id),
  order_date TEXT NOT NULL,
  total_amount REAL NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'dispatched', 'delivered', 'cancelled')),
  dispatch_sms_sent INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_sms_sent IN (0, 1)),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Order line items linking products to chemist orders.
CREATE TABLE IF NOT EXISTS travel_chemist_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES travel_chemist_orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES travel_products(id),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  unit_price REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Shift / roster definitions for attendance planning.
CREATE TABLE IF NOT EXISTS travel_shifts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  lunch_break_minutes INTEGER NOT NULL DEFAULT 0,
  grace_in_minutes INTEGER NOT NULL DEFAULT 0,
  grace_out_minutes INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Employee shift assignments (roster).
CREATE TABLE IF NOT EXISTS travel_employee_shifts (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  shift_id TEXT NOT NULL REFERENCES travel_shifts(id),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Field task management: assign, track, and close field tasks.
CREATE TABLE IF NOT EXISTS travel_tasks (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  customer_id TEXT REFERENCES travel_customers(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  task_type TEXT NOT NULL DEFAULT 'visit'
    CHECK (task_type IN ('visit', 'order', 'sample', 'collection', 'other')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  due_date TEXT,
  completed_at TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Manager dashboard KPI snapshots (cached for fast dashboard loads).
CREATE TABLE IF NOT EXISTS travel_dashboard_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_date TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  metric_value REAL NOT NULL DEFAULT 0,
  employee_id TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (snapshot_date, metric_key, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_samples_employee ON travel_samples(employee_id, allocated_at);
CREATE INDEX IF NOT EXISTS idx_samples_customer ON travel_samples(customer_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON travel_products(active);
CREATE INDEX IF NOT EXISTS idx_orders_employee_date ON travel_chemist_orders(employee_id, order_date);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON travel_chemist_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON travel_chemist_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_shifts_active ON travel_shifts(active);
CREATE INDEX IF NOT EXISTS idx_employee_shifts_emp ON travel_employee_shifts(employee_id, effective_from);
CREATE INDEX IF NOT EXISTS idx_tasks_employee ON travel_tasks(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON travel_tasks(due_date, status);
CREATE INDEX IF NOT EXISTS idx_dashboard_snapshots_date ON travel_dashboard_snapshots(snapshot_date, metric_key);

-- Default shifts for India-standard field-force operations.
INSERT OR IGNORE INTO travel_shifts (id, name, start_time, end_time, lunch_break_minutes, grace_in_minutes, grace_out_minutes, active) VALUES
  ('shift-morning', 'Morning Shift', '09:00', '18:00', 60, 15, 15, 1),
  ('shift-afternoon', 'Afternoon Shift', '13:00', '22:00', 60, 15, 15, 1),
  ('shift-half-day', 'Half Day', '09:00', '14:00', 30, 15, 15, 1);