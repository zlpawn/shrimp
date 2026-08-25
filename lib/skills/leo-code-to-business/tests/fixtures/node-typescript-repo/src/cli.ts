import { Command } from 'commander';

const program = new Command();
declare function repairRefund(): Promise<void>;
program.command('repair-refund').action(repairRefund);
