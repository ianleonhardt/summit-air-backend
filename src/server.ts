import { createApp } from './app.ts';
const secret = process.env.VAPI_WEBHOOK_SECRET ?? '';
const port = Number(process.env.PORT ?? '3000');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');
const server = createApp(secret);
server.listen(port, '0.0.0.0', () => console.log(`Summit Air demo backend listening on port ${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 8000).unref();
  });
}
