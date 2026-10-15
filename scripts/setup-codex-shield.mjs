#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const PLATFORM = process.platform;
const HOME = os.homedir();

function runCmd(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    return null;
  }
}

async function checkPortListening(port = 8000, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      resolve(false);
    });
    socket.connect(port, host);
  });
}

function getWinUserEnv(name) {
  const psCmd = `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('${name}', 'User')"`;
  const val = runCmd(psCmd);
  return val ? val.trim() : null;
}

function setWinUserEnv(name, value) {
  const psCmd = value
    ? `powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('${name}', '${value}', 'User')"`
    : `powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('${name}', $null, 'User')"`;
  runCmd(psCmd);
}

function getMacLaunchctlEnv(name) {
  const out = runCmd(`/bin/launchctl getenv ${name}`);
  return out ? out.trim() : null;
}

function setMacLaunchctlEnv(name, value) {
  if (value) {
    runCmd(`/bin/launchctl setenv ${name} ${value}`);
  } else {
    runCmd(`/bin/launchctl unsetenv ${name}`);
  }
}

function getMacPlistPath() {
  const dir = path.join(HOME, "Library", "LaunchAgents");
  return path.join(dir, "com.gateway.codex-desktop-env.plist");
}

function writeMacLaunchAgent() {
  const plistPath = getMacPlistPath();
  const dir = path.dirname(plistPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.gateway.codex-desktop-env</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/launchctl</string>
    <string>setenv</string>
    <string>CODEX_API_ENDPOINT</string>
    <string>localhost</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`;
  fs.writeFileSync(plistPath, plistContent, "utf8");
  runCmd(`/bin/launchctl load -w "${plistPath}"`);
}

function removeMacLaunchAgent() {
  const plistPath = getMacPlistPath();
  if (fs.existsSync(plistPath)) {
    runCmd(`/bin/launchctl unload "${plistPath}"`);
    try {
      fs.unlinkSync(plistPath);
    } catch {}
  }
}

function updateShellProfile(action = "enable") {
  const profiles = [path.join(HOME, ".zshrc"), path.join(HOME, ".bash_profile")];
  const line = 'export CODEX_API_ENDPOINT="localhost"';

  for (const prof of profiles) {
    if (!fs.existsSync(prof) && action === "disable") continue;
    let content = fs.existsSync(prof) ? fs.readFileSync(prof, "utf8") : "";

    if (action === "enable") {
      if (!content.includes("CODEX_API_ENDPOINT")) {
        content += `\n# Codex Desktop Rate Limit Shield\n${line}\n`;
        fs.writeFileSync(prof, content, "utf8");
      }
    } else {
      if (content.includes("CODEX_API_ENDPOINT")) {
        content = content
          .split("\n")
          .filter((l) => !l.includes("CODEX_API_ENDPOINT") && !l.includes("Codex Desktop Rate Limit Shield"))
          .join("\n");
        fs.writeFileSync(prof, content, "utf8");
      }
    }
  }
}

function checkCodexRunning() {
  if (PLATFORM === "win32") {
    const out = runCmd('powershell -NoProfile -Command "Get-Process -Name ChatGPT, codex -ErrorAction SilentlyContinue"');
    return Boolean(out && out.length > 0);
  }
  const out = runCmd('pgrep -f "Codex.app|ChatGPT.app|codex"');
  return Boolean(out && out.length > 0);
}

async function showStatus() {
  console.log("==================================================");
  console.log(" 🛡️ Codex Desktop Rate Limit Shield Status Check");
  console.log("==================================================");
  console.log(`OS Platform       : ${PLATFORM} (${os.release()})`);

  let configuredVal = null;
  if (PLATFORM === "win32") {
    configuredVal = getWinUserEnv("CODEX_API_ENDPOINT");
    console.log(`Windows User Env  : CODEX_API_ENDPOINT = ${configuredVal || "<not set>"}`);
  } else if (PLATFORM === "darwin") {
    configuredVal = getMacLaunchctlEnv("CODEX_API_ENDPOINT");
    const plistExists = fs.existsSync(getMacPlistPath());
    console.log(`macOS Launchctl   : CODEX_API_ENDPOINT = ${configuredVal || "<not set>"}`);
    console.log(`macOS LaunchAgent : ${plistExists ? "Installed" : "Not installed"}`);
  } else {
    configuredVal = process.env.CODEX_API_ENDPOINT;
    console.log(`Linux/Other Env   : CODEX_API_ENDPOINT = ${configuredVal || "<not set>"}`);
  }

  const port8000Active = await checkPortListening(8000);
  console.log(`Shield Port (8000): ${port8000Active ? "✅ Listening (Active)" : "❌ Not listening"}`);

  const port8787Active = await checkPortListening(8787);
  console.log(`Gateway Port(8787): ${port8787Active ? "✅ Listening (Active)" : "❌ Not listening"}`);

  const isRunning = checkCodexRunning();
  console.log(`Codex Desktop App : ${isRunning ? "⚡ Currently Running" : "⚪ Closed / Not running"}`);

  const isConfigured = configuredVal === "localhost";
  console.log("--------------------------------------------------");
  if (isConfigured && port8000Active) {
    console.log("Status: 🟢 SHIELD IS FULLY OPERATIONAL!");
    console.log("Official 429 quota lockouts and send button disables are actively neutralized.");
  } else if (isConfigured && !port8000Active) {
    console.log("Status: 🟡 Environment configured, but Gateway Desktop Shield is not running.");
    console.log("Please ensure the gateway server (`node server.js`) is running.");
  } else {
    console.log("Status: 🔴 Desktop Shield is not yet enabled for Codex Desktop.");
    console.log("To enable, run: node scripts/setup-codex-shield.mjs --enable");
  }
  console.log("==================================================\n");
}

async function enableShield() {
  console.log("Enabling Codex Desktop Rate Limit Shield...");

  if (PLATFORM === "win32") {
    setWinUserEnv("CODEX_API_ENDPOINT", "localhost");
    console.log("✅ Set Windows User Environment Variable: CODEX_API_ENDPOINT=localhost");
  } else if (PLATFORM === "darwin") {
    setMacLaunchctlEnv("CODEX_API_ENDPOINT", "localhost");
    writeMacLaunchAgent();
    updateShellProfile("enable");
    console.log("✅ Set macOS launchctl environment: CODEX_API_ENDPOINT=localhost");
    console.log("✅ Created LaunchAgent: ~/Library/LaunchAgents/com.gateway.codex-desktop-env.plist");
    console.log("✅ Updated shell profiles (~/.zshrc, ~/.bash_profile)");
  } else {
    updateShellProfile("enable");
    console.log("✅ Updated shell profile with export CODEX_API_ENDPOINT=localhost");
  }

  const isRunning = checkCodexRunning();
  if (isRunning) {
    console.log(
      "\n⚠️ Codex Desktop is currently running. Please restart Codex Desktop completely for the environment setting to take effect."
    );
  } else {
    console.log("\n🎉 Done! Next time Codex Desktop launches, the send button lockout will be permanently bypassed.");
  }
}

async function disableShield() {
  console.log("Disabling Codex Desktop Rate Limit Shield...");

  if (PLATFORM === "win32") {
    setWinUserEnv("CODEX_API_ENDPOINT", null);
    console.log("✅ Removed Windows User Environment Variable: CODEX_API_ENDPOINT");
  } else if (PLATFORM === "darwin") {
    setMacLaunchctlEnv("CODEX_API_ENDPOINT", null);
    removeMacLaunchAgent();
    updateShellProfile("disable");
    console.log("✅ Unset macOS launchctl environment and removed LaunchAgent");
  } else {
    updateShellProfile("disable");
    console.log("✅ Cleaned up shell profile");
  }
  console.log("\nDone. Codex Desktop will connect directly to official endpoints.");
}

async function main() {
  const arg = (process.argv[2] || "--status").toLowerCase();
  if (arg === "--enable" || arg === "enable") {
    await enableShield();
  } else if (arg === "--disable" || arg === "disable") {
    await disableShield();
  } else {
    await showStatus();
  }
}

main().catch(console.error);
