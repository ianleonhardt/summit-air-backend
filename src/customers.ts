// Entirely fictional fixtures. Replace this repository with a CRM adapter later.
export interface Customer {
  id: string; fullName: string; phone: string; serviceAddress: string; county: string;
  membership: { status: 'active' | 'expired' | 'none'; plan: string | null };
}
export const customers: readonly Customer[] = [
  { id: 'demo-001', fullName: 'Alex Morgan', phone: '+12125550101', serviceAddress: '101 Demo Lane, Apt 4B, Manhattan, NY 10001', county: 'New York', membership: { status: 'active', plan: 'Summit Comfort Club' } },
  { id: 'demo-002', fullName: 'Jordan Lee', phone: '+12125550102', serviceAddress: '202 Demo Avenue, Brooklyn, NY 11201', county: 'Kings', membership: { status: 'none', plan: null } },
  { id: 'demo-003', fullName: 'Taylor Reed', phone: '+12125550103', serviceAddress: '303 Demo Road, Queens, NY 11375', county: 'Queens', membership: { status: 'expired', plan: 'Summit Comfort Club' } },
  { id: 'demo-004', fullName: 'Sam Rivera', phone: '+12125550104', serviceAddress: '404 Demo Street, Apt 2A, Brooklyn, NY 11215', county: 'Kings', membership: { status: 'active', plan: 'Summit Comfort Club' } },
  { id: 'demo-005', fullName: 'Casey Rivera', phone: '+12125550104', serviceAddress: '505 Demo Court, Queens, NY 11101', county: 'Queens', membership: { status: 'none', plan: null } }
];

export class ValidationError extends Error {}
export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function normalizePhone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 40 || !/^\+?[0-9().\s-]+$/.test(value)) throw new ValidationError('Provide a valid US or Canadian phone number without an extension.');
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) throw new ValidationError('Provide a valid ten-digit US or Canadian phone number.');
  return '+1' + digits;
}
function normalizeName(value: string): string { return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'); }
export function lookupCustomer(input: unknown) {
  if (!object(input) || Object.keys(input).some(key => !['phone_number', 'full_name'].includes(key))) throw new ValidationError('Expected phone_number and optional full_name only.');
  const phone = normalizePhone(input.phone_number);
  if (input.full_name !== undefined && (typeof input.full_name !== 'string' || input.full_name.trim().length < 2 || input.full_name.length > 100)) throw new ValidationError('full_name must contain 2–100 characters.');
  const byPhone = customers.filter(customer => customer.phone === phone);
  const name = typeof input.full_name === 'string' ? normalizeName(input.full_name) : undefined;
  const matches = name ? byPhone.filter(customer => normalizeName(customer.fullName) === name) : byPhone;
  if (byPhone.length === 0) return { status: 'not_found', demo: true, identity_verified: false };
  if (matches.length !== 1) return { status: matches.length > 1 ? 'ambiguous' : 'details_mismatch', demo: true, identity_verified: false };
  const customer = matches[0]!;
  return { status: 'found', demo: true, identity_verified: false, customer: { id: customer.id, full_name: customer.fullName, membership: customer.membership,
    // Fictional case-study records only. Name + phone is not production identity verification.
    ...(name ? { service_address: customer.serviceAddress, county: customer.county, state: 'NY', address_confirmation_required: true } : {})
  } };
}
