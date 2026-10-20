import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { lookupCustomer, normalizePhone } from '../src/customers.ts';
const secret = 'test-only-secret-012345678901234567890';
const server = createApp(secret);
let base: string;
before(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
const call = (id = 'call-1', args: unknown = { phone_number: '212-555-0101' }, name = 'lookup_customer') => ({ id, type: 'function', function: { name, arguments: args } });
const envelope = (...calls: unknown[]) => ({ message: { type: 'tool-calls', toolCallList: calls } });
async function post(body: unknown, auth: string | null = `Bearer ${secret}`, contentType = 'application/json') {
  return fetch(`${base}/vapi/tools`, { method: 'POST', headers: { 'Content-Type': contentType, ...(auth === null ? {} : { Authorization: auth }) }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}
test('configuration fails closed', () => { for (const value of ['', 'short', 'replace-with-a-random-secret-at-least-32-characters', 'x'.repeat(32)+'\n']) assert.throws(() => createApp(value)); });
test('normalizes supported phone formats', () => { for (const value of ['2125550101', '(212) 555-0101', '+1 212-555-0101', '12125550101']) assert.equal(normalizePhone(value), '+12125550101'); });
test('rejects invalid phones and lookup arguments', () => {
  for (const value of ['', '911', '+442071838750', '2125550101 ext 2', 'abc2125550101', null, 2125550101]) assert.throws(() => normalizePhone(value));
  for (const args of [null, [], {}, {phone_number:'2125550101', extra: true}, {phone_number:'2125550101', full_name: 12}, {phone_number:'2125550101', full_name:' '}]) assert.throws(() => lookupCustomer(args));
});
test('health is public and contains no customer data', async () => { const res = await fetch(`${base}/health`); assert.equal(res.status,200); assert.deepEqual(await res.json(),{status:'ok'}); });
test('requires exact bearer authentication', async () => {
  for (const auth of [null, 'Bearer wrong', `Basic ${secret}`, `Bearer ${secret}extra`]) assert.equal((await post(envelope(call()), auth)).status,401);
});
test('rejects malformed HTTP requests', async () => {
  assert.equal((await post('{')).status,400);
  assert.equal((await post(envelope(call()),undefined,'text/plain')).status,415);
  for (const body of [{}, envelope(), envelope({...call(), id:''}), envelope(call(),call()), envelope(...Array.from({length:21},(_,i)=>call(String(i))))]) assert.equal((await post(body)).status,400);
  assert.equal((await fetch(`${base}/missing`)).status,404);
  assert.equal((await fetch(`${base}/vapi/tools`,{headers:{Authorization:`Bearer ${secret}`}})).status,405);
});
test('limits body size', async () => { assert.equal((await post(JSON.stringify({padding:'x'.repeat(66000)}))).status,413); });
test('active member returns Vapi string result without address or phone', async () => {
  const res = await post(envelope(call())); assert.equal(res.status,200);
  assert.equal(res.headers.get('cache-control'),'no-store');
  const body = await res.json(); assert.equal(body.results[0].toolCallId,'call-1');
  assert.equal(typeof body.results[0].result,'string');
  const result = JSON.parse(body.results[0].result);
  assert.equal(result.status,'found'); assert.equal(result.customer.membership.status,'active');
  assert.equal(result.identity_verified,false); assert.equal(result.demo,true);
  assert.equal(result.customer.serviceAddress,undefined); assert.equal(result.customer.phone,undefined);
});
test('batch correlates all calls and isolates failures', async () => {
  const res = await post(envelope(call('a',JSON.stringify({phone_number:'2125550102'})), call('b',{phone_number:'2125550103'}),call('c',{},'unknown'),call('d','{'),call('e',{phone_number:'bad'})));
  const {results} = await res.json();
  assert.deepEqual(results.map((r: {toolCallId: string})=>r.toolCallId),['a','b','c','d','e']);
  assert.equal(JSON.parse(results[0].result).customer.membership.status,'none');
  assert.equal(JSON.parse(results[1].result).customer.membership.status,'expired');
  for (const result of results.slice(2)) { assert.equal(typeof result.error,'string'); assert.equal(result.result,undefined); }
});
test('unknown, shared, mismatched, and disambiguated records', () => {
  assert.equal(lookupCustomer({phone_number:'2125550199'}).status,'not_found');
  const shared = lookupCustomer({phone_number:'2125550104'});
  assert.equal(shared.status,'ambiguous'); assert.equal('customer' in shared,false);
  assert.equal(lookupCustomer({phone_number:'2125550101',full_name:'Wrong Person'}).status,'details_mismatch');
  const found = lookupCustomer({phone_number:'2125550104',full_name:'  SAM   rivera  '});
  assert.equal(found.status,'found'); assert.equal(found.customer?.id,'demo-004');
});
test('HTTP workflow saves, books, retries safely, and exposes an authenticated review queue', async () => {
  const args = {
    full_name:'Alex Morgan',phone_number:'2125550101',service_address:'101 Demo Lane Apt 4B, Manhattan NY 10001',
    location:'Manhattan',state:'NY',property_type:'residential',issue_summary:'Annual maintenance',system_type:'Furnace',
    issue_started:'Annual service',access_notes:'Call on arrival',consent_to_save:true,
    issue_type:'maintenance',hazard:'none',vulnerable_occupant:false,severe_weather:false
  };
  async function tool(name: string, input: unknown) {
    const body = {message:{...envelope(call('workflow-tool',input,name)).message,call:{id:'http-workflow'}}};
    const response=await post(body); assert.equal(response.status,200);
    const result=(await response.json()).results[0]; assert.equal(result.error,undefined);
    return JSON.parse(result.result);
  }
  const saved=await tool('create_service_request',args); assert.equal(saved.status,'saved');
  const available=await tool('list_appointments',{request_id:saved.request_id});
  assert.ok(available.slots[0].local_window);
  const bookingArgs={request_id:saved.request_id,slot_id:available.slots[0].slot_id,caller_confirmed:true};
  const booking=await tool('book_appointment',bookingArgs); assert.equal(booking.status,'booked');
  assert.equal((await tool('book_appointment',bookingArgs)).booking_id,booking.booking_id);
  assert.equal((await fetch(`${base}/admin/requests`)).status,401);
  const queue=await fetch(`${base}/admin/requests`,{headers:{Authorization:`Bearer ${secret}`}});
  assert.equal(queue.status,200); const data=await queue.json();
  assert.equal(data.requests[0].booking_id,booking.booking_id);
  const missingContext=await post(envelope(call('no-context',args,'create_service_request')));
  assert.match((await missingContext.json()).results[0].error,/call.id/);
});
