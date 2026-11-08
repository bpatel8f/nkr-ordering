/* NKR Convenience and Food — ordering frontend (vanilla JS). */
const $ = (s) => document.querySelector(s);
const money = (cents) => '$' + (cents / 100).toFixed(2);

let storefront = null;
let cart = {}; // itemId -> qty
let authed = false;

const CATEGORY_ORDER = ['Wings', 'Pizza', 'Chicken & Sandwiches', 'Sides'];

function wingSize(name) {
  const m = name.match(/(\d+)\s*Pc/);
  return m ? parseInt(m[1], 10) : 999;
}

function sortedItems(items) {
  return [...items].sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category);
    const cb = CATEGORY_ORDER.indexOf(b.category);
    if (ca !== cb) return (ca === -1 ? 99 : ca) - (cb === -1 ? 99 : cb);
    if (a.category === 'Wings') {
      if (a.description !== b.description) return a.description.localeCompare(b.description);
      return wingSize(a.name) - wingSize(b.name); // 4 Pc, 8 Pc, 12 Pc, 24 Pc
    }
    return (a.sort_order - b.sort_order) || a.id - b.id;
  });
}

async function loadStorefront() {
  const res = await fetch('/api/storefront');
  const data = await res.json();
  storefront = data;
  const s = data.settings;
  $('#store-name').textContent = s.store_name;
  $('#store-tagline').textContent = s.tagline;
  $('#store-meta').textContent = `${s.address} · ${s.phone} · ${s.hours}`;
  $('#paused-banner').hidden = s.accepting_orders;
  renderMenu();
  updateCartUI();
}

function renderMenu() {
  const items = sortedItems(storefront.items);
  const byCat = {};
  for (const it of items) (byCat[it.category] = byCat[it.category] || []).push(it);
  const el = $('#menu');
  el.innerHTML = '';
  for (const cat of Object.keys(byCat)) {
    const section = document.createElement('div');
    section.className = 'category';
    section.innerHTML = `<h2>${cat}</h2><div class="items"></div>`;
    const grid = section.querySelector('.items');
    for (const it of byCat[cat]) {
      const card = document.createElement('div');
      card.className = 'item-card';
      card.innerHTML = `
        ${it.image ? `<img src="${it.image}" alt="" loading="lazy">` : ''}
        <div class="body">
          <h3>${it.name}</h3>
          ${it.description ? `<p class="desc">${it.description}</p>` : ''}
          <div class="price-row">
            <span class="price">${money(it.price_cents)}</span>
            <button type="button" ${it.available ? '' : 'disabled'}>${it.available ? 'Add' : 'Sold out'}</button>
          </div>
        </div>`;
      card.querySelector('button').addEventListener('click', () => {
        cart[it.id] = (cart[it.id] || 0) + 1;
        updateCartUI();
      });
      grid.appendChild(card);
    }
    el.appendChild(section);
  }
}

function cartLines() {
  return Object.entries(cart).map(([id, qty]) => {
    const it = storefront.items.find((x) => x.id === Number(id));
    return { it, qty };
  }).filter((l) => l.it);
}

function cartTotal() {
  return cartLines().reduce((sum, l) => sum + l.it.price_cents * l.qty, 0);
}

function updateCartUI() {
  const lines = cartLines();
  const count = lines.reduce((n, l) => n + l.qty, 0);
  $('#cart-count').textContent = count;
  $('#cart-total').textContent = money(cartTotal());
  $('#checkout-total').textContent = money(cartTotal());
  const box = $('#cart-items');
  box.innerHTML = lines.length ? '' : '<p>Your cart is empty.</p>';
  for (const { it, qty } of lines) {
    const row = document.createElement('div');
    row.className = 'cart-line';
    row.innerHTML = `<span>${qty} × ${it.name}</span><span>${money(it.price_cents * qty)} <button type="button">−</button></span>`;
    row.querySelector('button').addEventListener('click', () => {
      cart[it.id] = qty - 1;
      if (cart[it.id] <= 0) delete cart[it.id];
      updateCartUI();
    });
    box.appendChild(row);
  }
  $('#place-order-btn').disabled = lines.length === 0 || !storefront.settings.accepting_orders;
}

// ---- Tabs ----
document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'orders') refreshOrders();
    if (btn.dataset.tab === 'setup') refreshSetup();
  });
});

// ---- Cart panel ----
$('#cart-btn').addEventListener('click', () => {
  $('#cart-panel').hidden = false;
  $('#order-confirm').hidden = true;
  $('#checkout-form').hidden = false;
});
$('#close-cart').addEventListener('click', () => { $('#cart-panel').hidden = true; });
document.querySelectorAll('.time-chips button').forEach((b) => {
  b.addEventListener('click', () => { $('#pickup-time').value = b.dataset.pickup; });
});
$('#new-order-btn').addEventListener('click', () => {
  cart = {};
  updateCartUI();
  $('#cart-panel').hidden = true;
});

$('#checkout-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const lines = cartLines();
  if (!lines.length) return;
  const btn = $('#place-order-btn');
  btn.disabled = true;
  btn.textContent = 'Placing…';
  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: $('#cust-name').value.trim(),
        customer_phone: $('#cust-phone').value.trim(),
        pickup_time: $('#pickup-time').value.trim(),
        notes: $('#order-notes').value.trim(),
        items: lines.map(({ it, qty }) => ({ item_id: it.id, qty })),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Order failed');
    const o = data.order;
    $('#checkout-form').hidden = true;
    $('#order-confirm').hidden = false;
    $('#confirm-text').textContent =
      `Order #${o.id} for ${o.customer_name} — pickup ${o.pickup_time}. Total ${money(o.total_cents)}. Pay at the counter when you pick up.`;
    cart = {};
    updateCartUI();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Place order';
  }
});

// ---- Store auth + orders ----
async function checkAuth() {
  const res = await fetch('/api/store/status');
  const data = await res.json();
  authed = data.authed;
  $('#pin-box').hidden = authed;
  $('#orders-box').hidden = !authed;
  $('#setup-locked').hidden = authed;
  $('#setup-box').hidden = !authed;
  return authed;
}

$('#pin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await fetch('/api/store/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: $('#pin-input').value }),
  });
  if (res.ok) {
    $('#pin-error').hidden = true;
    $('#pin-input').value = '';
    await checkAuth();
    refreshOrders();
  } else {
    $('#pin-error').hidden = false;
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await fetch('/api/store/logout', { method: 'POST' });
  await checkAuth();
});

$('#goto-orders').addEventListener('click', () => {
  document.querySelector('[data-tab="orders"]').click();
});

const STATUS_LABEL = { new: 'New', preparing: 'Preparing', ready: 'Ready', completed: 'Picked up', cancelled: 'Cancelled' };

async function refreshOrders() {
  if (!(await checkAuth())) return;
  const res = await fetch('/api/store/orders');
  if (!res.ok) { await checkAuth(); return; }
  const data = await res.json();
  const box = $('#orders');
  box.innerHTML = data.orders.length ? '' : '<p>No orders yet.</p>';
  for (const o of data.orders) {
    const card = document.createElement('div');
    card.className = `order-card status-${o.status}`;
    const itemsHtml = o.items.map((it) => `<li>${it.qty} × ${it.name} — ${money(it.price_cents * it.qty)}</li>`).join('');
    card.innerHTML = `
      <strong>Order #${o.id}</strong> · ${STATUS_LABEL[o.status] || o.status} · ${new Date(o.created_at).toLocaleString()}<br>
      ${o.customer_name}${o.customer_phone ? ` · ${o.customer_phone}` : ''} · Pickup: ${o.pickup_time}<br>
      <ul>${itemsHtml}</ul>
      <strong>Total: ${money(o.total_cents)}</strong>
      ${o.notes ? `<br>Notes: ${o.notes}` : ''}
      <div class="status-btns"></div>`;
    const btns = card.querySelector('.status-btns');
    for (const [key, label] of Object.entries(STATUS_LABEL)) {
      if (key === o.status) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Mark ' + label;
      b.addEventListener('click', async () => {
        await fetch(`/api/store/orders/${o.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: key }),
        });
        refreshOrders();
      });
      btns.appendChild(b);
    }
    box.appendChild(card);
  }
}
$('#refresh-orders').addEventListener('click', refreshOrders);

// ---- Store setup ----
async function refreshSetup() {
  if (!(await checkAuth())) return;
  const [sRes, mRes] = await Promise.all([fetch('/api/store/settings'), fetch('/api/store/menu')]);
  if (!sRes.ok || !mRes.ok) return;
  const { settings } = await sRes.json();
  const { items } = await mRes.json();
  const form = $('#settings-form');
  form.innerHTML = `
    <label>Store name <input name="store_name" value="${settings.store_name}"></label>
    <label>Tagline <input name="tagline" value="${settings.tagline}"></label>
    <label>Phone <input name="phone" value="${settings.phone}"></label>
    <label>Address <input name="address" value="${settings.address}"></label>
    <label>Hours <input name="hours" value="${settings.hours}"></label>
    <label>Pickup note <input name="pickup_note" value="${settings.pickup_note || ''}"></label>
    <label><span><input type="checkbox" name="accepting_orders" ${settings.accepting_orders ? 'checked' : ''} style="width:auto"> Accepting online orders</span></label>
    <button type="submit">Save settings</button>`;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    await fetch('/api/store/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store_name: fd.get('store_name'),
        tagline: fd.get('tagline'),
        phone: fd.get('phone'),
        address: fd.get('address'),
        hours: fd.get('hours'),
        pickup_note: fd.get('pickup_note'),
        accepting_orders: fd.get('accepting_orders') === 'on',
      }),
    });
    alert('Settings saved.');
    loadStorefront();
  };

  const editor = $('#menu-editor');
  editor.innerHTML = '';
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'editor-row';
    row.innerHTML = `
      <input value="${it.name.replace(/"/g, '&quot;')}" data-f="name">
      <input class="price-input" type="number" step="0.01" min="0" value="${(it.price_cents / 100).toFixed(2)}" data-f="price">
      <label><input type="checkbox" data-f="available" ${it.available ? 'checked' : ''}> Available</label>
      <button type="button" data-act="save">Save</button>
      <button type="button" data-act="delete" class="secondary">Delete</button>`;
    row.querySelector('[data-act="save"]').addEventListener('click', async () => {
      const name = row.querySelector('[data-f="name"]').value.trim();
      const price = Math.round(parseFloat(row.querySelector('[data-f="price"]').value) * 100);
      const available = row.querySelector('[data-f="available"]').checked;
      await fetch(`/api/store/menu/${it.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, price_cents: price, available }),
      });
      loadStorefront();
      refreshSetup();
    });
    row.querySelector('[data-act="delete"]').addEventListener('click', async () => {
      if (!confirm(`Delete "${it.name}"?`)) return;
      await fetch(`/api/store/menu/${it.id}`, { method: 'DELETE' });
      loadStorefront();
      refreshSetup();
    });
    editor.appendChild(row);
  }
}

$('#add-item-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const res = await fetch('/api/store/menu', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: fd.get('name'),
      description: fd.get('description'),
      price_cents: Math.round(parseFloat(fd.get('price')) * 100),
      category: fd.get('category'),
    }),
  });
  if (!res.ok) { alert('Could not add item.'); return; }
  e.target.reset();
  loadStorefront();
  refreshSetup();
});

loadStorefront();
checkAuth();
