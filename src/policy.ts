import { object, ValidationError } from './customers.ts';

// These are approved DEMO assumptions, not verified Summit Air operating policy.
export const demoCounties = ['New York', 'Kings', 'Queens'] as const;
export const emergencyScript = 'Leave the area immediately and get to a safe location. Once you are safely outside, call 911. For a suspected gas leak, also contact the appropriate gas utility from a safe location. Do not stay on this call to finish scheduling.';
export function fields(input: unknown, allowed: string[]): Record<string, unknown> {
  if (!object(input) || Object.keys(input).some(key => !allowed.includes(key))) throw new ValidationError('Unexpected tool arguments.');
  return input;
}
export function text(input: Record<string, unknown>, key: string, max = 500): string {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ValidationError(`${key} must be a nonempty string (max ${max} characters).`);
  return value.trim();
}
export function choice<T extends string>(input: Record<string, unknown>, key: string, values: readonly T[]): T {
  const value = input[key];
  if (typeof value !== 'string' || !values.includes(value as T)) throw new ValidationError(`${key} must be one of: ${values.join(', ')}.`);
  return value as T;
}
function knownBoolean(input: Record<string, unknown>, key: string): boolean | null {
  const value = input[key];
  if (value !== true && value !== false && value !== null) throw new ValidationError(`${key} must be true, false, or null when unknown.`);
  return value;
}
export const situationKeys = ['issue_type', 'hazard', 'vulnerable_occupant', 'severe_weather'];
export function situation(input: Record<string, unknown>) {
  return {
    issue_type: choice(input, 'issue_type', ['maintenance', 'repair', 'no_heat', 'no_ac'] as const),
    hazard: choice(input, 'hazard', ['none', 'gas_smell', 'co_alarm', 'smoke_fire', 'medical_emergency', 'unknown'] as const),
    vulnerable_occupant: knownBoolean(input, 'vulnerable_occupant'),
    severe_weather: knownBoolean(input, 'severe_weather')
  };
}
export function assess(input: ReturnType<typeof situation>, now = new Date()) {
  if (!['none', 'unknown'].includes(input.hazard)) return { priority: 'emergency', reason: input.hazard, script: input.hazard === 'medical_emergency' ? 'Call 911 now for emergency medical help and follow the dispatcher’s instructions. Do not wait for an HVAC appointment.' : emergencyScript, automatic_booking_allowed: false };
  const outage = input.issue_type === 'no_heat' || input.issue_type === 'no_ac';
  const month = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'numeric' }).format(now));
  if (outage && (input.vulnerable_occupant || input.severe_weather || (input.issue_type === 'no_heat' && [11, 12, 1, 2, 3].includes(month)))) {
    return { priority: 'urgent', reason: input.vulnerable_occupant ? 'Outage with a vulnerable occupant' : input.severe_weather ? 'Outage during reported severe weather' : 'No heat during the demo winter season', script: 'I will mark this as urgent for dispatch review. I cannot promise an arrival time. If anyone is in immediate danger or needs emergency medical help, call 911.', automatic_booking_allowed: false };
  }
  if (input.hazard === 'unknown' || (outage && (input.vulnerable_occupant === null || input.severe_weather === null))) return { priority: 'review', reason: 'Safety or outage risk details remain unknown', script: 'I will save this for team review rather than confirm a routine appointment.', automatic_booking_allowed: false };
  return { priority: 'routine', reason: 'No reported urgent risk factors', script: 'I can check the demo appointment schedule.', automatic_booking_allowed: true };
}
export function assessSituation(input: unknown, now = new Date()) { return { demo: true, ...assess(situation(fields(input, situationKeys)), now) }; }
export function checkServiceArea(input: unknown) {
  const args = fields(input, ['location', 'state']);
  const state = text(args, 'state', 40).toLowerCase();
  const location = text(args, 'location', 100).toLowerCase().replace(/\s+county$/, '').trim();
  const aliases: Record<string, string> = { manhattan: 'New York', 'new york': 'New York', brooklyn: 'Kings', kings: 'Kings', queens: 'Queens', bronx: 'Bronx', 'the bronx': 'Bronx', 'staten island': 'Richmond', richmond: 'Richmond' };
  const county = aliases[location];
  const covered = ['ny', 'new york'].includes(state) && county !== undefined && demoCounties.includes(county as typeof demoCounties[number]);
  return { demo: true, coverage_policy: 'Assumed demo coverage; customer approval required before production', status: covered ? 'covered' : 'coverage_review', county: county ?? null, automatic_booking_allowed: covered };
}
