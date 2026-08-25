import { EventEmitter } from 'node:events';

export const events = new EventEmitter();
declare function restoreStock(event: { id: string }): Promise<void>;
events.on('order.cancelled', restoreStock);
