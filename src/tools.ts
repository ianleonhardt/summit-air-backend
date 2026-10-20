import { lookupCustomer, normalizePhone, ValidationError } from './customers.ts';
import { assess, assessSituation, checkServiceArea, choice, fields, situation, situationKeys, text } from './policy.ts';
import type { Store } from './store.ts';

export function runTool(name: string, input: unknown, callId: string | undefined, store: Store, now = new Date()): unknown {
  if (name === 'lookup_customer') return lookupCustomer(input);
  if (name === 'check_service_area') return checkServiceArea(input);
  if (name === 'assess_situation') return assessSituation(input, now);
  if (!callId || callId.length > 200) throw new ValidationError('A valid Vapi message.call.id is required for saved requests and appointments.');
  if (name === 'create_service_request') {
    const args = fields(input, ['full_name', 'phone_number', 'service_address', 'location', 'state', 'property_type', 'issue_summary', 'system_type', 'issue_started', 'access_notes', 'consent_to_save', ...situationKeys]);
    const propertyType = choice(args, 'property_type', ['residential', 'commercial', 'unknown'] as const);
    const risk = situation(args);
    const triage = assess(risk, now);
    if (triage.priority === 'emergency') return { status: 'emergency', demo: true, saved: false, ...triage };
    if (propertyType === 'commercial') return { status: 'unsupported_property', demo: true, saved: false, reason: 'Summit Air demo serves residential properties only. No appointment booked.' };
    if (args.consent_to_save !== true) throw new ValidationError('Get caller consent to save the summarized request first.');
    const coverage = checkServiceArea({ location: args.location, state: args.state });
    const fullName = text(args, 'full_name', 100);
    const phone = normalizePhone(args.phone_number);
    const membership = lookupCustomer({ phone_number: phone, full_name: fullName });
    const priority = triage.priority === 'urgent' ? 'urgent' : propertyType === 'unknown' || coverage.status !== 'covered' ? 'review' : triage.priority;
    const payload = {
      full_name: fullName, phone_number: phone, service_address: text(args, 'service_address', 300),
      location: text(args, 'location', 100), state: text(args, 'state', 40), property_type: propertyType,
      issue_summary: text(args, 'issue_summary', 1000), system_type: text(args, 'system_type', 100),
      issue_started: text(args, 'issue_started', 100), access_notes: text(args, 'access_notes', 300),
      ...risk, membership, coverage, triage_reason: triage.reason
    };
    const result = store.create(callId, payload, priority, now);
    return { status: 'saved', demo: true, ...result, priority, ...bookingGuidance(payload, now), automatic_booking_allowed: ['routine', 'urgent'].includes(priority) && propertyType === 'residential' && coverage.status === 'covered' && risk.hazard === 'none', delivery: 'Saved to the demo dispatch review queue. No external notification or technician dispatch has occurred.' };
  }
  if (name === 'list_appointments') {
    const args = fields(input, ['request_id']);
    const request = store.getRequest(text(args, 'request_id', 100), callId);
    if (!['routine', 'urgent'].includes(request.priority) || request.payload.property_type !== 'residential' || request.payload.coverage.status !== 'covered' || request.payload.hazard !== 'none') return { status: 'review_required', demo: true, slots: [], ...bookingGuidance(request.payload, now) };
    return { status: 'available', demo: true, timezone: 'America/New_York', priority: request.priority, slots: store.available(now, request.priority), reservation_held: false };
  }
  if (name === 'book_appointment') {
    const args = fields(input, ['request_id', 'slot_id', 'caller_confirmed']);
    if (args.caller_confirmed !== true) throw new ValidationError('Confirm the exact appointment window with the caller before booking.');
    const requestId = text(args, 'request_id', 100);
    const request = store.getRequest(requestId, callId);
    const result = store.book(requestId, callId, text(args, 'slot_id', 100), now);
    return { ...result, demo: true, timezone: 'America/New_York', ...(result.status === 'slot_unavailable' ? { alternatives: store.available(now, request.priority) } : {}) };
  }
  throw new ValidationError('Unsupported tool.');
}

// Same recovery guidance is returned whether the agent saved early or tried availability early.
function bookingGuidance(payload: { issue_type: string; hazard: string; vulnerable_occupant: boolean | null; severe_weather: boolean | null; property_type: string; coverage: { status: string } }, now: Date) {
  const triage = assess(situation(payload as unknown as Record<string, unknown>), now);
  const missing_fields = [...triage.missing_fields];
  if (payload.property_type === 'unknown') missing_fields.push('property_type');
  const coverageReview = payload.coverage.status !== 'covered';
  return {
    missing_fields,
    reason: coverageReview ? 'Service location needs coverage review' : payload.property_type === 'unknown' ? 'Property type is unresolved' : triage.reason,
    next_question: triage.next_question ?? (payload.property_type === 'unknown' ? 'Is this for your home or a business location?' : null),
    next_action: missing_fields.length ? 'ask_missing_question_then_call_create_service_request_with_all_corrected_details' : coverageReview ? 'coverage_review' : 'list_appointments',
    update_supported: true
  };
}
