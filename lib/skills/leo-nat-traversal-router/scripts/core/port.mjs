import net from "node:net";

/**
 * Checks whether a local port is currently in use (actively listening).
 * Returns true if port is occupied, false if available.
 */
export function isPortInUse(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    server.once("listening", () => {
      server.close(() => resolve(false));
    });
    server.listen(Number(port), host);
  });
}

/**
 * Tests if a TCP endpoint (host:port) can be connected to within timeoutMs.
 */
export function checkTcpConnect(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const cleanup = (result) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(result);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => cleanup(true));
    socket.once("timeout", () => cleanup(false));
    socket.once("error", () => cleanup(false));

    socket.connect(Number(port), host);
  });
}
