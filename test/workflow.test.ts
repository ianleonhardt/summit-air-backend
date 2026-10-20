import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { openStore } from '../src/store.ts';
import { runTool } from '../src/tools.ts';
import { assessSituation, checkServiceArea } from '../src/policy.ts';

const now = new Date('2026-10-20T16:00:00Z');
const input = {
  full_name: 'Alex Morgan', phone_number: '2125550101', service_address: '101 Demo Lane Apt 4B, Manhattan NY 10001',
  location: 'Manhattan', state: 'NY', property_type: 'residential', issue_summary: 'Annual furnace maintenance',
  system_type: 'Furnace', issue_started: 'Annual maintenance', access_notes: 'Call on arrival; apartment 4B',
  consent_to_save: true, issue_type: 'maintenance', hazard: 'none', vulnerable_occupant: false, severe_weather: false
};
function execute(store: ReturnType<typeof openStore>, name: string, args: unknown, callId = 'call-a'): any {
  return runTool(name, args, callId, store, now);
}
test('NYC borough/county aliases and unknown/outside locations', () => {
  for (const location of ['Manhattan','New York County','Brooklyn','Kings County','Queens']) assert.equal(checkServiceArea({location,state:'NY'}).status,'covered');
  for (const location of ['Bronx','Staten Island','Nassau','Springfield']) assert.equal(checkServiceArea({location,state:'NY'}).status,'coverage_review');
  assert.equal(checkServiceArea({location:'Queens',state:'NJ'}).status,'coverage_review');
  assert.throws(()=>checkServiceArea({location:'Manhattan'}));
});
test('emergency precedes coverage and property eligibility and does not save', () => {
  const store = openStore(':memory:');
  try {
    for (const hazard of ['gas_smell','co_alarm','smoke_fire','medical_emergency']) {
      const result = execute(store,'create_service_request',{...input,hazard,property_type:'commercial'});
      assert.equal(result.status,'emergency'); assert.equal(result.saved,false); assert.match(result.script,/911/);
    }
    assert.equal(store.queue().length,0);
  } finally { store.close(); }
});
test('triage prioritizes vulnerability, winter no heat, weather, and uncertainty', () => {
  const risk = {issue_type:'no_heat',hazard:'none',vulnerable_occupant:false,severe_weather:false};
  assert.equal(assessSituation(risk,new Date('2027-01-10T12:00:00Z')).priority,'urgent');
  assert.equal(assessSituation({...risk,issue_type:'no_ac',vulnerable_occupant:true},now).priority,'urgent');
  assert.equal(assessSituation({...risk,severe_weather:true},now).priority,'urgent');
  assert.equal(assessSituation({...risk,vulnerable_occupant:null},now).priority,'review');
  assert.equal(assessSituation({...risk,hazard:'unknown'},now).priority,'review');
  assert.equal(assessSituation({...risk,vulnerable_occupant:undefined,severe_weather:undefined},now).priority,'review');
  assert.equal(assessSituation(risk,now).priority,'routine');
  assert.throws(()=>assessSituation({...risk,vulnerable_occupant:'no'},now));
});
test('saved request is idempotent, retains intake details, and derives membership', () => {
  const store=openStore(':memory:');
  try {
    const first=execute(store,'create_service_request',input);
    const retry=execute(store,'create_service_request',input);
    assert.equal(first.request_id,retry.request_id); assert.equal(retry.replayed,true);
    assert.equal(store.queue().length,1);
    const row=store.queue()[0]!;
    assert.equal(row.details.membership.customer.membership.status,'active');
    assert.equal(row.details.access_notes,input.access_notes);
    assert.throws(()=>execute(store,'create_service_request',{...input,issue_summary:'changed'}));
    assert.throws(()=>runTool('create_service_request',input,undefined,store,now));
    assert.throws(()=>execute(store,'create_service_request',{...input,consent_to_save:false},'other'));
    assert.throws(()=>execute(store,'create_service_request',{...input,phone_number:'911'},'other'));
    assert.throws(()=>execute(store,'create_service_request',{...input,unexpected:true},'other'));
  } finally {store.close();}
});
test('commercial rejected; unresolved safety, coverage and property cannot book', () => {
  const store=openStore(':memory:');
  try {
    assert.equal(execute(store,'create_service_request',{...input,property_type:'commercial'}).status,'unsupported_property');
    assert.equal(store.queue().length,0);
    const cases=[{issue_type:'no_ac',vulnerable_occupant:true,location:'Bronx'},{location:'Bronx'},{property_type:'unknown'},{hazard:'unknown'},{issue_type:'no_heat',vulnerable_occupant:true,hazard:'unknown'}];
    cases.forEach((change,i)=>{
      const callId=`review-${i}`;
      const saved=execute(store,'create_service_request',{...input,...change},callId);
      assert.equal(saved.automatic_booking_allowed,false);
      assert.equal(execute(store,'list_appointments',{request_id:saved.request_id},callId).status,'review_required');
      assert.throws(()=>execute(store,'book_appointment',{request_id:saved.request_id,slot_id:'invented',caller_confirmed:true},callId));
    });
    assert.equal(store.queue()[0]!.priority,'urgent');
  } finally {store.close();}
});
test('routine booking requires consent, ownership, a future real slot, and is idempotent', () => {
  const store=openStore(':memory:');
  try {
    const saved=execute(store,'create_service_request',input);
    const slots=execute(store,'list_appointments',{request_id:saved.request_id});
    const args={request_id:saved.request_id,slot_id:slots.slots[0].slot_id,caller_confirmed:true};
    assert.equal(slots.reservation_held,false);
    assert.throws(()=>execute(store,'book_appointment',{...args,caller_confirmed:false}));
    assert.throws(()=>execute(store,'book_appointment',args,'different-call'));
    assert.throws(()=>execute(store,'book_appointment',{...args,slot_id:'invented'}));
    const booked=execute(store,'book_appointment',args);
    assert.equal(booked.status,'booked');
    assert.equal(execute(store,'book_appointment',args).booking_id,booked.booking_id);
    assert.equal(execute(store,'book_appointment',args).replayed,true);
    assert.throws(()=>execute(store,'book_appointment',{...args,slot_id:slots.slots[1].slot_id}));
    assert.ok(!execute(store,'list_appointments',{request_id:saved.request_id}).slots.some((s:any)=>s.slot_id===args.slot_id));
    assert.equal(store.queue()[0]!.booking_id,booked.booking_id);
  } finally {store.close();}
});
test('past slot rejected and database survives close/reopen', () => {
  const dir=mkdtempSync(join(tmpdir(),'summit-persistence-')); const path=join(dir,'db.sqlite');
  let store=openStore(path);
  try {
    const saved=execute(store,'create_service_request',input);
    const slot=execute(store,'list_appointments',{request_id:saved.request_id}).slots[0];
    assert.throws(()=>runTool('book_appointment',{request_id:saved.request_id,slot_id:slot.slot_id,caller_confirmed:true},'call-a',store,new Date('2027-01-01T12:00:00Z')));
    const booked=execute(store,'book_appointment',{request_id:saved.request_id,slot_id:slot.slot_id,caller_confirmed:true});
    store.close(); store=openStore(path);
    assert.equal(store.queue().length,1); assert.equal(store.queue()[0]!.booking_id,booked.booking_id);
    assert.equal(execute(store,'create_service_request',input).request_id,saved.request_id);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
test('two simultaneous independent workers compete for one slot: exactly one booking survives', async () => {
  const dir=mkdtempSync(join(tmpdir(),'summit-race-')); const path=join(dir,'db.sqlite');
  const store=openStore(path); const workers: Worker[]=[];
  try {
    const a=execute(store,'create_service_request',input,'race-a');
    const b=execute(store,'create_service_request',{...input,full_name:'Jordan Lee',phone_number:'2125550102'},'race-b');
    const slot=execute(store,'list_appointments',{request_id:a.request_id},'race-a').slots[0].slot_id;
    for (const [requestId,callId] of [[a.request_id,'race-a'],[b.request_id,'race-b']]) {
      const worker=new Worker(`
        const { parentPort, workerData } = require('node:worker_threads');
        import(workerData.module).then(({openStore})=>{
          const store=openStore(workerData.path);
          parentPort.once('message',()=>{
            try {parentPort.postMessage(store.book(workerData.requestId,workerData.callId,workerData.slot,new Date(workerData.now)));}
            catch(error){parentPort.postMessage({failure:error.message});}
            finally{store.close();}
          });
          parentPort.postMessage('ready');
        });`,{eval:true,workerData:{module:new URL('../src/store.ts',import.meta.url).href,path,requestId,callId,slot,now:now.toISOString()}});
      workers.push(worker); await once(worker,'message');
    }
    const responses=workers.map(worker=>once(worker,'message'));
    workers.forEach(worker=>worker.postMessage('book'));
    const results=(await Promise.all(responses)).map(([result])=>result);
    assert.equal(results.filter(r=>r.status==='booked').length,1);
    assert.equal(results.filter(r=>r.status==='slot_unavailable').length,1);
    assert.equal(store.queue().filter(r=>r.booking_id).length,1);
  } finally {await Promise.all(workers.map(w=>w.terminate()));store.close();rmSync(dir,{recursive:true,force:true});}
});

test('urgent HVAC has separate future windows with consent and collision protection', () => {
  const store=openStore(':memory:');
  try {
    const urgent={...input,issue_type:'no_heat',vulnerable_occupant:true};
    const a=execute(store,'create_service_request',urgent,'urgent-a');
    const b=execute(store,'create_service_request',urgent,'urgent-b');
    assert.equal(a.priority,'urgent'); assert.equal(a.automatic_booking_allowed,true);
    const listed=execute(store,'list_appointments',{request_id:a.request_id},'urgent-a');
    assert.ok(listed.slots.length>0);
    assert.ok(listed.slots.every((s:any)=>s.slot_id.startsWith('urgent-demo-') && +new Date(s.start_at)>+now));
    const regular=execute(store,'create_service_request',input,'routine');
    const regularSlot=execute(store,'list_appointments',{request_id:regular.request_id},'routine').slots[0];
    const args={request_id:a.request_id,slot_id:listed.slots[0].slot_id,caller_confirmed:true};
    assert.throws(()=>execute(store,'book_appointment',{...args,caller_confirmed:false},'urgent-a'));
    assert.throws(()=>execute(store,'book_appointment',{...args,slot_id:regularSlot.slot_id},'urgent-a'));
    assert.throws(()=>execute(store,'book_appointment',{...args,request_id:regular.request_id},'routine'));
    const booked=execute(store,'book_appointment',args,'urgent-a');
    assert.equal(booked.status,'booked');
    assert.equal(execute(store,'book_appointment',args,'urgent-a').booking_id,booked.booking_id);
    const collision=execute(store,'book_appointment',{...args,request_id:b.request_id},'urgent-b');
    assert.equal(collision.status,'slot_unavailable');
    assert.ok(collision.alternatives.every((s:any)=>s.slot_id.startsWith('urgent-demo-')));
  } finally {store.close();}
});

test('known negative outage answers allow routine booking, unknown answers require clarification', () => {
  const store=openStore(':memory:');
  try {
    const routine=execute(store,'create_service_request',{...input,issue_type:'no_heat'},'known');
    assert.equal(routine.automatic_booking_allowed,true);
    const unresolved=execute(store,'create_service_request',{...input,issue_type:'no_heat',vulnerable_occupant:undefined,severe_weather:undefined},'unknown');
    assert.equal(unresolved.automatic_booking_allowed,false);
  } finally {store.close();}
});
