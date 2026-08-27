#!/usr/bin/env node
import { runCli } from "./lib/cli.mjs";

runCli(process.argv.slice(2)).catch(() => {
  process.exit(1);
});
