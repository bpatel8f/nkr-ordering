/**
 * Database layer.
 *
 * Production (Render): Postgres via DATABASE_URL (managed Postgres in
 * render.yaml). Local testing: when DATABASE_URL is unset, a local SQLite
 * file (SQLITE_PATH, default ./nkr.db) is used instead so the app can be
 * verified without a Postgres server. The SQLite path is for local testing
 * ONLY — never use it on Render.
 *
 * All queries are written with `?` placeholders; the Postgres driver
 * rewrites them to $1, $2, ... at call time.
 */

import { Pool } from 'pg';

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<{ lastID?: number; changes: number }>;
  exec(sql: string): Promise<void>;
  dialect: 'postgres' | 'sqlite';
  close(): Promise<void>;
}

function toPgParams(sql: string, params: unknown[]): { text: string; values: unknown[] } {
  let i = 0;
  const text = sql.replace(/\?/g, () => `$${++i}`);
  return { text, values: params };
}

class PostgresDb implements Db {
  readonly dialect = 'postgres' as const;
  private pool: Pool;

  constructor(url: string) {
    this.pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const { text, values } = toPgParams(sql, params);
    const res = await this.pool.query(text, values);
    return res.rows as T[];
  }

  async run(sql: string, params: unknown[] = []): Promise<{ lastID?: number; changes: number }> {
    const { text, values } = toPgParams(sql, params);
    const res = await this.pool.query(text, values);
    // RETURNING id is used by callers that need the new id; fall back to rowCount.
    const lastID = (res.rows[0] as { id?: number } | undefined)?.id;
    return { lastID, changes: res.rowCount ?? 0 };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class SqliteDb implements Db {
  readonly dialect = 'sqlite' as const;
  private db: import('node:sqlite').DatabaseSync;

  constructor(path: string) {
    // Node's built-in sqlite (no native dependency to build).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DatabaseSync } = require('node:sqlite');
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as unknown as T[];
  }

  async run(sql: string, params: unknown[] = []): Promise<{ lastID?: number; changes: number }> {
    const info = this.db.prepare(sql).run(...(params as never[]));
    const lastID = info.lastInsertRowid === undefined ? undefined : Number(info.lastInsertRowid);
    return { lastID, changes: Number(info.changes) };
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

export function openDb(): Db {
  const url = process.env.DATABASE_URL;
  if (url) return new PostgresDb(url);
  const path = process.env.SQLITE_PATH || './nkr.db';
  console.warn(`[db] DATABASE_URL not set — using local SQLite file ${path} (testing only)`);
  return new SqliteDb(path);
}

/** Create tables if they do not exist. Safe to run on every startup. */
export async function migrate(db: Db): Promise<void> {
  const autoId =
    db.dialect === 'postgres'
      ? 'id SERIAL PRIMARY KEY'
      : 'id INTEGER PRIMARY KEY AUTOINCREMENT';

  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      store_name TEXT NOT NULL,
      tagline TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      hours TEXT NOT NULL DEFAULT '',
      accepting_orders INTEGER NOT NULL DEFAULT 1,
      pickup_note TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL,
      category TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      available INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS orders (
      ${autoId},
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL DEFAULT '',
      pickup_time TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      total_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_items (
      ${autoId},
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      qty INTEGER NOT NULL,
      price_cents INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
  `);
}

export interface MenuItem {
  id: number;
  name: string;
  description: string;
  price_cents: number;
  category: string;
  sort_order: number;
  available: boolean;
}

export interface Settings {
  store_name: string;
  tagline: string;
  phone: string;
  address: string;
  hours: string;
  accepting_orders: boolean;
  pickup_note: string;
}

export interface OrderItem {
  item_id: number;
  name: string;
  qty: number;
  price_cents: number;
}

export interface Order {
  id: number;
  customer_name: string;
  customer_phone: string;
  pickup_time: string;
  notes: string;
  status: string;
  total_cents: number;
  created_at: string;
  items: OrderItem[];
}

function rowToMenuItem(r: Record<string, unknown>): MenuItem {
  return {
    id: Number(r.id),
    name: String(r.name),
    description: String(r.description ?? ''),
    price_cents: Number(r.price_cents),
    category: String(r.category),
    sort_order: Number(r.sort_order ?? 0),
    available: r.available === 1 || r.available === true,
  };
}

export async function getSettings(db: Db): Promise<Settings | null> {
  const rows = await db.query<Record<string, unknown>>('SELECT * FROM settings WHERE id = ?', [1]);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    store_name: String(r.store_name),
    tagline: String(r.tagline ?? ''),
    phone: String(r.phone ?? ''),
    address: String(r.address ?? ''),
    hours: String(r.hours ?? ''),
    accepting_orders: r.accepting_orders === 1 || r.accepting_orders === true,
    pickup_note: String(r.pickup_note ?? ''),
  };
}

export async function getMenuItems(db: Db): Promise<MenuItem[]> {
  const rows = await db.query<Record<string, unknown>>(
    'SELECT * FROM menu_items ORDER BY category, sort_order, id',
  );
  return rows.map(rowToMenuItem).sort(compareMenuItems);
}

const CATEGORY_ORDER = ['Wings', 'Pizza', 'Chicken & Sandwiches', 'Sides'];

function wingSize(name: string): number {
  const m = name.match(/(\d+)\s*Pc/);
  return m ? parseInt(m[1], 10) : 999;
}

/** Display order: categories in menu order; wings grouped by flavor with
 *  sizes 4 Pc, 8 Pc, 12 Pc, 24 Pc; everything else by stored sort_order. */
export function compareMenuItems(a: MenuItem, b: MenuItem): number {
  const ca = CATEGORY_ORDER.indexOf(a.category);
  const cb = CATEGORY_ORDER.indexOf(b.category);
  if (ca !== cb) return (ca === -1 ? 99 : ca) - (cb === -1 ? 99 : cb);
  if (a.category === 'Wings') {
    if (a.description !== b.description) return a.description.localeCompare(b.description);
    return wingSize(a.name) - wingSize(b.name);
  }
  return a.sort_order - b.sort_order || a.id - b.id;
}

export async function getOrders(db: Db, limit = 100): Promise<Order[]> {
  const orders = await db.query<Record<string, unknown>>(
    'SELECT * FROM orders ORDER BY created_at DESC, id DESC LIMIT ?',
    [limit],
  );
  const out: Order[] = [];
  for (const o of orders) {
    const items = await db.query<Record<string, unknown>>(
      'SELECT item_id, name, qty, price_cents FROM order_items WHERE order_id = ? ORDER BY id',
      [o.id],
    );
    out.push({
      id: Number(o.id),
      customer_name: String(o.customer_name),
      customer_phone: String(o.customer_phone ?? ''),
      pickup_time: String(o.pickup_time),
      notes: String(o.notes ?? ''),
      status: String(o.status),
      total_cents: Number(o.total_cents),
      created_at: String(o.created_at),
      items: items.map((it) => ({
        item_id: Number(it.item_id),
        name: String(it.name),
        qty: Number(it.qty),
        price_cents: Number(it.price_cents),
      })),
    });
  }
  return out;
}
