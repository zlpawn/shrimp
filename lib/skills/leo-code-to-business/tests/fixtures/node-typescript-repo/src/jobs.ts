import cron from 'node-cron';

declare function reconcileRefunds(): Promise<void>;
cron.schedule('*/10 * * * *', reconcileRefunds);
