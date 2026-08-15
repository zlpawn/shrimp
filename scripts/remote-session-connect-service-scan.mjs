import https from "node:https";
import fs from "node:fs";

const agent = new https.Agent({ rejectUnauthorized: false });
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { agent, timeout: 20000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    }).on("error", reject);
  });
}

const js = await get("https://127.0.0.1:9608/main.js");

// Locate service definition: var rm=R.services[0]
const anchors = [
  "var rm=R.services[0]",
  "rm=R.services[0]",
  "services[0]",
  "startCascade",
  "sendUserCascadeMessage",
  "typeName:",
  "methods:{",
];
for (const a of anchors) {
  console.log(a, "count", js.split(a).length - 1, "first", js.indexOf(a));
}

// Grab a window around rm=R.services[0]
const idx = js.indexOf("var rm=R.services[0]");
console.log("\n--- around rm ---");
console.log(js.slice(Math.max(0, idx - 1500), idx + 500));

// Find startCascade method definition in service methods
const scIdx = js.indexOf("startCascade:");
console.log("\n--- startCascade def candidates ---");
let from = 0;
for (let i = 0; i < 8; i++) {
  const p = js.indexOf("startCascade:", from);
  if (p < 0) break;
  console.log("\n@", p, js.slice(p - 120, p + 280));
  from = p + 1;
}

// Search for Connect service path construction patterns
const patterns = [
  /parent\.typeName/g,
  /procedure:`\/\$\{/g,
  /typeName:\"[^\"]+\"/g,
  /name:\"startCascade\"/g,
  /name:\"StartCascade\"/g,
  /startCascade/g,
];
for (const re of patterns) {
  const m = [...js.matchAll(re)];
  console.log(re, "matches", m.length, "sample", m.slice(0, 5).map((x) => x[0]));
}

// Extract local service method wrappers that call e("method",...)
const wrapperRe = /e\(\"([A-Za-z0-9_]+)\",[^\n]{0,120}n\.([A-Za-z0-9_]+)/g;
const wrappers = new Map();
for (const m of js.matchAll(wrapperRe)) {
  wrappers.set(m[1], (wrappers.get(m[1]) || 0) + 1);
}
console.log("\nwrapper methods", [...wrappers.entries()].sort((a,b)=>b[1]-a[1]).slice(0,80));

// Find schema constants near sendUserCascadeMessage
const amIdx = js.indexOf('e("sendUserCascadeMessage"');
console.log("\n--- sendUser wrapper ---");
console.log(js.slice(amIdx - 400, amIdx + 500));

// Find service methods list by scanning for ".methods=" or "methods:{" near cascade names
const methodList = new Set();
for (const name of [
  "startCascade",
  "sendUserCascadeMessage",
  "getCascadeTrajectory",
  "getCascadeTrajectorySteps",
  "getAllCascadeTrajectories",
  "cancelCascadeInvocation",
  "forceStopCascadeTree",
  "getConversationItems",
  "validateProject",
  "runCommand",
  "updateConversationAnnotations",
  "getCascadeConfig",
]) {
  // look for name:"startCascade" or startCascade:{
  const re1 = new RegExp(name + ":\\{", "g");
  const re2 = new RegExp('name:"' + name + '"', "g");
  methodList.add(name + " object=" + [...js.matchAll(re1)].length + " name=" + [...js.matchAll(re2)].length);
}
console.log("\nmethod patterns", [...methodList]);

// Try to find the service typeName near R.services
const servicesIdx = js.lastIndexOf("services:", idx > 0 ? idx : js.length);
console.log("\nservices idx", servicesIdx);
console.log(js.slice(Math.max(0, servicesIdx - 200), servicesIdx + 800));
