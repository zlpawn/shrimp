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

const base = "https://127.0.0.1:12683";
const html = await get(base + "/");
const csrf = html.match(/csrfToken":"([^"]+)/)?.[1] || "";
console.log("csrf", csrf, "htmlLen", html.length);
const js = await get(base + "/main.js");
console.log("jsBytes", js.length);

const needles = [
  "PlanModel",
  "RequestedModel",
  "requestedModel",
  "planModel",
  "modelOrAlias",
  "ModelOrAlias",
  "getCurrentModelConfig",
  "cascadeConfig:",
  "CascadeConfig",
  "ClientModelConfig",
  "selectedModel",
];
for (const n of needles) {
  let from = 0, count = 0;
  console.log("\n====", n);
  while (count < 3) {
    const i = js.indexOf(n, from);
    if (i < 0) break;
    console.log("---", i);
    console.log(js.slice(Math.max(0, i - 160), i + 420));
    from = i + 1;
    count++;
  }
}
