// End-to-end test for the standalone NKR ordering app (local SQLite).
// Run the server first with a fresh DB, e.g.:
//   rm -f nkr.db && STORE_PIN=test1234 PORT=3100 node dist/server.js
// Then: node tests/e2e-test.mjs
const BASE = process.env.TEST_BASE || 'http://localhost:3100';
let cookie = '';
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('ok:', msg); };

// 1. Storefront
let r = await fetch(`${BASE}/api/storefront`);
let d = await j(r);
assert(d.body.items.length === 47, `storefront has 47 items (got ${d.body?.items?.length})`);
assert(d.body.settings.store_name === 'NKR Convenience and Food', 'store name correct');
assert(d.body.settings.phone === '309-747-2404', 'phone correct');
const buffalo = d.body.items.filter((i) => i.category === 'Wings' && i.description === 'Buffalo').map((i) => i.name);
assert(buffalo.join('|') === 'Buffalo Wings - 4 Pc|Buffalo Wings - 8 Pc|Buffalo Wings - 12 Pc|Buffalo Wings - 24 Pc', `wings sort 4/8/12/24 (${buffalo.join(', ')})`);
assert(d.body.items.find((i) => i.name === 'Buttermilk Biscuits').description.includes('sausage, chicken, steak'), 'biscuit note present');
assert(d.body.items.find((i) => i.name === 'Buffalo Wings - 4 Pc').image === '/images/buffalo-wings.jpg', 'owner photo mapped');
assert(d.body.items.find((i) => i.name === 'Garlic Parmesan Wings - 4 Pc').image.startsWith('https://images.unsplash.com/'), 'garlic parmesan stock fallback');
const menuCount = d.body.items.filter((i) => i.image && i.image.startsWith('/images/')).length;
assert(menuCount === 43, `43 items use owner photos (got ${menuCount})`);

// 2. PIN gate: orders without login -> 401
r = await fetch(`${BASE}/api/store/orders`);
assert(r.status === 401, `orders blocked without PIN (got ${r.status})`);
r = await fetch(`${BASE}/api/store/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: 'wrong' }) });
assert(r.status === 401, 'wrong PIN rejected');
r = await fetch(`${BASE}/api/store/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: 'test1234' }) });
assert(r.status === 200, 'correct PIN accepted');
cookie = r.headers.get('set-cookie')?.split(';')[0] ?? '';
assert(cookie.startsWith('store_session='), 'session cookie set');

// 3. Place a test order (2x Buffalo 8 Pc $9.49 + 1x French Fries $3.49 = $22.47)
r = await fetch(`${BASE}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_name: 'Test Customer', customer_phone: '555-0100', pickup_time: '5:30 PM', notes: 'extra napkins', items: [{ item_id: 30, qty: 2 }, { item_id: 16, qty: 1 }] }) });
d = await j(r);
assert(r.status === 201, `order placed (got ${r.status})`);
assert(d.body.order.total_cents === 2247, `order total $22.47 (got ${d.body.order?.total_cents})`);
assert(d.body.order.status === 'new', 'order status new');
const orderId = d.body.order.id;

// 4. Kitchen queue + status flow
r = await fetch(`${BASE}/api/store/orders`, { headers: { Cookie: cookie } });
d = await j(r);
assert(d.body.orders.length === 1 && d.body.orders[0].id === orderId, 'order appears in kitchen queue');
for (const status of ['preparing', 'ready', 'completed']) {
  r = await fetch(`${BASE}/api/store/orders/${orderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ status }) });
  assert(r.status === 200, `status -> ${status}`);
}
r = await fetch(`${BASE}/api/store/orders`, { headers: { Cookie: cookie } });
d = await j(r);
assert(d.body.orders[0].status === 'completed', 'order ends as completed (Picked up)');

// 5. Store setup: settings read + menu price edit
r = await fetch(`${BASE}/api/store/settings`, { headers: { Cookie: cookie } });
d = await j(r);
assert(d.body.settings.hours.includes('3:00 AM'), 'settings readable');
r = await fetch(`${BASE}/api/store/menu/16`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ price_cents: 399 }) });
assert(r.status === 200, 'menu price edit works');
r = await fetch(`${BASE}/api/storefront`);
d = await j(r);
assert(d.body.items.find((i) => i.id === 16).price_cents === 399, 'edited price reflected in storefront');
// revert
await fetch(`${BASE}/api/store/menu/16`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ price_cents: 349 }) });

// 6. Validation
r = await fetch(`${BASE}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_name: '', pickup_time: '5 PM', items: [{ item_id: 16, qty: 1 }] }) });
assert(r.status === 400, 'order without name rejected');

console.log(process.exitCode ? 'SOME TESTS FAILED' : 'ALL TESTS PASSED');
