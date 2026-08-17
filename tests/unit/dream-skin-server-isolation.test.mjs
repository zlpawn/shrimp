import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("server.js only imports dream-skin runtime lazily via dynamic import", () => {
  const source = fs.readFileSync("server.js", "utf8");
  // Static imports must not pull runtime modules; dynamic import in the lazy
  // service factory is allowed.
  const staticMatches = source.match(/^import .*dream-skin\/runtime/gm) || [];
  assert.equal(staticMatches.length, 0);
  assert.match(source, /await import\("\.\/lib\/dream-skin\/runtime\/applier\.mjs"\)/);
});

test("server.js rebuilds dream-skin service after config save", () => {
  const source = fs.readFileSync("server.js", "utf8");
  const saveBlock = source.slice(source.indexOf("reqPath === \"/v1/config/save\""), source.indexOf("reqPath === \"/v1/config/copy-client\""));
  assert.match(saveBlock, /globalDreamSkinService = null/);
});

test("server.js contains exactly one dream-skin prefix dispatch", () => {
  const source = fs.readFileSync("server.js", "utf8");
  const matches = source.match(/startsWith\("\/v1\/dream-skin"\)/g) || [];
  assert.equal(matches.length, 1);
});

test("server.js imports dream-skin service and routes", () => {
  const source = fs.readFileSync("server.js", "utf8");
  assert.match(source, /import\s*\{[^}]*createDreamSkinService[^}]*\}\s*from/);
  assert.match(source, /import\s*\{[^}]*routeDreamSkinRequest[^}]*\}\s*from/);
});

test("no request-controlled download URL surfaces in market routes", () => {
  const routes = fs.readFileSync("lib/dream-skin/http/routes.mjs", "utf8");
  assert.doesNotMatch(routes, /body\.(?:url|themeUrl|imageUrl|previewUrl|sha256)/);
  assert.doesNotMatch(routes, /reqPath.*https?:\/\//);
});

test("runtime/community/package routes only appear as explicit 404 rejections", () => {
  const routes = fs.readFileSync("lib/dream-skin/http/routes.mjs", "utf8");
  // The router rejects forbidden path families through a static array + includes check,
  // not through individual handlers.
  assert.match(routes, /const forbidden = \["apply", "launch", "inject", "runtime", "community", "packages"\]/);
  assert.match(routes, /forbidden\.includes\(pathParts\[2\]\)/);
});