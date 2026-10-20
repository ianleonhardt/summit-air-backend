# Summit Air: customer lookup milestone

A TypeScript HTTP service for the Summit Air / Revin FDE demo. Your existing Vapi assistant and phone number remain in use. This adds one synchronous function tool: `lookup_customer`.

## What is built

- `POST /vapi/tools`: authenticated Vapi `tool-calls` webhook; returns a string result or string error for each `toolCallId`.
- `GET /health`: public Railway readiness endpoint; no customer information.
- Five fictional customers, including active, expired, non-member, and shared-number scenarios.
- Strict lookup arguments, US/Canada number normalization, batch validation, body/header limits, constant-time secret comparison, and no raw request logging.
- Zero production dependencies, compiled TypeScript, graceful shutdown, Railway config, and HTTP/lookup tests.

This is a read-only, in-memory demo. It does not save messages, create customers, dispatch technicians, book service, verify caller identity, or integrate a live CRM. Fixtures reset identically on restart. Membership has explicit seeded status, with no date-based expiry calculation. No membership benefits or pricing are asserted. The stored addresses are fictional and intentionally omitted from results.

## 1. Run locally

Install Node 24 LTS (Node 22.18+ also supports the test runner's TypeScript files). In this folder:

```sh
npm ci
cp .env.example .env
openssl rand -hex 32
```

Paste the generated value into `.env` as `VAPI_WEBHOOK_SECRET`. Keep this value private; do not commit `.env`.

```sh
npm run check
npm run build
npm run dev
```

`npm start` runs the compiled server and expects environment variables supplied by the host; `npm run dev` loads `.env`. From another terminal in this folder:

```sh
curl --fail http://localhost:3000/health
read -s VAPI_WEBHOOK_SECRET
export VAPI_WEBHOOK_SECRET
curl --fail-with-body http://localhost:3000/vapi/tools \
  -H "Authorization: Bearer $VAPI_WEBHOOK_SECRET" \
  -H 'Content-Type: application/json' \
  --data-binary @vapi/request.json
```

When `read` waits, paste the same secret and press Enter. Expected: `results[0].toolCallId` is `demo-tool-call-1`; `result` is a JSON-encoded string with `status: found` and membership `active`.

## 2. Deploy with your new Railway account

1. Put **this folder's contents** in a GitHub repository. Keep `.env` out. Include `package-lock.json`. If you use a larger repository, set Railway's service Root Directory to this folder's path within that repository.
2. In Railway, create a project, choose **Deploy from GitHub repo**, connect GitHub if requested, and select that repository. No database is needed for this seeded milestone.
3. In the service's **Variables**, add `VAPI_WEBHOOK_SECRET` with the random value you generated. Do not use your Vapi API key. Railway supplies `PORT` automatically.
4. Deploy/redeploy after the variable is set. The checked-in `railway.json` installs dependencies, builds TypeScript, starts the service, and checks `/health`.
5. In the service's networking settings, generate a public domain. Open `https://YOUR-SERVICE.up.railway.app/health`; expect `{"status":"ok"}`.
6. Repeat the curl test above with that HTTPS domain instead of `http://localhost:3000`. A missing or incorrect secret should give HTTP 401. A valid request should return HTTP 200 and a matched result.

Do the endpoint test before changing Vapi. If deployment fails, inspect Railway's build and deployment logs: missing secret means startup intentionally failed; an unhealthy deployment usually means the build/start command, root directory, or environment needs correction. This package binds to `0.0.0.0` and Railway's `PORT`.

## 3. Connect the existing Vapi assistant

Use a **Function** tool, synchronous (`async: false`), rather than an API Request tool. See `vapi/lookup_customer.json` for the complete tool configuration.

1. In Vapi, create a Custom Credential with Bearer authentication. Set its token to exactly the Railway `VAPI_WEBHOOK_SECRET` value, without adding `Bearer ` to the token itself. Vapi adds the authorization scheme.
2. Create the function tool `lookup_customer`. Copy the description and parameter schema from `vapi/lookup_customer.json`.
3. Set the **tool's** server URL to `https://YOUR-SERVICE.up.railway.app/vapi/tools` and select the credential created above (`server.credentialId` in JSON). Replace both placeholders if using the API JSON. Do not put your secret in the URL, schema, or assistant prompt.
4. Attach that saved tool to your existing assistant and save/publish the assistant configuration as required by the dashboard. Keep the existing voice and end-call tool.
5. Append `vapi/prompt-addition.txt` to the assistant system prompt. Reconcile its message-recording instruction with your current prompt: only claim recorded/delivered messages if you already have a separate working persistence or delivery integration.
6. Keep the existing phone number assigned to this assistant. No replacement phone number is needed. Route only this function tool to this endpoint; it deliberately rejects unrelated webhook event types.

The secret authenticates the webhook sender, not the human caller. A phone/name match is only demo context. For real customer data, add caller verification before disclosing private account information.

## 4. Test in Vapi, then by phone

First use the assistant's browser test. State a demo name and callback number explicitly; your real caller ID won't match the seed. Confirm one `lookup_customer` invocation and inspect the corresponding tool response in Vapi's call/webhook logs. Then call your existing Vapi number and repeat.

| Caller details | Expected lookup | Expected conversation |
| --- | --- | --- |
| Alex Morgan, 202-555-0101 | found / active | Continue intake; ask for address; no benefits or booking promises |
| Jordan Lee, 202-555-0102 | found / none | Continue normal service intake |
| Taylor Reed, 202-555-0103 | found / expired | Do not describe membership as active |
| 202-555-0104 without name | ambiguous | Ask for full name without listing candidates |
| Sam Rivera, 202-555-0104 | found / active | Resolve shared phone to Sam |
| Casey Rivera, 202-555-0104 | found / none | Resolve shared phone to Casey |
| Wrong Person, 202-555-0101 | details_mismatch | Confirm details; retry once; continue intake if unresolved |
| New Caller, 202-555-0199 | not_found | Continue as a new caller |
| Invalid number, e.g. 123 | tool error | Ask for a valid callback number |
| Wrong credential in a temporary test tool | HTTP 401 | Tool failure; assistant continues intake without claiming no match |
| Caller reports immediate danger | Emergency prompt takes priority | Do not wait for customer lookup or troubleshoot |

For each call check: one question at a time, callback readback, caller-provided service address, concise problem description, no appointment/dispatch/time guarantee, and proper end-call behavior. Use a temporary test tool for failure tests so your saved working credential is preserved. Restore the good tool configuration afterward.

## Contract and failure behavior

Tool arguments: `{ "phone_number": "202-555-0101", "full_name": "Alex Morgan" }`. `phone_number` is required; `full_name` is optional but recommended. No extra properties. Phone matching is exact after normalization; names are case/whitespace normalized, with no fuzzy matching. If a supplied name disagrees with a phone match, no customer record is returned.

Vapi requests may carry object arguments or JSON-string arguments. This service reads `message.toolCallList`; Vapi's additional envelope metadata is permitted and ignored. Each batch must have 1–20 unique IDs. Unknown tools and bad arguments receive per-call string `error` values under HTTP 200, allowing other calls in the batch to succeed. Malformed envelopes/JSON return 400; invalid credentials 401; wrong method 405; oversized body 413; wrong content type 415. Retried read-only lookups are safe. HTTP failures/timeouts should fall back to normal intake, never be interpreted as `not_found`.

## Acceptance and next milestone

This milestone is accepted when automated checks pass, Railway `/health` and the authenticated lookup work, and the existing phone assistant successfully handles the active, non-member, unknown, and failure scenarios. Deployment and live-call checks require your accounts; local tests alone do not establish those results.

The next backend milestone is persisted `create_service_request` with a real delivery destination and idempotency. Only then should this backend support saying a message was recorded. Before using real CRM data, replace fixtures with an authorized adapter, enforce caller verification and minimal disclosure, and add rate limiting, operational monitoring, and access/retention controls suited to that data.

## Reference documentation

- Vapi function tool request/response contract: https://docs.vapi.ai/tools/custom-tools
- Vapi event envelope: https://docs.vapi.ai/server-url/events
- Vapi credential authentication: https://docs.vapi.ai/server-url/server-authentication
- Railway health checks and PORT: https://docs.railway.com/deployments/healthchecks
- Railway config as code: https://docs.railway.com/config-as-code/reference
