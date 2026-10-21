# Summit Air phone-agent demo

A TypeScript backend for the Revin FDE case study: residential HVAC intake, membership lookup, urgency assessment, saved service requests, and bookings against a fictional schedule. Vapi handles voice and conversation. This service validates requests and owns the records and reservations.

**Status:** local implementation and automated tests. Applying the prompt/tools in Vapi, Railway deployment, and live phone acceptance tests remain separate steps. No real technicians are dispatched and no external alerts are sent.

## The six source files

| File | Responsibility |
| --- | --- |
| `src/server.ts` | Read environment, open the database, start HTTP, handle shutdown. |
| `src/app.ts` | Authenticate HTTP, validate the Vapi envelope, invoke tools, format results. |
| `src/customers.ts` | Fictional customer data, phone/name normalization, membership lookup. |
| `src/policy.ts` | Assumed coverage, structured urgency rules, emergency wording, input validation. |
| `src/tools.ts` | Coordinate intake and booking tools, enforce consent/eligibility and call ownership. |
| `src/store.ts` | SQLite persistence, dispatch review queue, availability and atomic booking. |

`vapi/system-prompt.txt` is the complete proposed assistant prompt. `vapi/tools.json` contains six tool definitions. Both are reviewable source configuration: **editing them does not automatically change Vapi**. They have not been exported from the live assistant. Record changes here whenever you change the dashboard so reviewers see the configuration you intend to deploy. This replaces the old prompt addition, which prohibited all booking and referenced address data the lookup never returned.

`test/` contains HTTP and workflow tests. `scripts/review-queue.ts` reads the operator queue. `package.json` defines commands, `package-lock.json` fixes dependency versions, `tsconfig.json` controls compilation, `railway.json` defines deployment. `node_modules`, `dist`, local `.env`, and `data` are generated/private and ignored by Git.

## Conversation order

Problem -> immediate safety/urgency -> property suitability -> borough/county -> name and confirmed callback -> membership -> full address and technician details -> confirm summary and consent -> save -> book an eligible routine job or confirm review.

Skip questions already answered. "My apartment" establishes residential context; otherwise ask "Is this for your home or a business location?" An office/store is commercial even when the caller is an existing member. Mixed-use/shared-building ambiguity needs review. No diagnosis or detailed medical history is collected, only whether an occupant is at risk without heating/cooling.

Safety interrupts every stage. Emergency scripts live directly in the Vapi prompt so the assistant does not wait for backend/network access. The backend independently blocks booking based on the **structured facts it receives**; it cannot guarantee that a speech model recognized a hazard correctly. Voice safety scenarios must be tested as well as backend rules.

## Demo assumptions and boundaries

- Coverage: New York County/Manhattan, Kings County/Brooklyn, Queens County/Queens. These three were selected with the candidate because the assignment does not name them. Edit `demoCounties` in `src/policy.ts` after customer discovery. Outside/unknown areas go to coverage review, not an assertion of actual company refusal. Borough aliases resolve counties; this is not address verification/geocoding. Inconsistent address, borough or ZIP statements require clarification in conversation.
- Residential only. Commercial jobs cannot be booked. Unknown property type is review-only.
- Emergency: reported gas smell, CO alarm, smoke/fire, or immediate medical danger. Give emergency guidance without waiting for tools, membership or coverage. Do not book or imply emergency services were contacted.
- Urgent: complete heating/cooling outage with reported vulnerable occupant or severe weather; also no heat November-March in New York time. These are conservative demo rules requiring customer approval, not clinical triage or live weather data.
- Unresolved safety/outage risk -> review. Membership never overrides urgency.
- Booking: two fictional two-hour windows per day over a rolling future schedule, one booking per window, weekends included. This is conservative capacity, **not a simulation of Summit Air's 40 technicians**, skills, travel times, working hours, or real emergency staffing. Slots are stored in UTC; responses include `America/New_York` and a DST-aware `local_window`. Urgent HVAC requests use separate reserved windows as detailed below.
- One saved request per Vapi call, one booking per request. Correct before save. Before booking, resend all corrected intake details to create_service_request to update the same request and recompute eligibility. Already-booked changes, cancellation, rescheduling, or multiple properties need team review.
- No production CRM, real dispatch alerts, outbound message delivery, prices, promised benefits, or callback SLA. The local queue is an actual saved demo handoff, not evidence someone is watching it. Production needs a staffed queue and acknowledged notifications before accepting unattended urgent calls.

## Customer fixtures

All names, phone numbers, addresses, and memberships are fictional. Addresses are intentionally not returned by lookup; ask the caller to supply theirs. Numbers are in the fictional 555-01xx range and are test inputs, not numbers to dial.

| Name | Callback input | County | Membership |
| --- | --- | --- | --- |
| Alex Morgan | 212-555-0101 | New York | active |
| Jordan Lee | 212-555-0102 | Kings | none |
| Taylor Reed | 212-555-0103 | Queens | expired |
| Sam Rivera | 212-555-0104 | Kings | active |
| Casey Rivera | 212-555-0104 | Queens | none |

The shared phone requires name clarification. Unknown number: 212-555-0199. Membership status is seeded, not date-calculated. A match is not identity verification and no-match is not proof someone is not a member. On request creation, the backend derives membership from phone/name rather than trusting a model-supplied membership flag.

## Run locally

Use Node **24.x**, including its built-in SQLite module (which currently prints an experimental warning). No production npm dependencies are required.

```sh
npm ci
```

If `.env` already exists, preserve it. Otherwise copy `.env.example` to `.env`, generate a secret with `openssl rand -hex 32`, and replace the placeholder privately. Never put the secret in Vapi prompts, GitHub, screenshots, or chat.

```sh
npm run check
npm run build
npm run dev
```

`npm run dev` loads `.env` and listens on port 3000 by default. `/health` returns `{"status":"ok"}`. Restart an already-running old server with Control+C then `npm run dev` to load these changes. Existing `.env` files do not need editing locally: the database defaults to `./data/summit-air.sqlite`.

`npm start` runs compiled JavaScript with host-provided environment variables. If using it locally with `.env`, run `node --env-file=.env dist/server.js` instead.

In a second terminal, `npm run queue` shows the latest 100 requests ordered urgent first, review second, routine third, including request details and any booking ID. This accesses an authenticated endpoint; a normal browser visit without the Bearer token gets 401. Set `BACKEND_URL` to the public HTTPS origin when reviewing a deployed service; the locally loaded secret must match that service. Output contains intake data: use fictional callers in this demo.

## Tools and persistence

| Tool | Input / result |
| --- | --- |
| `lookup_customer` | Confirmed `phone_number`, optional `full_name`; found/not_found/ambiguous/details_mismatch. |
| `assess_situation` | Issue, hazard, vulnerability, weather; emergency/urgent/review/routine with a short script. |
| `check_service_area` | Borough/county and state; covered or coverage_review under demo assumptions. |
| `create_service_request` | Confirmed intake and consent; saved request ID, server-derived priority and booking eligibility. Emergencies/commercial jobs are not saved. |
| `list_appointments` | Saved request ID; available demo windows, no hold. Urgent requests use reserved capacity; unresolved review cases cannot book. |
| `book_appointment` | Request ID, returned slot ID, caller consent; booked or slot_unavailable with alternatives. |

Vapi sends `POST /vapi/tools` with `Authorization: Bearer <secret>` and `message.type="tool-calls"`, `message.toolCallList`, and `message.call.id`. Arguments may be objects or JSON strings. The call ID comes from Vapi's authenticated envelope, not model-generated arguments, and scopes saved records to that call. Browser tests must supply the normal call context; bare manual requests without a call ID can use lookup/coverage/assessment, but cannot save or book.

The response contains one string `result` or string `error` per `toolCallId`. Malformed HTTP/envelopes fail with 4xx; valid envelopes use per-tool errors so one failed call does not break other results. Batches are not a transaction; each individual save/booking is atomic. Dependent calls must run sequentially after the prior result returns.

SQLite stores requests, slots and bookings. `BEGIN IMMEDIATE` serializes writers sharing the file. A unique slot ID in the booking table prevents double booking; a unique request ID prevents multiple appointments for one request. The transaction checks availability and inserts the booking together. Listing alone does not reserve a slot. Two callers can hear the same offer; the first committed booking wins, the other receives a conflict and fresh alternatives requiring fresh caller consent.

Request creation is idempotent per Vapi call ID. An identical retry returns the same request ID; corrected intake updates the same unbooked request atomically. Updates after booking are rejected. Missing risk answers return missing_fields and next_question so the assistant can clarify and resume scheduling. Booking retries for the same request/slot return the existing booking ID; a different slot cannot silently overwrite it. A timeout can occur after commit, so retry the same operation rather than assuming it failed. No automatic cross-call deduplication: repeat callers require review.

## Deploy to Railway and connect Vapi

1. Deploy this repository/folder with Node 24. Existing `railway.json` builds via `npm ci && npm run build`, starts `npm start`, and checks `/health`. Railway has announced config-as-code deprecation; the CLI showed compatibility through December 1, 2026. Migrate this config before that cutoff rather than treating the warning as an application failure.
2. Add a **persistent Railway volume mounted at `/data`** and set `DATABASE_PATH=/data/summit-air.sqlite`. Run **one replica**. Railway startup refuses a missing/relative database path. Configuring an absolute path alone does not attach a volume: confirm the mount in the dashboard. Without the volume, redeploys can lose data and booking guarantees across deploys. The in-memory database is used only by test applications.
3. Set `VAPI_WEBHOOK_SECRET` to the fresh private value used in your Vapi custom Bearer credential; Railway provides `PORT`. Keep the secret out of Git and generated artifacts.
4. Obtain the public HTTPS domain and verify health, authenticated tools, and a missing-token 401 before changing Vapi. Do not use localhost as a Vapi server URL. No tunnel is configured.
5. Create/update the six **synchronous Function tools**, using the parameter schemas in `vapi/tools.json`, with Strict off (optional risk fields and optional lookup name). Set every tool's server URL to `https://YOUR-DOMAIN/vapi/tools` and select the saved `Summit Air Backend` credential. The JSON file is an array of reference tool definitions, not an API endpoint that creates multiple tools in one request. Create one tool at a time or use its fields in the dashboard.
6. Apply `vapi/system-prompt.txt` as the assistant system prompt, replacing conflicting message-taking instructions. Preserve the existing voice and end-call tool. Set the assistant first-message field to the opening in the prompt if your assistant uses a fixed first message. Attach all six tools only once the public endpoint works. Keep the existing phone number assigned to this assistant.
7. Call the number and perform the acceptance scenarios in `DEMO.md`. Confirm saved records with `npm run queue`. Close/restart the service and confirm bookings persist. Code tests alone do not prove Vapi speech behavior, live call context, networking, or volume durability.

## Before production

Use a real scheduling/CRM integration or a shared transactional database with constraints, model technician skills/travel/capacity, add verified geography and customer-approved rules, provide caller identity verification before sensitive disclosures, separate operator credentials from the Vapi secret, add monitoring/alert acknowledgment, rate limits, backups, retention and recovery procedures. SQLite's synchronous access and single-volume deployment are deliberate small-demo tradeoffs; don't horizontally scale independent database files.

## Sources

- Vapi tool protocol: https://docs.vapi.ai/tools/custom-tools
- Vapi authentication: https://docs.vapi.ai/server-url/server-authentication
- Railway persistent volumes: https://docs.railway.com/volumes
- Node built-in SQLite: https://nodejs.org/api/sqlite.html
- NYC borough/county names: https://portal.311.nyc.gov/article/?kanumber=KA-02877
- Gas emergency guidance: https://www.coned.com/en/safety/energy-safety/gas-safety

The emergency wording is grounded in utility guidance. The HVAC priority thresholds and fictional booking capacity are demo business assumptions requiring approval, not medical recommendations.

### Voice settings and demo call checks

Vapi assistant: Clara (Vapi Voices v2), speed 0.90. First message: "Thanks for calling Summit Air. I'm the AI assistant. How can I help today?" The system prompt uses `{{customer.number}}` for caller ID. Caller ID is a callback candidate, not identity verification; ask once whether to use it, and accept "use this number" without another confirmation.

The existing `end_after_message` tool uses a custom Request Start message: "Thank you for calling Summit Air. Take care. Goodbye." Enable "Wait for selected message to be spoken before triggering tool call" so the goodbye finishes before disconnecting.

Demo availability is generated for the next seven days at 14:00 and 18:00 UTC, each lasting two hours, with one booking per window. In daylight saving time these are 10 AM–noon and 2–4 PM New York time; in standard time they are 9–11 AM and 1–3 PM. The returned `local_window` is authoritative. These are fictional capacity, not real technician dispatch.

If call logs show HTTP 401, check that the saved Vapi Bearer Token credential exactly matches Railway's `VAPI_WEBHOOK_SECRET`. Direct backend authentication succeeding does not prove Vapi's saved token matches. Never disable authentication to resolve this.

Turn-taking tuning: Wait Seconds 0.8; On Punctuation Seconds 0.6; On No Punctuation Seconds 1.5; On Number Seconds 1.5; Back Off Seconds 2. These allow pauses while reading numbers and give the caller time after interrupting. Validate with another live call. Before publishing from another browser tab, refresh it and check the current prompt plus all seven attached tools (six backend functions and end_after_message); an old draft can overwrite newer settings.


Updated urgent booking policy: covered residential HVAC outages with no immediate hazard may book reserved urgent windows. Reserved windows are 8am, noon, 4pm and 8pm New York time within the next 36 hours, with at least one hour lead time and a two-hour duration. Routine and urgent capacity are separate; each window permits one booking. Unknown hazard, property, or coverage still blocks booking. Clarify missing outage risk facts before saving; preserve explicit yes/no answers. Emergency hazards never book. This is simulated inventory with no real dispatch or alerts.

Vapi webhook bodies are capped at 2 MiB, checked by declared length and streamed byte count. HTTP booking tests use a synthetic full webhook containing the assistant prompt, six tool definitions, and long conversation history exceeding the former 64 KiB limit. Saving a request does not send notifications or promise human follow-up.
