import https from "node:https";
import fs from "node:fs";
const agent = new https.Agent({ rejectUnauthorized: false });
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { agent, timeout: 20000 }, (res) => {
      const c = [];
      res.on("data", (d) => c.push(d));
      res.on("end", () => resolve(Buffer.concat(c).toString("utf8")));
    }).on("error", reject);
  });
}
const js = await get("https://127.0.0.1:6506/main.js");
const needles = [
  "streamAgentStateUpdates",
  "StreamAgentStateUpdates",
  "AgentStatePageUpdate",
  "createAgentStateSession",
  "sba(",
  "AgentState",
];
for (const n of needles) {
  let from = 0, count = 0;
  console.log("\n====", n);
  while (count < 5) {
    const i = js.indexOf(n, from);
    if (i < 0) break;
    console.log("---", i);
    console.log(js.slice(Math.max(0, i - 220), i + 500));
    from = i + 1;
    count++;
  }
}
