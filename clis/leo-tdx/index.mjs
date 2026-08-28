#!/usr/bin/env node
import process from "node:process";
import { CliError, runCli } from "./lib/cli.mjs";

try {
  const text = await runCli(process.argv.slice(2));
  await writeAll(process.stdout, text);
  await writeAll(process.stdout, "\n");
  process.exit(0);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(error instanceof CliError ? error.exitCode : 4);
}

function writeAll(stream, text) {
  return new Promise((resolve, reject) => {
    stream.write(text, (error) => error ? reject(error) : resolve());
  });
}
