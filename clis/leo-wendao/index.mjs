#!/usr/bin/env node
import readline from "node:readline/promises";
import process from "node:process";
import { stdin, stdout, stderr } from "node:process";
import { queryWendao, readToken, saveToken } from "./wendao.mjs";

const args = process.argv.slice(2);

if (args[0] === "--help" || args[0] === "-h") {
  printUsage();
  process.exit(0);
}

try {
  if (args[0] === "login") {
    if (args.includes("--stdin")) {
      const token = await readStdin();
      saveToken(token);
      stdout.write("Wendao token configured.\n");
    } else {
      stdout.write("Paste your 32-character Wendao token (input is hidden):\n");
      const rl = readline.createInterface({ input: stdin, output: maskedStdout() });
      const token = await rl.question("Token: ");
      rl.close();
      saveToken(token);
      stdout.write("\nWendao token configured.\n");
    }
    process.exit(0);
  }

  if (!args.length) {
    printUsage(stderr);
    process.exit(1);
  }

  const query = args.join(" ");
  const token = readToken();
  if (!token) {
    stderr.write("Wendao token is not configured. Run: wendao login\n");
    process.exit(1);
  }

  const result = await queryWendao(query, { token });
  await writeAll(stdout, result);
  await writeAll(stdout, "\n");
  process.exit(0);
} catch (error) {
  stderr.write(`${error.message}\n`);
  process.exit(1);
}

function printUsage(stream = stdout) {
  stream.write(`Usage:
  wendao "你的旅行问题"
  wendao login [--stdin]

Options:
  -h, --help  Show this help

The query must be the user's original wording. Token configuration is
interactive and never accepted as a command-line argument.
`);
}

async function readStdin() {
  let text = "";
  stdin.setEncoding("utf8");
  for await (const chunk of stdin) text += chunk;
  return text.trim();
}

function writeAll(stream, text) {
  return new Promise((resolve, reject) => {
    stream.write(text, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function maskedStdout() {
  return {
    write(text) {
      if (text === "Token: ") stdout.write(text);
      return true;
    },
    columns: stdout.columns,
  };
}
