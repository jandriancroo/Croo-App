-- Add view_wallet permission for team_member role
INSERT INTO role_permissions (role, permission_key, permission_label, enabled)
VALUES ('team_member', 'view_wallet', 'View Wallet', true);

-- Add view_sick_time permission for team_member role
INSERT INTO role_permissions (role, permission_key, permission_label, enabled)
VALUES ('team_member', 'view_sick_time', 'View Sick Time Balance', true);

-- Remove the location_settings columns we added earlier (they're not needed now)
ALTER TABLE location_settings DROP COLUMN IF EXISTS show_wallet;
ALTER TABLE location_settings DROP COLUMN IF EXISTS show_sick_time_balance;