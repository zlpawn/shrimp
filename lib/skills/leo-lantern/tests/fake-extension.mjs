import { LanternServer } from "../scripts/cli/lib/server.mjs";

/**
 * Starts a real bridge with a stand-in for the Chrome extension. `handle(cmd)` returns the
 * command result or throws a { code, message } object. Every command is recorded in `commands`.
 */
export async function startFakeExtension(handle = () => ({})) {
  const bridge = new LanternServer({ port: 0 });
  await bridge.start();
  const base = `http://127.0.0.1:${bridge.port}`;
  const commands = [];
  let running = true;

  await fetch(`${base}/ext/hello`, { method: "POST", body: JSON.stringify({ id: "fake", version: "9.9.9" }) });

  const loop = (async () => {
    while (running) {
      let cmd;
      try {
        ({ cmd } = await (await fetch(`${base}/ext/poll?waitMs=200`)).json());
      } catch {
        return;
      }
      if (!cmd) continue;
      commands.push(cmd);
      let envelope;
      try {
        envelope = { id: cmd.id, ok: true, result: await handle(cmd) };
      } catch (error) {
        envelope = { id: cmd.id, ok: false, error };
      }
      await fetch(`${base}/ext/result`, { method: "POST", body: JSON.stringify(envelope) }).catch(() => {});
    }
  })();

  return {
    bridge,
    port: bridge.port,
    commands,
    async stop() {
      running = false;
      await bridge.stop();
      await loop;
    },
  };
}
