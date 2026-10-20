// Operator-only view: reads the shared secret from the local environment, never prints it.
const base = process.env.BACKEND_URL ?? 'http://localhost:3000';
const response = await fetch(new URL('/admin/requests', base), {
  headers: { Authorization: `Bearer ${process.env.VAPI_WEBHOOK_SECRET ?? ''}` }
});
if (!response.ok) throw new Error(`Queue request failed: HTTP ${response.status}`);
console.log(JSON.stringify(await response.json(), null, 2));
export {};
