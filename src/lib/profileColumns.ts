/**
 * Columns on `public.profiles` that signed-in users are allowed to SELECT.
 *
 * `hourly_wage`, `employee_pin`, and `pin_pending_plaintext` are revoked at the
 * database level (column-level GRANTs) so coworkers can never read a teammate's
 * pay rate or punch-clock credentials. Those values are only reachable through
 * role-checked RPCs:
 *   - wages  -> get_current_wage / get_current_wages_batch
 *   - 6-digit PIN -> get_punch_pin_for_user (self or admin)
 *   - legacy PIN  -> admin_get_employee_pin (admin only)
 *
 * Never add those three columns to this list.
 */
export const PROFILE_SAFE_COLUMNS = [
  'id',
  'email',
  'full_name',
  'role',
  'created_at',
  'updated_at',
  'profile_photo_url',
  'is_active',
  'phone_number',
  'birthday',
  'display_order',
  'croo_cash_balance',
  'appears_on_schedule',
  'default_location_id',
  'min_weekly_hours',
  'max_weekly_hours',
  'first_login_at',
  'invited_by',
  'all_locations_enabled',
  'app_version',
  'weekly_availability',
  'last_login_at',
  'nickname',
  'pin_pending',
  'pin_pending_set_at',
  'pin_pending_set_by',
].join(', ');
