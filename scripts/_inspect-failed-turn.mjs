import https from "node:https";
const agent = new https.Agent({ rejectUnauthorized: false });
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { agent }, (res) => {
      const c = [];
      res.on("data", (d) => c.push(d));
      res.on("end", () => resolve(Buffer.concat(c).toString("utf8")));
    }).on("error", reject);
  });
}
function post(url, body, headers = {}) {
  const data = JSON.stringify(body ?? {});
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: "POST",
        agent,
        timeout: 15000,
        headers: {
          "content-type": "application/json",
          "connect-protocol-version": "1",
          accept: "application/json",
          "content-length": Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        const c = [];
        res.on("data", (d) => c.push(d));
        res.on("end", () => {
          const t = Buffer.concat(c).toString("utf8");
          let j = null;
          try {
            j = JSON.parse(t);
          } catch {}
          resolve({ status: res.statusCode, json: j, preview: t.slice(0, 5000) });
        });
      },
    );
    req.on("error", (e) => resolve({ error: e.message }));
    req.write(data);
    req.end();
  });
}
const html = await get("https://127.0.0.1:9608/");
const csrf = html.match(/csrfToken":"([^"]+)/)?.[1] || "";
const headers = { "x-codeium-csrf-token": csrf };
const base = "https://127.0.0.1:9608/exa.language_server_pb.LanguageServerService";
const id = "671166be-6b4f-45d1-b138-3ff4bdaa3542";
const detail = await post(base + "/GetCascadeTrajectory", { cascadeId: id }, headers);
console.log(JSON.stringify(detail.json, null, 2).slice(0, 5000));
