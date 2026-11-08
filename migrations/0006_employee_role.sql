-- Add employee_id column to users table for linking employee accounts
ALTER TABLE users ADD COLUMN employee_id TEXT REFERENCES employees(id);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_employee_id ON users(employee_id);

-- Add role 'employee' to the allowed roles (handled in application code)