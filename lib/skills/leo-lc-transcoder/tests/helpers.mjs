import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export function isListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

export function freshHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-home-"));
  process.env.LC_TRANSCODER_HOME = dir;
  return dir;
}
