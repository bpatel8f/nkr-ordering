/**
 * NKR Convenience and Food — pickup ordering app (standalone).
 * Node/TypeScript + Postgres (Render) with a local SQLite fallback for
 * testing only. Serves the customer menu, takes pickup orders, and
 * provides a PIN-protected kitchen queue + store setup.
 */
import * as crypto from 'crypto';
import express from 'express';
import * as path from 'path';
import { getMenuItems, getOrders, getSettings, migrate, openDb, type Db } from './db';
import { imageForItem } from './images';
import { seedIfEmpty } from './seed';
import { alertRecipients, sendOrderSms, smsEnabled } from './sms';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const db: Db = openDb();
const STORE_PIN = process.env.STORE_PIN || '';
if (!STORE_PIN) {
  console.warn(
    '[auth] WARNING: STORE_PIN is not set — the Orders and Store setup tabs are open to anyone. Set STORE_PIN on Render.',
  );
}

const ORDER_STATUSES = ['new', 'preparing', 'ready', 'completed', 'cancelled'] as const;

// ---- Store PIN sessions (in-memory; re-login after a restart) ----
const sessions = new Map<string, number>();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function parseCookies(req: express.Request): Record<string, string> {
  const out: Record<string, string> = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

function storeAuthed(req: express.Request): boolean {
  if (!STORE_PIN) return true; // dev only; see startup warning
  const token = parseCookies(req).store_session;
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp || exp < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function requireStoreAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (storeAuthed(req)) return next();
  res.status(401).json({ ok: false, error: 'Store PIN required' });
}

// ---- Public API ----
app.get('/api/storefront', async (_req, res) => {
  try {
    const settings = await getSettings(db);
    const items = await getMenuItems(db);
    res.json({
      ok: true,
      settings,
      items: items.map((it) => ({ ...it, image: imageForItem(it.name, it.description) })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to load storefront' });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { customer_name, customer_phone, pickup_time, notes, items } = req.body ?? {};
    if (!customer_name || typeof customer_name !== 'string' || !customer_name.trim()) {
      res.status(400).json({ ok: false, error: 'Customer name is required' });
      return;
    }
    if (!pickup_time || typeof pickup_time !== 'string' || !pickup_time.trim()) {
      res.status(400).json({ ok: false, error: 'Pickup time is required' });
      return;
    }
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ ok: false, error: 'Order must include at least one item' });
      return;
    }
    const settings = await getSettings(db);
    if (settings && !settings.accepting_orders) {
      res.status(400).json({ ok: false, error: 'Online ordering is paused right now' });
      return;
    }
    const menu = await getMenuItems(db);
    const byId = new Map(menu.map((m) => [m.id, m]));
    let total = 0;
    const lines: { item_id: number; name: string; qty: number; price_cents: number }[] = [];
    for (const it of items) {
      const m = byId.get(Number(it.item_id));
      const qty = Math.max(1, Math.min(50, Number(it.qty) || 1));
      if (!m || !m.available) {
        res.status(400).json({ ok: false, error: `Item ${it.item_id} is not available` });
        return;
      }
      total += m.price_cents * qty;
      lines.push({ item_id: m.id, name: m.name, qty, price_cents: m.price_cents });
    }
    // Next order id (works on both Postgres and SQLite).
    const maxRows = await db.query<{ m: number }>('SELECT COALESCE(MAX(id), 0) AS m FROM orders');
    const orderId = Number(maxRows[0]?.m ?? 0) + 1;
    const createdAt = new Date().toISOString();
    await db.run(
      'INSERT INTO orders (id, customer_name, customer_phone, pickup_time, notes, status, total_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [orderId, customer_name.trim(), String(customer_phone ?? '').trim(), pickup_time.trim(), String(notes ?? '').trim(), 'new', total, createdAt],
    );
    for (const line of lines) {
      await db.run(
        'INSERT INTO order_items (order_id, item_id, name, qty, price_cents) VALUES (?, ?, ?, ?, ?)',
        [orderId, line.item_id, line.name, line.qty, line.price_cents],
      );
    }
    const order = {
      id: orderId,
      customer_name: customer_name.trim(),
      customer_phone: String(customer_phone ?? '').trim(),
      pickup_time: pickup_time.trim(),
      notes: String(notes ?? '').trim(),
      status: 'new',
      total_cents: total,
      created_at: createdAt,
      items: lines,
    };
    // SMS alerts are best-effort and never block the order response.
    void sendOrderSms(order).catch((err) => console.error('[sms] Unexpected error:', err));
    res.status(201).json({ ok: true, order });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to place order' });
  }
});

// ---- Store auth ----
app.get('/api/store/status', (req, res) => {
  res.json({ ok: true, authed: storeAuthed(req), pin_required: Boolean(STORE_PIN), sms_enabled: smsEnabled(), sms_recipients: alertRecipients() });
});

app.post('/api/store/login', (req, res) => {
  const pin = String(req.body?.pin ?? '');
  const pinMatches =
    STORE_PIN.length > 0 &&
    pin.length === STORE_PIN.length &&
    crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(STORE_PIN));
  if (!STORE_PIN || pinMatches) {
    const token = crypto.randomUUID();
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    res.cookie('store_session', token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_TTL_MS, path: '/' });
    res.json({ ok: true });
    return;
  }
  res.status(401).json({ ok: false, error: 'Wrong PIN' });
});

app.post('/api/store/logout', (_req, res) => {
  res.clearCookie('store_session', { path: '/' });
  res.json({ ok: true });
});

// ---- Protected store API ----
app.get('/api/store/orders', requireStoreAuth, async (_req, res) => {
  try {
    res.json({ ok: true, orders: await getOrders(db, 100) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to load orders' });
  }
});

app.patch('/api/store/orders/:id', requireStoreAuth, async (req, res) => {
  try {
    const status = String(req.body?.status ?? '');
    if (!(ORDER_STATUSES as readonly string[]).includes(status)) {
      res.status(400).json({ ok: false, error: `Status must be one of: ${ORDER_STATUSES.join(', ')}` });
      return;
    }
    const r = await db.run('UPDATE orders SET status = ? WHERE id = ?', [status, Number(req.params.id)]);
    if (r.changes === 0) {
      res.status(404).json({ ok: false, error: 'Order not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to update order' });
  }
});

app.get('/api/store/menu', requireStoreAuth, async (_req, res) => {
  res.json({ ok: true, items: await getMenuItems(db) });
});

app.post('/api/store/menu', requireStoreAuth, async (req, res) => {
  try {
    const { name, description, price_cents, category, sort_order, available } = req.body ?? {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ ok: false, error: 'Name is required' });
      return;
    }
    const price = Math.round(Number(price_cents));
    if (!Number.isFinite(price) || price < 0) {
      res.status(400).json({ ok: false, error: 'Price (cents) is required' });
      return;
    }
    const maxRows = await db.query<{ m: number }>('SELECT COALESCE(MAX(id), 0) AS m FROM menu_items');
    const id = Number(maxRows[0]?.m ?? 0) + 1;
    await db.run(
      'INSERT INTO menu_items (id, name, description, price_cents, category, sort_order, available) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, name.trim(), String(description ?? ''), price, String(category ?? 'Sides'), Number(sort_order ?? 0), available === false ? 0 : 1],
    );
    res.status(201).json({ ok: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to add item' });
  }
});

app.patch('/api/store/menu/:id', requireStoreAuth, async (req: express.Request, res: express.Response) => {
  try {
    const id = Number(req.params.id);
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const key of ['name', 'description', 'price_cents', 'category', 'sort_order', 'available'] as const) {
      if (req.body?.[key] === undefined) continue;
      fields.push(`${key} = ?`);
      values.push(key === 'available' ? (req.body[key] ? 1 : 0) : req.body[key]);
    }
    if (!fields.length) {
      res.status(400).json({ ok: false, error: 'Nothing to update' });
      return;
    }
    values.push(id);
    const r = await db.run(`UPDATE menu_items SET ${fields.join(', ')} WHERE id = ?`, values);
    if (r.changes === 0) {
      res.status(404).json({ ok: false, error: 'Item not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to update item' });
  }
});

app.delete('/api/store/menu/:id', requireStoreAuth, async (req: express.Request, res: express.Response) => {
  try {
    const r = await db.run('DELETE FROM menu_items WHERE id = ?', [Number(req.params.id)]);
    if (r.changes === 0) {
      res.status(404).json({ ok: false, error: 'Item not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to delete item' });
  }
});

app.get('/api/store/settings', requireStoreAuth, async (_req: express.Request, res: express.Response) => {
  res.json({ ok: true, settings: await getSettings(db) });
});

app.put('/api/store/settings', requireStoreAuth, async (req: express.Request, res: express.Response) => {
  try {
    const s = req.body ?? {};
    await db.run(
      'UPDATE settings SET store_name = ?, tagline = ?, phone = ?, address = ?, hours = ?, accepting_orders = ?, pickup_note = ? WHERE id = 1',
      [
        String(s.store_name ?? ''),
        String(s.tagline ?? ''),
        String(s.phone ?? ''),
        String(s.address ?? ''),
        String(s.hours ?? ''),
        s.accepting_orders ? 1 : 0,
        String(s.pickup_note ?? ''),
      ],
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to save settings' });
  }
});

// SPA fallback — the customer menu is the home page.
app.get('*', (_req: express.Request, res: express.Response) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

async function main(): Promise<void> {
  await migrate(db);
  await seedIfEmpty();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`[server] NKR ordering app listening on port ${port} (${db.dialect})`);
    console.log(`[server] SMS alerts ${smsEnabled() ? `enabled -> ${alertRecipients().join(', ')}` : 'disabled (Twilio env vars not set)'}`);
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[server] Failed to start:', err);
    process.exit(1);
  });
}

export default app;
