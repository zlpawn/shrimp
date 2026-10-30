const BASE = 'http://127.0.0.1:19528/credential-relay';
const ALARM = 'credential_relay_poll';

export function createCredentialRelayClient({ chromeApi = globalThis.chrome, fetchImpl = globalThis.fetch } = {}) {
  let busy = false;
  const post = async (path, body) => {
    const response = await fetchImpl(`${BASE}/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Leo-Credential-Relay': '1' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(2000), cache: 'no-store', credentials: 'omit', redirect: 'error'
    });
    if (!response.ok) throw new Error('relay unavailable');
    return response.json();
  };
  async function poll() {
    if (busy) return;
    busy = true;
    try {
      const { task } = await post('poll', {});
      if (!task) return;
      let target;
      try { target = new URL(task.url); } catch { return; }
      if (!task.id || !Number.isFinite(task.expiresAt) || task.expiresAt <= Date.now() ||
          !['http:', 'https:'].includes(target.protocol) || target.username || target.password ||
          (task.names !== undefined && (!Array.isArray(task.names) || !task.names.length ||
            task.names.length > 64 || task.names.some(n => typeof n !== 'string' || !n)))) return;
      let result;
      try {
        const cookies = await chromeApi.cookies.getAll({ url: target.href });
        result = { id: task.id, cookies: cookies.filter(c => !c.partitionKey && (!task.names || task.names.includes(c.name))) };
      } catch { result = { id: task.id, error: 'COOKIE_READ_FAILED' }; }
      if (Date.now() >= task.expiresAt) return;
      try { await post('result', result); }
      catch { if (Date.now() < task.expiresAt) await post('result', result).catch(() => {}); }
    } catch { /* Offline is normal: the service exists only while requested. */ }
    finally { busy = false; }
  }
  async function start() {
    chromeApi.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void poll(); });
    if (!await chromeApi.alarms.get(ALARM)) await chromeApi.alarms.create(ALARM, { periodInMinutes: 1 });
    void poll();
  }
  return { poll, start };
}
