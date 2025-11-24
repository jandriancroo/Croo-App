-- Add hourly_wage column to profiles table
ALTER TABLE profiles ADD COLUMN hourly_wage DECIMAL(10,2) DEFAULT 15.00;

COMMENT ON COLUMN profiles.hourly_wage IS 'Hourly wage rate for the employee in dollars';