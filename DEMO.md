# Demo and interview guide

## Open the customer meeting

"You asked for an agent that answers peaks in call volume, understands the job, recognizes urgent situations, and gets customers to a service outcome. I'll show a routine residential booking and an urgent case, then we'll look at exactly what reaches dispatch. Today's customer records and schedule are fictional. Coverage is assumed to be Manhattan, Brooklyn and Queens pending your confirmation."

Don't call it production-ready. Explain the boundary once, then demonstrate rather than giving a file tour.

## Live demo (after integration)

1. Routine maintenance: Alex Morgan, 212-555-0101, Manhattan home. Confirm callback, give full fictional address including unit, ask for furnace maintenance. Approve intake and one offered window. Expect saved request and one booked demo appointment. Show request/booking in the queue.
2. Urgent: caller in Queens reports AC fully out and an older adult at risk. Expect urgency questions before membership, saved priority request, reserved urgent windows, and booking only after caller consent and a successful booking result. Show that the record is above routine jobs in the queue. Don't pretend an alert was sent.
3. If time: gas smell. Expect emergency wording immediately without waiting for identity, coverage, or the backend. Stop booking. This verifies conversation behavior, not just the structured triage function.

## Acceptance scenarios

| Scenario | Pass condition |
| --- | --- |
| Caller says "my apartment in Brooklyn" | Uses residential context and Kings coverage; doesn't repeat the property-type question. |
| Caller says "my office" | Clarifies if needed, politely explains residential-only; no booking. |
| Mixed-use shared heating plant | Property remains unknown; review, no auto-book. |
| Bronx, Nassau, or unknown neighborhood | Coverage review; no invented county or service guarantee. |
| Active, non-member, expired member | Correct lookup status; no invented benefits. |
| Shared 212-555-0104 | Caller name disambiguates Sam/Casey; no candidate list disclosed. |
| Unknown or mismatched caller | Continue intake, no false non-member claim or private address readback. |
| No heat in January / extreme conditions | Urgent according to stated demo policy; no routine slot. |
| Medical vulnerability with full AC outage | Minimal relevant risk question; no diagnosis collection. |
| Gas/CO/fire or medical emergency mid-booking | Emergency guidance interrupts intake, not a database/tool wait. |
| Risk details unknown/refused | Review rather than defaulting risk flags to false. |
| Caller corrects callback before save | Readback and corrected input; original value not silently saved. |
| Caller corrects saved data or asks to reschedule | Honest team-review boundary; no claim the record was edited. |
| Caller declines saving | No request or booking. |
| Simultaneous callers choose the same slot | Exactly one booking; other caller offered fresh alternatives with consent. |
| Save/booking response lost after commit | Identical retry returns same IDs; no duplicate record. |
| Bad auth, backend outage, missing call context | No false success and no invented no-match; identify unresolved outcome. |
| Service restart/redeploy | Volume preserves request and booking; old booking still blocks its slot. |

Automated concurrency coverage uses two independent worker threads with separate SQLite connections to the same disk database, released together. This tests database locking rather than relying on JavaScript running one request at a time. HTTP tests separately exercise the Vapi save/list/book path. Live two-phone testing is still an integration check to perform, not a result already claimed.

## Likely questions and honest answers

**"Why not just ask residential or commercial up front?"**
Use volunteered context first: "my house" is enough. Ask "Is this for your home or a business location?" only when needed. Safety comes before eligibility. Membership and phone area code don't establish property type.

**"What if two people take the same appointment?"**
Availability is an offer, not a reservation. The database commits a booking only if the slot is still free. A write transaction plus a unique slot constraint makes that rule atomic across separate connections to the same database. The losing caller gets alternatives. Retries for the winning request return the same booking. Two database files on separate replicas would not provide this guarantee, so this demo runs one service with one persistent volume. For scale I'd use the scheduling system's atomic reservation API or a shared transactional database. A real fleet also needs resource/time overlap constraints; this demo only models fixed non-overlapping slots with capacity one.

**"What do you say in an emergency?"**
There is short prewritten guidance in the system prompt, so the agent doesn't need to invent wording or wait for an HTTP call. For gas/CO/fire: leave, get to safety, call 911 from outside; contact the appropriate utility for suspected gas. Immediate medical danger: call 911 and follow the dispatcher. The backend separately blocks appointments when a structured emergency is reported. Recognition still depends on the voice model; prompt plus code is not a guarantee, and I test emergency interruptions and tool outages in live calls.

**"What does urgent actually do? Is a technician on the way?"**
It creates a persisted priority record and permits booking from reserved urgent windows when coverage, property, and immediate hazard checks pass. No technician is dispatched and no notification is sent. Before production we need an on-call destination, customer-approved response policy, alert delivery acknowledgment and escalation if nobody responds. I'd never tell a caller someone is on the way based only on a priority flag.

**"We have 40 technicians. Why so few slots?"**
This is a deliberately small fictional schedule to demonstrate a real reservation and conflict behavior. It doesn't claim to optimize your fleet. I'd discover technician skills, geography, work hours, expected job lengths, emergency reserves, and the existing scheduling source of truth before connecting real capacity. Weather peaks need capacity controls, not promises of instant service.

**"Why those counties?"**
The brief says three counties without naming them. Manhattan/New York, Brooklyn/Kings, and Queens are explicit demo assumptions approved with the candidate. They must be confirmed with the customer. Unknown or other areas require review; street addresses aren't geocoded by this demo.

**"Why SQLite instead of a big backend stack?"**
It provides actual persistence, transactions and uniqueness without another service or runtime package. That makes the demo understandable and testable. The cost is one volume/replica and synchronous database calls. I'd move to the customer's scheduling API or shared database for multi-instance deployment, durable alerting and real fleet capacity.

**"What if the tool times out?"**
A timeout doesn't prove a write failed. Retry the same save/booking once. Idempotency returns the existing record if it committed. If still uncertain, don't announce booked or not booked; say verification is needed. Never select another slot to escape an uncertain response.

**"Where are your instructions?"**
Conversation policy is in `vapi/system-prompt.txt`; tool contracts are in `vapi/tools.json`. Those must be applied in Vapi. `policy.ts` enforces structured coverage/priority, `tools.ts` orchestrates, and `store.ts` owns persistent writes. The assistant may choose words, but it cannot bypass the server's eligibility, ownership or unique booking constraints by asking nicely.

## Debrief and rollout

After calls: say which checks passed, point out any repeated/awkward question or missed clarification, and show whether the records match what was said. Never substitute automated test results for a successful live call.

Rollout proposal: confirm counties, supported equipment/property types, urgency policy, hours and dispatch SLA; connect scheduling/CRM and staffed alerts; shadow staff on real calls with approved privacy/retention settings; measure intake completeness, urgency misses, conflicts, abandonment and incorrect promises; enable limited routine booking with human override; expand only after acceptance. Emergency and urgent scenarios need dedicated evaluation before unattended operation.

## Quick debugging path

- Can't connect: check `/health`, public domain and server process.
- HTTP 401: Vapi credential must match the service's secret, raw token in credential, Bearer header on request.
- Tool error: inspect Vapi tool log and exact argument names; use `message.call.id` for saved workflows.
- Wrong priority: inspect reported structured facts, `policy.ts`, and New York date; no live weather feed.
- Slot conflict: expected business outcome, offer alternatives; not a crash.
- Data vanished: check persistent volume mount and `DATABASE_PATH`; don't book new jobs until resolved.
- Queue empty after caller heard success: inspect actual tool result; prompt must only confirm saved/booked statuses. Do not claim a delivery integration exists.


Updated urgent booking policy: covered residential HVAC outages with no immediate hazard may book reserved urgent windows. Reserved windows are 8am, noon, 4pm and 8pm New York time within the next 36 hours, with at least one hour lead time and a two-hour duration. Routine and urgent capacity are separate; each window permits one booking. Unknown hazard, property, or coverage still blocks booking. Clarify missing outage risk facts before saving; preserve explicit yes/no answers. Emergency hazards never book. This is simulated inventory with no real dispatch or alerts.
