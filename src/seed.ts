/**
 * Seed the database from data/export.json (exported from the Muse app).
 * Idempotent: only seeds when the menu is empty, so re-running it never
 * wipes edits made in Store setup. Use `npm run seed` to run it manually,
 * or let the server seed on first startup.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Db, getMenuItems, getSettings, migrate, openDb } from './db';

export function findExportFile(): string {
  const candidates = [
    path.join(__dirname, '..', 'data', 'export.json'),
    path.join(process.cwd(), 'data', 'export.json'),
    ...(process.env.SEED_FILE ? [process.env.SEED_FILE] : []),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('Seed file not found. Looked in: ' + candidates.join(', '));
}

async function seedInto(db: Db): Promise<number> {
  const data = JSON.parse(fs.readFileSync(findExportFile(), 'utf-8'));
  const s = data.settings;
  await db.run(
    'INSERT INTO settings (id, store_name, tagline, phone, address, hours, accepting_orders, pickup_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [1, s.store_name, s.tagline, s.phone, s.address, s.hours, s.accepting_orders ? 1 : 0, s.pickup_note ?? ''],
  );
  for (const it of data.items as any[]) {
    await db.run(
      'INSERT INTO menu_items (id, name, description, price_cents, category, sort_order, available) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [it.id, it.name, it.description ?? '', it.price_cents, it.category, it.sort_order ?? 0, it.available ? 1 : 0],
    );
  }
  return (data.items as any[]).length;
}

/** Seed only if the menu is empty. Opens and closes its own connection. */
export async function seedIfEmpty(): Promise<void> {
  const db = openDb();
  try {
    await migrate(db);
    const existing = await getMenuItems(db);
    if (existing.length > 0) {
      console.log(`[seed] Menu already has ${existing.length} items — skipping seed.`);
      return;
    }
    const n = await seedInto(db);
    console.log(`[seed] Seeded ${n} menu items and store settings from data/export.json.`);
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  (async () => {
    const db = openDb();
    try {
      await migrate(db);
      const items = await getMenuItems(db);
      const settings = await getSettings(db);
      if (items.length > 0) {
        console.log(`[seed] Database already seeded (${items.length} items, store: ${settings?.store_name}). Nothing changed.`);
        return;
      }
      const n = await seedInto(db);
      console.log(`[seed] Seeded ${n} menu items and store settings from data/export.json.`);
    } finally {
      await db.close();
    }
  })().catch((err) => {
    console.error('[seed] Failed:', err);
    process.exit(1);
  });
}
