/** Run database migrations. `npm run migrate` */
import { migrate, openDb } from './db';

async function main(): Promise<void> {
  const db = openDb();
  try {
    await migrate(db);
    console.log(`[migrate] Tables ready (${db.dialect}).`);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
