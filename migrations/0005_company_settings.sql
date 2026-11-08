-- Company and payslip configuration settings
CREATE TABLE IF NOT EXISTS company_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT ''
);

-- Default company and payslip settings
INSERT OR IGNORE INTO company_settings (setting_key, setting_value, description) VALUES
  ('company_name', 'Your Company Name', 'Company name displayed on payslips'),
  ('company_address', '', 'Company address displayed on payslips (multiline, use \\n for new lines)'),
  ('company_pan', '', 'Company PAN displayed on payslips'),
  ('company_tan', '', 'Company TAN displayed on payslips'),
  ('company_gstin', '', 'Company GSTIN displayed on payslips'),
  ('company_logo_url', '', 'Company logo URL (optional)'),
  ('payslip_show_paid_days', '1', 'Show Paid Days / Total Days in payslip (1 = yes, 0 = no)'),
  ('payslip_show_leave_days', '1', 'Show Leave Days breakdown in payslip (1 = yes, 0 = no)'),
  ('payslip_show_attendance_summary', '1', 'Show attendance summary in payslip (1 = yes, 0 = no)'),
  ('payslip_auto_generated_notice', '1', 'Show "Automatically generated payslip" notice (1 = yes, 0 = no)'),
  ('payslip_footer_text', 'This is a computer-generated payslip and does not require a signature.', 'Footer text on payslips'),
  ('payslip_authorized_signatory', '', 'Authorized signatory name (optional)'),
  ('payslip_show_earnings_details', '1', 'Show detailed earnings breakdown (1 = yes, 0 = no)'),
  ('payslip_show_deductions_details', '1', 'Show detailed deductions breakdown (1 = yes, 0 = no)'),
  ('payslip_currency_symbol', '₹', 'Currency symbol for payslip amounts');