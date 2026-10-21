import { createServer, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { object, ValidationError } from './customers.ts';
import { openStore, type Store } from './store.ts';
import { runTool } from './tools.ts';

// Vapi includes assistant configuration and conversation history in tool webhooks.
export const MAX_WEBHOOK_BYTES = 2 * 1024 * 1024;

function reply(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
function authenticated(header: string | undefined, secret: string) {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header ?? ''), digest(`Bearer ${secret}`));
}
export function createApp(secret: string, store?: Store) {
  if (secret.length < 32 || secret.trim() !== secret || /\s/.test(secret) || secret.startsWith('replace-')) throw new Error('VAPI_WEBHOOK_SECRET must be a random non-whitespace secret of at least 32 characters.');
  const database = store ?? openStore(':memory:');
  const server = createServer({ requestTimeout: 10_000, headersTimeout: 10_000, maxHeaderSize: 8192 }, async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') return reply(res, 200, { status: 'ok' });
      if (req.url !== '/vapi/tools' && req.url !== '/admin/requests') return reply(res, 404, { error: 'Not found' });
      if (!authenticated(req.headers.authorization, secret)) return reply(res, 401, { error: 'Unauthorized' });
      if (req.url === '/admin/requests') {
        if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return reply(res, 405, { error: 'Method not allowed' }); }
        return reply(res, 200, { demo: true, requests: database.queue() });
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reply(res, 405, { error: 'Method not allowed' }); }
      if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return reply(res, 415, { error: 'Expected application/json' });
      const declaredSize = Number(req.headers['content-length']);
      if (declaredSize > MAX_WEBHOOK_BYTES) return reply(res, 413, { error: 'Request too large' });
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_WEBHOOK_BYTES) { reply(res, 413, { error: 'Request too large' }); return; }
        chunks.push(Buffer.from(chunk));
      }
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return reply(res, 400, { error: 'Invalid JSON' }); }
      const message = object(body) && object(body.message) ? body.message : undefined;
      const calls = message?.toolCallList;
      if (message?.type !== 'tool-calls' || !Array.isArray(calls) || calls.length < 1 || calls.length > 20) return reply(res, 400, { error: 'Expected tool-calls message with 1–20 toolCallList entries' });
      const ids = new Set<string>();
      for (const call of calls) {
        if (!object(call) || typeof call.id !== 'string' || !call.id.trim() || call.id.length > 200 || ids.has(call.id)) return reply(res, 400, { error: 'Every tool call needs a unique, nonempty id (max 200 characters)' });
        ids.add(call.id);
      }
      const results = calls.map((call: Record<string, unknown>) => {
        try {
          if (call.type !== 'function' || !object(call.function) || typeof call.function.name !== 'string') throw new ValidationError('Expected a function tool with a name.');
          let args: unknown = call.function.arguments;
          if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch { throw new ValidationError('Tool arguments must be valid JSON.'); }
          }
          return { toolCallId: call.id, result: JSON.stringify(runTool(call.function.name, args, object(message?.call) && typeof message.call.id === 'string' && message.call.id.trim() ? message.call.id : undefined, database)) };
        } catch (error) {
          return { toolCallId: call.id, error: error instanceof ValidationError ? error.message : 'Tool unavailable. Do not claim a request was saved or booked. Retry the identical operation once. If still uncertain, say the outcome cannot be verified. No team notification or follow-up has been arranged.' };
        }
      });
      return reply(res, 200, { results });
    } catch {
      // Never log raw webhook bodies, caller details, headers, or secrets.
      if (!res.headersSent && !res.destroyed) reply(res, 500, { error: 'Service unavailable' });
      else res.end();
    }
  });
  if (!store) server.on('close', () => database.close());
  return server;
}
