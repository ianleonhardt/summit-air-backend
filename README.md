# Summit Air — HVAC phone assistant

Built for the Revin FDE case study: a Vapi phone assistant connected to a TypeScript backend for residential HVAC intake, customer membership lookup, service-area checks, urgency assessment, and appointment booking.

The backend uses SQLite to persist service requests and bookings, with authentication, input validation, and transaction safeguards against double booking. Automated tests cover routine and urgent workflows, missing-information recovery, retries, concurrent bookings, and large Vapi requests.

Service coverage assumes Manhattan, Brooklyn, and Queens. Customer records and appointment capacity are fictional; no real technicians are dispatched and no notifications or callbacks are arranged.

**Stack:** Vapi · TypeScript · Node.js · SQLite · Railway
