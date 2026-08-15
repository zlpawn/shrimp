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

// Find file descriptor / service names containing cascade
const serviceNameHits = [...js.matchAll(/[A-Za-z0-9_.]*(?:Cascade|LanguageServer|Cortex|AgentState|Conversation)[A-Za-z0-9_.]*Service/g)].map(m => m[0]);
console.log("serviceNameHits", [...new Set(serviceNameHits)].slice(0, 100));

// Look for binary file names embedded
const fileHits = [...js.matchAll(/file_[a-z0-9_]+_pb_[a-z0-9_]+/g)].map(m => m[0]);
console.log("fileHits sample", [...new Set(fileHits)].slice(0, 50));

// Search around R = { ... services
const rServiceIdx = js.indexOf("R.services");
console.log("R.services positions", [...js.matchAll(/R\.services/g)].map(m => m.index).slice(0, 10));

// Find where R is assigned as a package/file
// Common pattern: const R = file_xxx
const rAssign = [...js.matchAll(/(?:var|const|let)\s+R\s*=\s*([A-Za-z0-9_$]+)/g)].slice(0, 20);
console.log("R assigns", rAssign.map(m => m[0] + "@" + m.index));

// Search for services:[{typeName
const svcObjs = [...js.matchAll(/services:\s*\[\{[\s\S]{0,500}?typeName:"([^"]+)"/g)];
console.log("services typeNames", svcObjs.map(m => m[1]).slice(0, 20));

// Broader: typeName near Service and methods
const typeService = [...js.matchAll(/typeName:"([^"]*Service[^"]*)"/g)].map(m => m[1]);
console.log("typeName services", [...new Set(typeService)]);

// Search for localServiceName or service type strings used by connect
const maybe = [...js.matchAll(/"(exa\.[^"]+)"/g)].map(m => m[1]);
console.log("exa.*", [...new Set(maybe)].slice(0, 100));
const jetski = [...js.matchAll(/"(?:third_party\.)?jetski[^"]*"/g)].map(m => m[0]);
console.log("jetski strings", [...new Set(jetski)].slice(0, 50));
const codeium = [...js.matchAll(/"[^"]*codeium[^"]*"/gi)].map(m => m[0]);
console.log("codeium strings", [...new Set(codeium)].slice(0, 50));

// Find connect client creation yFa/EFa and base path usage
for (const name of ["yFa(", "EFa(", "application/connect+json", "Connect-Protocol-Version", "connect-protocol-version"]) {
  const i = js.indexOf(name);
  console.log("\n", name, i);
  if (i >= 0) console.log(js.slice(i - 100, i + 400));
}

// Extract all method names from lsClient wrappers by scanning p.methodName( or n.methodName(
const methods = new Set();
for (const m of js.matchAll(/\b(?:p|n|r)\.([A-Za-z][A-Za-z0-9_]{2,80})\(/g)) {
  const name = m[1];
  if (/Cascade|Conversation|Trajectory|Prompt|Project|Agent|Approval|Command|Message|State|Battle|Browser|Jetbox|Mcp|Auth|Config/i.test(name)) {
    methods.add(name);
  }
}
console.log("\nmethod-ish from call sites", [...methods].sort().slice(0, 200));

// Look for StartCascadeRequest schema names
const schemaHits = [...js.matchAll(/[A-Za-z0-9_]+(?:Cascade|Conversation|Trajectory|Message)[A-Za-z0-9_]*(?:Request|Response|Schema)/g)].map(m => m[0]);
console.log("\nschemaHits", [...new Set(schemaHits)].sort().slice(0, 150));
