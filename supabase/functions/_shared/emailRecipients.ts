// Shared address exclusions for notification channels; no delivery or preference decisions.
export function deliverableEmail(profile: { email?: string | null; is_active?: boolean | null }, blocked: Set<string>): string | null {
  const email = String(profile.email ?? '').trim().toLowerCase();
  return profile.is_active === true && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && !/@example\.com$/i.test(email) && !blocked.has(email) ? email : null;
}

export async function suppressedEmailSet(client: any): Promise<Set<string>> {
  const [bounced, suppressed] = await Promise.all([
    client.from('bounced_emails').select('email_address'),
    client.from('suppressed_emails').select('email'),
  ]);
  if (bounced.error || suppressed.error) throw new Error('Email exclusions unavailable');
  return new Set([...bounced.data ?? [], ...suppressed.data ?? []]
    .map(row => String(row.email_address ?? row.email ?? '').trim().toLowerCase()));
}