# Summit Air — HVAC phone assistant

A Revin FDE case-study project that connects a Vapi phone assistant to a TypeScript backend. It collects service requests, checks customer membership and service coverage, assesses urgency, and books available appointment windows.

Customer records and appointment capacity are fictional. Bookings are saved in a real database, but no technicians are dispatched and no notifications or callbacks are arranged.

## How it works

**Caller → Vapi assistant → authenticated backend tools → SQLite database**

Vapi handles speech and conversation. The backend validates the information it receives, applies service rules, and saves requests and appointments. A caller can clarify missing details and update an unbooked request without starting over.

| Tool | Purpose |
| --- | --- |
| `lookup_customer` | Look up membership by callback number and, when needed, name. |
| `assess_situation` | Classify routine, urgent, emergency, or unresolved situations. |
| `check_service_area` | Check the supplied borough or county against the assumed coverage area. |
| `create_service_request` | Save intake details or update the same unbooked request. |
| `list_appointments` | Return available routine or reserved urgent windows. |
| `book_appointment` | Reserve the caller's chosen window and return confirmation. |

## Key decisions

- **Coverage:** residential service in Manhattan, Brooklyn, and Queens. These counties are case-study assumptions to confirm with the customer.
- **Urgency:** complete outages with vulnerable occupants or severe weather use reserved urgent windows. No heat in November–March also takes the urgent path. Missing safety facts prompt clarification; unresolved cases cannot book.
- **Emergencies:** the assistant gives immediate safety guidance. Reported emergency hazards block booking. Speech recognition and correct use of the tools still require live testing.
- **Booking:** availability is not a reservation. A database transaction and unique constraints prevent two callers from booking the same slot. Identical retries return the existing booking.
- **Persistence:** one Railway service replica uses one SQLite database on a persistent volume. This is a small fixed-capacity schedule, not a model of a real technician fleet.

## Where to look

| File | Responsibility |
| --- | --- |
| `src/server.ts` | Start the service and open the database. |
| `src/app.ts` | Check authentication, accept Vapi requests, and return tool results. |
| `src/customers.ts` | Fictional customer records and membership matching. |
| `src/policy.ts` | Coverage, urgency rules, and input validation. |
| `src/tools.ts` | Coordinate the six tools and enforce booking eligibility. |
| `src/store.ts` | Save requests, generate availability, and prevent duplicate bookings. |
| `vapi/system-prompt.txt` | Conversation instructions and emergency wording. |
| `vapi/tools.json` | Tool names, descriptions, and accepted input fields. |
| `test/` | HTTP, workflow, persistence, concurrent booking, and large-webhook tests. |
| `scripts/review-queue.ts` | Display saved requests and their booking status. |

The files under `vapi/` must be applied and published in the Vapi dashboard. Pushing them to GitHub does not update the assistant automatically. Vapi's separate end-call tool plays the goodbye before disconnecting.

## Run locally

Requires Node.js 24.x. The backend uses Node's built-in HTTP server and SQLite; it has no production npm dependencies.

1. Run `npm ci`.
2. If `.env` does not exist, copy `.env.example` to `.env`. Generate a private secret with `openssl rand -hex 32` and use it for `VAPI_WEBHOOK_SECRET`.
3. Run the checks and start the service:

```sh
npm run check
npm run build
npm run dev
```

Open `http://localhost:3000/health` to check the service. Run `npm run queue` in another terminal to inspect saved requests. Keep `.env`, the database, and credentials out of Git.

For membership testing, use Alex Morgan / `212-555-0101` (active), Jordan Lee / `212-555-0102` (none), or Taylor Reed / `212-555-0103` (expired). These are fictional inputs, not numbers to dial. A phone/name match is not identity verification.

## Connect Railway and Vapi

1. Deploy with Node 24 using `railway.json` and mount a persistent volume at `/data`. Set `DATABASE_PATH=/data/summit-air.sqlite` and run one replica.
2. Set Railway's `VAPI_WEBHOOK_SECRET` to match Vapi's custom Bearer credential. Railway supplies `PORT`.
3. Configure all six Vapi function tools to call `https://YOUR-DOMAIN/vapi/tools` synchronously with that credential. Use the schemas in `vapi/tools.json`, with Strict off.
4. Publish the system prompt and attach all six function tools plus the end-call tool. Verify the phone number points to this assistant.
5. Test a phone call and confirm the booking in the database. A successful local test does not establish that the live voice flow works.

`GET /health` is public. `POST /vapi/tools` and `GET /admin/requests` require authentication. Save and booking calls require Vapi's call ID. Webhooks have a 2 MiB limit to accommodate assistant configuration and conversation history.

## Validation and current limits

Automated tests cover authentication, input errors, missing-information recovery, routine and urgent bookings, safe retries, persistence, and two callers competing for one slot. A full synthetic Vapi webhook includes the prompt, tool definitions, and long conversation history to test payloads larger than 64 KiB.

**Integration status:** the latest size-limit fix is tested and pushed, but Railway's deployment pause has prevented its release. The updated failure wording is published in Vapi. A successful end-to-end phone booking still needs verification after deployment.

Before real service, replace fictional customer data and capacity with the customer's CRM/scheduling system, confirm service and urgency policies, and provide staffed notifications, monitoring, backups, and data-retention controls. Cancellation, rescheduling, and changes to an already-booked request are not implemented.
