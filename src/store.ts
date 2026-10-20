import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ValidationError } from './customers.ts';

// One SQLite file on one Railway volume; one service replica. No in-memory booking locks.
export function openStore(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY, call_id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL,
      priority TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS slots (id TEXT PRIMARY KEY, start_at TEXT NOT NULL, end_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY, slot_id TEXT NOT NULL UNIQUE REFERENCES slots(id),
      request_id TEXT NOT NULL UNIQUE REFERENCES requests(id), created_at TEXT NOT NULL
    );`);
  function transaction<T>(run: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try { const result = run(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function seedSlots(now: Date, priority = 'routine') {
    if (priority === 'urgent') {
      const insert = db.prepare('INSERT OR IGNORE INTO slots VALUES (?, ?, ?)');
      // Reserved urgent windows in the next 36 hours, at 8am/noon/4pm/8pm New York time.
      for (let hours = 1; hours <= 36; hours++) {
        const start = new Date(now); start.setUTCMinutes(0, 0, 0); start.setUTCHours(start.getUTCHours() + hours);
        if (+start - +now < 3600000) continue;
        const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(start));
        if (![8, 12, 16, 20].includes(hour)) continue;
        const startAt = start.toISOString();
        insert.run(`urgent-demo-${startAt}`, startAt, new Date(+start + 2 * 3600000).toISOString());
      }
      return;
    }
    // Two conservative demo windows/day, not a model of the real 40-tech fleet.
    const insert = db.prepare('INSERT OR IGNORE INTO slots VALUES (?, ?, ?)');
    for (let day = 1; day <= 7; day++) for (const hour of [14, 18]) {
      const start = new Date(now); start.setUTCDate(start.getUTCDate() + day); start.setUTCHours(hour, 0, 0, 0);
      const startAt = start.toISOString(); const endAt = new Date(+start + 2 * 3600000).toISOString();
      insert.run(`demo-${startAt}`, startAt, endAt);
    }
  }
  function slotView(row: Record<string, unknown>) {
    const start = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(String(row.start_at)));
    const end = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(String(row.end_at)));
    return { ...row, local_window: `${start} to ${end}` };
  }
  function available(now: Date, priority = 'routine') {
    seedSlots(now, priority);
    return db.prepare(`SELECT s.id AS slot_id, s.start_at, s.end_at FROM slots s
      LEFT JOIN bookings b ON b.slot_id=s.id WHERE b.id IS NULL AND s.start_at > ? AND s.id LIKE ? ORDER BY s.start_at LIMIT 6`).all(now.toISOString(), priority === 'urgent' ? 'urgent-demo-%' : 'demo-%').map(row => slotView(row));
  }
  function getRequest(id: string, callId: string) {
    const row = db.prepare('SELECT * FROM requests WHERE id=? AND call_id=?').get(id, callId);
    if (!row) throw new ValidationError('Request not found for this call.');
    return { id: String(row.id), payload: JSON.parse(String(row.payload)), priority: String(row.priority) };
  }
  return {
    close: () => db.close(),
    create(callId: string, payload: unknown, priority: string, now: Date) {
      const encoded = JSON.stringify(payload);
      return transaction(() => {
        const existing = db.prepare('SELECT * FROM requests WHERE call_id=?').get(callId);
        if (existing) {
          if (existing.payload !== encoded) throw new ValidationError('This call already has a different saved request. Do not create another; explain that the team must review corrections.');
          return { request_id: String(existing.id), replayed: true };
        }
        const id = `req-${randomUUID()}`;
        db.prepare('INSERT INTO requests VALUES (?, ?, ?, ?, ?)').run(id, callId, encoded, priority, now.toISOString());
        return { request_id: id, replayed: false };
      });
    },
    getRequest,
    available,
    book(requestId: string, callId: string, slotId: string, now: Date) {
      return transaction(() => {
        const request = getRequest(requestId, callId);
        if (!['routine', 'urgent'].includes(request.priority) || request.payload.coverage.status !== 'covered' || request.payload.property_type !== 'residential' || request.payload.hazard !== 'none') throw new ValidationError('This request requires team review and cannot be booked automatically.');
        const expectedPrefix = request.priority === 'urgent' ? 'urgent-demo-' : 'demo-';
        if (!slotId.startsWith(expectedPrefix)) throw new ValidationError('Slot is not in this request priority schedule. List appointments again.');
        const existing = db.prepare('SELECT * FROM bookings WHERE request_id=?').get(requestId);
        if (existing) {
          if (existing.slot_id !== slotId) throw new ValidationError('Request already booked in a different slot. Rescheduling requires team review.');
          const slot = db.prepare('SELECT start_at, end_at FROM slots WHERE id=?').get(slotId)!;
          return { status: 'booked', booking_id: String(existing.id), slot_id: slotId, ...slotView(slot), replayed: true };
        }
        const slot = db.prepare('SELECT * FROM slots WHERE id=? AND start_at>?').get(slotId, now.toISOString());
        if (!slot) throw new ValidationError('Slot is invalid or has already started. List appointments again.');
        if (db.prepare('SELECT id FROM bookings WHERE slot_id=?').get(slotId)) return { status: 'slot_unavailable', booked: false };
        const id = `booking-${randomUUID()}`;
        // UNIQUE(slot_id) and UNIQUE(request_id) are the final backstop, inside the write transaction.
        db.prepare('INSERT INTO bookings VALUES (?, ?, ?, ?)').run(id, slotId, requestId, now.toISOString());
        return { status: 'booked', booking_id: id, slot_id: slotId, ...slotView({ start_at: slot.start_at, end_at: slot.end_at }), replayed: false };
      });
    },
    queue() {
      return db.prepare(`SELECT r.*, b.id AS booking_id, b.slot_id FROM requests r LEFT JOIN bookings b ON b.request_id=r.id
        ORDER BY CASE r.priority WHEN 'urgent' THEN 0 WHEN 'review' THEN 1 ELSE 2 END, r.created_at DESC LIMIT 100`).all()
        .map(row => ({ request_id: row.id, priority: row.priority, created_at: row.created_at, booking_id: row.booking_id, slot_id: row.slot_id, details: JSON.parse(String(row.payload)) }));
    }
  };
}
export type Store = ReturnType<typeof openStore>;
