export const customers = [
    { id: 'demo-001', fullName: 'Alex Morgan', phone: '+12025550101', serviceAddress: '101 Summit Demo Lane, Denver, CO 80202', membership: { status: 'active', plan: 'Summit Comfort Club' } },
    { id: 'demo-002', fullName: 'Jordan Lee', phone: '+12025550102', serviceAddress: '202 Alpine Demo Avenue, Denver, CO 80203', membership: { status: 'none', plan: null } },
    { id: 'demo-003', fullName: 'Taylor Reed', phone: '+12025550103', serviceAddress: '303 Mountain Demo Road, Denver, CO 80204', membership: { status: 'expired', plan: 'Summit Comfort Club' } },
    { id: 'demo-004', fullName: 'Sam Rivera', phone: '+12025550104', serviceAddress: '404 Peak Demo Street, Denver, CO 80205', membership: { status: 'active', plan: 'Summit Comfort Club' } },
    { id: 'demo-005', fullName: 'Casey Rivera', phone: '+12025550104', serviceAddress: '505 Valley Demo Court, Denver, CO 80206', membership: { status: 'none', plan: null } }
];
export class ValidationError extends Error {
}
export function object(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function normalizePhone(value) {
    if (typeof value !== 'string' || value.length > 40 || !/^\+?[0-9().\s-]+$/.test(value))
        throw new ValidationError('Provide a valid US or Canadian phone number without an extension.');
    let digits = value.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1'))
        digits = digits.slice(1);
    if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits))
        throw new ValidationError('Provide a valid ten-digit US or Canadian phone number.');
    return '+1' + digits;
}
function normalizeName(value) { return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'); }
export function lookupCustomer(input) {
    if (!object(input) || Object.keys(input).some(key => !['phone_number', 'full_name'].includes(key)))
        throw new ValidationError('Expected phone_number and optional full_name only.');
    const phone = normalizePhone(input.phone_number);
    if (input.full_name !== undefined && (typeof input.full_name !== 'string' || input.full_name.trim().length < 2 || input.full_name.length > 100))
        throw new ValidationError('full_name must contain 2–100 characters.');
    const byPhone = customers.filter(customer => customer.phone === phone);
    const name = typeof input.full_name === 'string' ? normalizeName(input.full_name) : undefined;
    const matches = name ? byPhone.filter(customer => normalizeName(customer.fullName) === name) : byPhone;
    if (byPhone.length === 0)
        return { status: 'not_found', demo: true, identity_verified: false, next_action: 'Continue collecting the caller name, callback number, address, and service issue.' };
    if (matches.length !== 1)
        return { status: matches.length > 1 ? 'ambiguous' : 'details_mismatch', demo: true, identity_verified: false, next_action: 'Ask the caller for their full name and confirm the callback number. Do not reveal candidate records. If still unresolved, continue intake for team review.' };
    const customer = matches[0];
    return { status: 'found', demo: true, identity_verified: false, customer: { id: customer.id, full_name: customer.fullName, membership: customer.membership }, next_action: 'Ask the caller to provide their service address. Membership is a demo record; do not promise benefits, dispatch, availability, or an appointment.' };
}
