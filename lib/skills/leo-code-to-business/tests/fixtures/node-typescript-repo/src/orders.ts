import { events } from './events.js';

const paymentBase = 'https://payments.example';
declare const db: any;

export async function cancelOrder(req: any, res: any) {
  const id = req.params.id;
  await db.order.update({ where: { id }, data: { status: 'cancelled' } });
  await fetch(`${paymentBase}/refund`, { method: 'POST', body: JSON.stringify({ id }) });
  events.emit('order.cancelled', { id });
  res.end('cancelled');
}
