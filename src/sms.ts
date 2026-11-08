/**
 * Twilio SMS alerts for new orders.
 *
 * Disabled unless TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and
 * TWILIO_FROM_NUMBER are all set. No credentials are stored in this repo —
 * the owner supplies them later as environment variables (Render dashboard).
 * Sends are best-effort and never block an order from being placed.
 */

const ALERT_TO = (process.env.TWILIO_ALERT_TO || '+12174189581,+16036745740')
  .split(',')
  .map((n) => n.trim())
  .filter(Boolean);

export function smsEnabled(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER,
  );
}

export function alertRecipients(): string[] {
  return ALERT_TO;
}

export async function sendOrderSms(order: {
  id: number;
  customer_name: string;
  customer_phone: string;
  pickup_time: string;
  notes: string;
  total_cents: number;
  items: { name: string; qty: number }[];
}): Promise<void> {
  if (!smsEnabled()) {
    console.log('[sms] Twilio not configured — SMS alerts disabled, order still placed.');
    return;
  }
  const sid = process.env.TWILIO_ACCOUNT_SID as string;
  const token = process.env.TWILIO_AUTH_TOKEN as string;
  const from = process.env.TWILIO_FROM_NUMBER as string;

  const lines = order.items.map((it) => `${it.qty}x ${it.name}`).join(', ');
  const total = (order.total_cents / 100).toFixed(2);
  let body = `New pickup order #${order.id} — ${order.customer_name}, pickup ${order.pickup_time}. ${lines}. Total $${total}.`;
  if (order.customer_phone) body += ` Customer phone: ${order.customer_phone}.`;
  if (order.notes) body += ` Notes: ${order.notes}`;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');

  for (const to of ALERT_TO) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ From: from, To: to, Body: body }),
      });
      if (!res.ok) {
        console.error(`[sms] Twilio send to ${to} failed: ${res.status} ${await res.text()}`);
      } else {
        console.log(`[sms] Order #${order.id} text sent to ${to}`);
      }
    } catch (err) {
      console.error(`[sms] Twilio send to ${to} errored:`, err);
    }
  }
}
