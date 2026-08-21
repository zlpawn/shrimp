import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { createSshHostBackend } from "../../lib/remote-session/host-attach/ssh-host.mjs";

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {}

function findPythonSqlite() {
  const candidates = process.platform === "win32"
    ? [["py", "-3"], ["python", ""], ["python3", ""]]
    : [["python3", ""], ["python", ""]];
  for (const [executable, launcherArg] of candidates) {
    try {
      execFileSync(
        executable,
        [...(launcherArg ? [launcherArg] : []), "-c", "import sqlite3"],
        { stdio: "ignore" },
      );
      return { executable, launcherArg };
    } catch {}
  }
  return null;
}

const PYTHON_SQLITE = findPythonSqlite();
const CAN_CREATE_SQLITE_FIXTURE = Boolean(DatabaseSync || PYTHON_SQLITE);

function writeProject(home, { id, name, workspacePath, workspacePaths, fileName = id }) {
  const projectsDir = path.join(home, ".gemini", "config", "projects");
  fs.mkdirSync(projectsDir, { recursive: true });
  const paths = workspacePaths || (workspacePath ? [workspacePath] : []);
  fs.writeFileSync(
    path.join(projectsDir, `${fileName}.json`),
    JSON.stringify({
      id,
      name,
      ...(paths.length
        ? {
            projectResources: {
              resources: paths.map((item) => ({
                gitFolder: {
                  folderUri: /^file:/i.test(item) ? item : `file://${item}`,
                },
              })),
            },
          }
        : {}),
    }),
  );
}

function encodeLengthDelimitedField(fieldNumber, value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  assert.ok(fieldNumber < 16, "test field number must fit one-byte key");
  assert.ok(buffer.length < 128, "test field value must fit one-byte varint");
  return Buffer.concat([
    Buffer.from([(fieldNumber << 3) | 2, buffer.length]),
    buffer,
  ]);
}

const METADATA_WORKSPACE_URIS_FIELD_NUMBER = 7;

function encodeMetadataBlob(workspaceUris, interferenceUris = []) {
  const chunks = [];
  for (const interferenceUri of interferenceUris) {
    chunks.push(encodeLengthDelimitedField(1, encodeLengthDelimitedField(1, interferenceUri)));
  }
  for (const workspaceUri of workspaceUris) {
    chunks.push(encodeLengthDelimitedField(METADATA_WORKSPACE_URIS_FIELD_NUMBER, workspaceUri));
  }
  return Buffer.concat(chunks);
}

function createConversationDb(dbPath, workspaceUris, {
  interferenceUris = [],
  rawMetadata = null,
} = {}) {
  const metadata = rawMetadata ?? encodeMetadataBlob(workspaceUris, interferenceUris);
  if (DatabaseSync) {
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE trajectory_metadata_blob (id TEXT, data BLOB)");
    db.exec("CREATE TABLE steps (content TEXT)");
    if (metadata.length) {
      db.prepare(
        "INSERT INTO trajectory_metadata_blob (id, data) VALUES ('main', ?)",
      ).run(metadata);
    }
    db.prepare("INSERT INTO steps (content) VALUES (?)").run(
      "unrelated file:///workspace/wrong path",
    );
    db.close();
    return;
  }

  const script = [
    "import sqlite3, sys",
    "db = sqlite3.connect(sys.argv[1])",
    "db.execute('CREATE TABLE trajectory_metadata_blob (id TEXT, data BLOB)')",
    "db.execute('CREATE TABLE steps (content TEXT)')",
    "metadata = bytes.fromhex(sys.argv[2])",
    "if metadata: db.execute(\"INSERT INTO trajectory_metadata_blob (id, data) VALUES ('main', ?)\", (metadata,))",
    "db.execute('INSERT INTO steps (content) VALUES (?)', ('unrelated file:///workspace/wrong path',))",
    "db.commit()",
    "db.close()",
  ].join("\n");
  if (PYTHON_SQLITE) {
    execFileSync(
      PYTHON_SQLITE.executable,
      [
        ...(PYTHON_SQLITE.launcherArg ? [PYTHON_SQLITE.launcherArg] : []),
        "-c",
        script,
        dbPath,
        metadata.toString("hex"),
      ],
    );
    return;
  }
  throw new Error("SQLite fixture creation requires node:sqlite or Python sqlite3");
}

function writeConversation(home, {
  id,
  workspaceUri = "",
  workspaceUris = null,
  interferenceUris = [],
  rawMetadata = null,
  request,
}) {
  const base = path.join(home, ".gemini", "antigravity");
  const conversationsDir = path.join(base, "conversations");
  const transcriptDir = path.join(
    base,
    "brain",
    id,
    ".system_generated",
    "logs",
  );
  fs.mkdirSync(conversationsDir, { recursive: true });
  fs.mkdirSync(transcriptDir, { recursive: true });

  const resolvedWorkspaceUris = workspaceUris || (workspaceUri ? [workspaceUri] : []);
  if (resolvedWorkspaceUris.length || interferenceUris.length || rawMetadata) {
    createConversationDb(
      path.join(conversationsDir, `${id}.db`),
      resolvedWorkspaceUris,
      { interferenceUris, rawMetadata },
    );
  }

  fs.writeFileSync(
    path.join(transcriptDir, "transcript.jsonl"),
    JSON.stringify({
      type: "USER_INPUT",
      content: `<USER_REQUEST>\n${request}\n</USER_REQUEST>`,
    }),
  );
}

function runNodeScript(script) {
  return execFileSync(process.execPath, [], {
    input: script,
    encoding: "utf8",
    env: process.env,
  });
}

async function discoverProjects(home, {
  disableNodeSqlite = false,
  disablePythonSqlite = false,
} = {}) {
  const previous = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    PATH: process.env.PATH,
    SHRIMP_REMOTE_SESSION_DISABLE_NODE_SQLITE:
      process.env.SHRIMP_REMOTE_SESSION_DISABLE_NODE_SQLITE,
    SHRIMP_REMOTE_SESSION_DISABLE_PYTHON_SQLITE:
      process.env.SHRIMP_REMOTE_SESSION_DISABLE_PYTHON_SQLITE,
  };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  if (disableNodeSqlite) {
    process.env.SHRIMP_REMOTE_SESSION_DISABLE_NODE_SQLITE = "1";
  } else {
    delete process.env.SHRIMP_REMOTE_SESSION_DISABLE_NODE_SQLITE;
  }
  if (disablePythonSqlite) {
    process.env.SHRIMP_REMOTE_SESSION_DISABLE_PYTHON_SQLITE = "1";
  } else {
    delete process.env.SHRIMP_REMOTE_SESSION_DISABLE_PYTHON_SQLITE;
  }
  try {
    const host = createSshHostBackend({
      peer: {
        id: "test-ssh",
        transport: { type: "ssh", host: "test", port: 22 },
        auth: { ssh: { username: "tester" } },
      },
      logger: { warn() {}, log() {} },
      runRemoteNodeScriptImpl: runNodeScript,
    });
    await host.attach();
    return await host.listProjects();
  } finally {
    if (previous.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = previous.HOME;
    if (previous.USERPROFILE === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previous.USERPROFILE;
    process.env.PATH = previous.PATH;
    if (previous.SHRIMP_REMOTE_SESSION_DISABLE_NODE_SQLITE === undefined) {
      delete process.env.SHRIMP_REMOTE_SESSION_DISABLE_NODE_SQLITE;
    } else {
      process.env.SHRIMP_REMOTE_SESSION_DISABLE_NODE_SQLITE =
        previous.SHRIMP_REMOTE_SESSION_DISABLE_NODE_SQLITE;
    }
    if (previous.SHRIMP_REMOTE_SESSION_DISABLE_PYTHON_SQLITE === undefined) {
      delete process.env.SHRIMP_REMOTE_SESSION_DISABLE_PYTHON_SQLITE;
    } else {
      process.env.SHRIMP_REMOTE_SESSION_DISABLE_PYTHON_SQLITE =
        previous.SHRIMP_REMOTE_SESSION_DISABLE_PYTHON_SQLITE;
    }
  }
}

async function createConversation(home, projectId) {
  const previous = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    PATH: process.env.PATH,
  };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    const host = createSshHostBackend({
      peer: {
        id: "test-ssh",
        transport: { type: "ssh", host: "test", port: 22 },
        auth: { ssh: { username: "tester" } },
      },
      logger: { warn() {}, log() {} },
      runRemoteNodeScriptImpl: runNodeScript,
    });
    await host.attach();
    return await host.createConversation(projectId);
  } finally {
    if (previous.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = previous.HOME;
    if (previous.USERPROFILE === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previous.USERPROFILE;
    process.env.PATH = previous.PATH;
  }
}

test("SSH project discovery uses workspace metadata instead of transcript mentions", {
  skip: !CAN_CREATE_SQLITE_FIXTURE,
}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-grouping-"));
  writeProject(home, {
    id: "app",
    name: "app",
    workspacePath: "/workspace/app",
  });
  writeProject(home, {
    id: "app-server",
    name: "app-server",
    workspacePath: "/workspace/app-server",
  });
  writeConversation(home, {
    id: "11111111-1111-4111-8111-111111111111",
    workspaceUri: "file:///workspace/app-server/",
    request: "请检查 app 项目，但不要根据这句话猜测当前工作区",
  });

  const projects = await discoverProjects(home);
  const app = projects.find((project) => project.id === "app");
  const appServer = projects.find((project) => project.id === "app-server");

  assert.equal(app.conversations.length, 0);
  assert.deepEqual(
    appServer.conversations.map((conversation) => conversation.id),
    ["11111111-1111-4111-8111-111111111111"],
  );
});

test("SSH project discovery leaves name-only legacy conversations ungrouped", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-unmatched-"));
  writeProject(home, {
    id: "api",
    name: "api",
    workspacePath: "/workspace/api",
  });
  writeConversation(home, {
    id: "22222222-2222-4222-8222-222222222222",
    request: "更新 api 接口文档",
  });

  const projects = await discoverProjects(home);
  const api = projects.find((project) => project.id === "api");
  assert.equal(api.conversations.length, 0);
});

test("SSH project discovery does not treat a project id as a workspace path", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-id-only-"));
  writeProject(home, { id: "api", name: "api" });
  writeConversation(home, {
    id: "44444444-4444-4444-8444-444444444444",
    request: "update api docs",
  });

  const projects = await discoverProjects(home);
  const api = projects.find((project) => project.id === "api");
  assert.equal(api.path, "");
  assert.equal(api.conversations.length, 0);
});

test("SSH project discovery reads workspace metadata without node:sqlite", {
  skip: !PYTHON_SQLITE,
}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-raw-sqlite-"));
  writeProject(home, {
    id: "worker",
    name: "worker",
    workspacePath: "/workspace/worker",
  });
  writeProject(home, {
    id: "wrong",
    name: "wrong",
    workspacePath: "/workspace/wrong",
  });
  writeConversation(home, {
    id: "55555555-5555-4555-8555-555555555555",
    workspaceUri: "file:///workspace/worker",
    request: "没有在正文里写工作区路径",
  });

  const projects = await discoverProjects(home, { disableNodeSqlite: true });
  const worker = projects.find((project) => project.id === "worker");
  const wrong = projects.find((project) => project.id === "wrong");
  assert.equal(wrong.conversations.length, 0);
  assert.deepEqual(
    worker.conversations.map((conversation) => conversation.id),
    ["55555555-5555-4555-8555-555555555555"],
  );
});

test("SSH project discovery encodes special characters in Python SQLite paths", {
  skip: !PYTHON_SQLITE,
}, async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-special-parent-"));
  const home = path.join(parent, "user#one");
  fs.mkdirSync(home, { recursive: true });
  writeProject(home, {
    id: "right",
    name: "right",
    workspacePath: "/workspace/right",
  });
  writeProject(home, {
    id: "wrong",
    name: "wrong",
    workspacePath: "/workspace/wrong",
  });
  writeConversation(home, {
    id: "77777777-7777-4777-8777-777777777777",
    workspaceUri: "file:///workspace/right",
    request: "请查看 /workspace/wrong，但这不是当前工作区",
  });

  const projects = await discoverProjects(home, { disableNodeSqlite: true });
  const right = projects.find((project) => project.id === "right");
  const wrong = projects.find((project) => project.id === "wrong");
  assert.equal(wrong.conversations.length, 0);
  assert.deepEqual(
    right.conversations.map((conversation) => conversation.id),
    ["77777777-7777-4777-8777-777777777777"],
  );
});

test("SSH project discovery preserves UNC authorities when matching metadata", {
  skip: !CAN_CREATE_SQLITE_FIXTURE,
}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-unc-"));
  writeProject(home, {
    id: "server-a",
    name: "server-a",
    workspacePath: "file://server-a/share/project",
  });
  writeProject(home, {
    id: "server-b",
    name: "server-b",
    workspacePath: "file://server-b/share/project",
  });
  writeConversation(home, {
    id: "66666666-6666-4666-8666-666666666666",
    workspaceUri: "file://server-b/share/project/",
    request: "修复共享目录里的任务",
  });

  const projects = await discoverProjects(home);
  const serverA = projects.find((project) => project.id === "server-a");
  const serverB = projects.find((project) => project.id === "server-b");
  assert.equal(serverA.conversations.length, 0);
  assert.deepEqual(
    serverB.conversations.map((conversation) => conversation.id),
    ["66666666-6666-4666-8666-666666666666"],
  );
});

test("SSH project discovery falls back only to an unambiguous full project path", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-path-fallback-"));
  writeProject(home, {
    id: "web",
    name: "web",
    workspacePath: "/workspace/web",
  });
  writeProject(home, {
    id: "web-admin",
    name: "web-admin",
    workspacePath: "/workspace/web-admin",
  });
  writeConversation(home, {
    id: "33333333-3333-4333-8333-333333333333",
    request: "请在 /workspace/web-admin 修复登录页面",
  });

  const projects = await discoverProjects(home);
  const web = projects.find((project) => project.id === "web");
  const webAdmin = projects.find((project) => project.id === "web-admin");

  assert.equal(web.conversations.length, 0);
  assert.deepEqual(
    webAdmin.conversations.map((conversation) => conversation.id),
    ["33333333-3333-4333-8333-333333333333"],
  );
});

test("SSH project discovery decodes Windows paths before transcript fallback matching", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-windows-fallback-"));
  writeProject(home, {
    id: "windows-app",
    name: "windows-app",
    workspacePath: "file:///C:/Workspace/App",
  });
  writeConversation(home, {
    id: "88888888-8888-4888-8888-888888888888",
    request: "请在 C:\\Workspace\\App 修复登录页面",
  });

  const projects = await discoverProjects(home);
  const windowsApp = projects.find((project) => project.id === "windows-app");

  assert.deepEqual(
    windowsApp.conversations.map((conversation) => conversation.id),
    ["88888888-8888-4888-8888-888888888888"],
  );
});

test("SSH project discovery decodes UNC paths before transcript fallback matching", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-unc-fallback-"));
  writeProject(home, {
    id: "unc-app",
    name: "unc-app",
    workspacePath: "file://server-a/share/project",
  });
  writeConversation(home, {
    id: "99999999-9999-4999-8999-999999999999",
    request: "请在 \\\\SERVER-A\\Share\\Project 修复登录页面",
  });

  const projects = await discoverProjects(home);
  const uncApp = projects.find((project) => project.id === "unc-app");

  assert.deepEqual(
    uncApp.conversations.map((conversation) => conversation.id),
    ["99999999-9999-4999-8999-999999999999"],
  );
});

test("SSH project discovery ignores paths outside decoded transcript content", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-thinking-fallback-"));
  const conversationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  writeProject(home, {
    id: "app",
    name: "app",
    workspacePath: "/workspace/app",
  });
  writeConversation(home, {
    id: conversationId,
    request: "没有提供工作区路径",
  });
  const transcriptPath = path.join(
    home,
    ".gemini",
    "antigravity",
    "brain",
    conversationId,
    ".system_generated",
    "logs",
    "transcript.jsonl",
  );
  fs.writeFileSync(
    transcriptPath,
    JSON.stringify({
      type: "PLANNER_RESPONSE",
      content: "",
      thinking: "Current workspace is /workspace/app.",
    }),
  );

  const projects = await discoverProjects(home);
  const app = projects.find((project) => project.id === "app");

  assert.equal(app.conversations.length, 0);
});

test("SSH project discovery skips malformed transcript records during path fallback", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-malformed-fallback-"));
  const conversationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  writeProject(home, {
    id: "app",
    name: "app",
    workspacePath: "/workspace/app",
  });
  writeConversation(home, {
    id: conversationId,
    request: "没有提供工作区路径",
  });
  const transcriptPath = path.join(
    home,
    ".gemini",
    "antigravity",
    "brain",
    conversationId,
    ".system_generated",
    "logs",
    "transcript.jsonl",
  );
  fs.writeFileSync(transcriptPath, "BROKEN RECORD /workspace/app");

  const projects = await discoverProjects(home);
  const app = projects.find((project) => project.id === "app");

  assert.equal(app.conversations.length, 0);
});

for (const [label, request] of [
  ["trailing separator", "请检查 /workspace/app/"],
  ["descendant file", "请检查 /workspace/app/src/index.js"],
  ["file URI", "请检查 file:///workspace/app"],
]) {
  test(`SSH project discovery matches a full project root inside ${label}`, async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-contained-path-"));
    writeProject(home, {
      id: "app",
      name: "app",
      workspacePath: "/workspace/app",
    });
    writeConversation(home, {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      request,
    });

    const projects = await discoverProjects(home);
    const app = projects.find((project) => project.id === "app");

    assert.deepEqual(
      app.conversations.map((conversation) => conversation.id),
      ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
    );
  });
}

test("SSH project discovery normalizes UNC dot segments and repeated separators", {
  skip: !CAN_CREATE_SQLITE_FIXTURE,
}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-unc-normalize-"));
  writeProject(home, {
    id: "unc-app",
    name: "unc-app",
    workspacePath: "file://server/share/app",
  });
  writeConversation(home, {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    workspaceUri: "file://SERVER/share/team/..//app/",
    request: "没有在正文里写工作区路径",
  });

  const projects = await discoverProjects(home);
  const app = projects.find((project) => project.id === "unc-app");

  assert.deepEqual(
    app.conversations.map((conversation) => conversation.id),
    ["dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
  );
});

test("SSH project discovery accepts case-insensitive file URI schemes", {
  skip: !CAN_CREATE_SQLITE_FIXTURE,
}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-file-scheme-"));
  writeProject(home, {
    id: "app",
    name: "app",
    workspacePath: "/workspace/app",
  });
  writeConversation(home, {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    workspaceUri: "FILE:///workspace/app",
    request: "没有在正文里写工作区路径",
  });

  const projects = await discoverProjects(home);
  const app = projects.find((project) => project.id === "app");

  assert.deepEqual(
    app.conversations.map((conversation) => conversation.id),
    ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"],
  );
});

test("SSH project discovery groups conversations by every workspace resource", {
  skip: !CAN_CREATE_SQLITE_FIXTURE,
}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-multi-resource-"));
  writeProject(home, {
    id: "workspace",
    name: "workspace",
    workspacePaths: ["/workspace/one", "/workspace/two"],
  });
  writeConversation(home, {
    id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    workspaceUri: "file:///workspace/two",
    request: "没有在正文里写工作区路径",
  });

  const projects = await discoverProjects(home);
  const workspace = projects.find((project) => project.id === "workspace");

  assert.equal(workspace.path, "/workspace/one");
  assert.deepEqual(
    workspace.conversations.map((conversation) => conversation.id),
    ["ffffffff-ffff-4fff-8fff-ffffffffffff"],
  );
});

test("SSH project discovery reads only top-level workspace URI metadata", {
  skip: !CAN_CREATE_SQLITE_FIXTURE,
}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-metadata-field-"));
  writeProject(home, {
    id: "repo",
    name: "repo",
    workspacePath: "/repo",
  });
  writeProject(home, {
    id: "app",
    name: "app",
    workspacePath: "/repo/app",
  });
  writeConversation(home, {
    id: "10101010-1010-4010-8010-101010101010",
    workspaceUri: "file:///repo/app",
    interferenceUris: ["file:///repo"],
    request: "没有在正文里写工作区路径",
  });

  const projects = await discoverProjects(home);
  const repo = projects.find((project) => project.id === "repo");
  const app = projects.find((project) => project.id === "app");

  assert.equal(repo.conversations.length, 0);
  assert.deepEqual(
    app.conversations.map((conversation) => conversation.id),
    ["10101010-1010-4010-8010-101010101010"],
  );
});

test("SSH project discovery does not fall back after malformed metadata", {
  skip: !CAN_CREATE_SQLITE_FIXTURE,
}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-invalid-metadata-"));
  writeProject(home, {
    id: "wrong",
    name: "wrong",
    workspacePath: "/workspace/wrong",
  });
  writeConversation(home, {
    id: "14141414-1414-4414-8414-141414141414",
    rawMetadata: Buffer.from([0x3a, 0x20, 0x66]),
    request: "请检查 /workspace/wrong",
  });

  const projects = await discoverProjects(home);
  const wrong = projects.find((project) => project.id === "wrong");

  assert.equal(wrong.conversations.length, 0);
});

test("SSH project discovery rejects protobuf metadata with field number zero", {
  skip: !CAN_CREATE_SQLITE_FIXTURE,
}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-zero-field-metadata-"));
  writeProject(home, {
    id: "wrong",
    name: "wrong",
    workspacePath: "/workspace/wrong",
  });
  writeConversation(home, {
    id: "24242424-2424-4424-8424-242424242424",
    rawMetadata: Buffer.from([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
    request: "请检查 /workspace/wrong/src/a.js",
  });

  const projects = await discoverProjects(home);
  const wrong = projects.find((project) => project.id === "wrong");

  assert.equal(wrong.conversations.length, 0);
});

test("SSH project discovery rejects protobuf metadata above the maximum field number", {
  skip: !CAN_CREATE_SQLITE_FIXTURE,
}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-oversized-field-metadata-"));
  writeProject(home, {
    id: "wrong",
    name: "wrong",
    workspacePath: "/workspace/wrong",
  });
  writeConversation(home, {
    id: "25252525-2525-4525-8525-252525252525",
    rawMetadata: Buffer.from([0x80, 0x80, 0x80, 0x80, 0x10, 0x00]),
    request: "请检查 /workspace/wrong/src/a.js",
  });

  const projects = await discoverProjects(home);
  const wrong = projects.find((project) => project.id === "wrong");

  assert.equal(wrong.conversations.length, 0);
});

test("SSH project discovery falls back when valid metadata has no workspace URI", {
  skip: !CAN_CREATE_SQLITE_FIXTURE,
}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-empty-metadata-"));
  writeProject(home, {
    id: "app",
    name: "app",
    workspacePath: "/workspace/app",
  });
  writeConversation(home, {
    id: "17171717-1717-4717-8717-171717171717",
    rawMetadata: encodeLengthDelimitedField(2, "unrelated"),
    request: "请检查 /workspace/app/src/a.js",
  });

  const projects = await discoverProjects(home);
  const app = projects.find((project) => project.id === "app");

  assert.deepEqual(
    app.conversations.map((conversation) => conversation.id),
    ["17171717-1717-4717-8717-171717171717"],
  );
});

test("SSH project discovery does not fall back when no metadata reader is available", {
  skip: !CAN_CREATE_SQLITE_FIXTURE,
}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-no-metadata-reader-"));
  writeProject(home, {
    id: "wrong",
    name: "wrong",
    workspacePath: "/workspace/wrong",
  });
  writeConversation(home, {
    id: "15151515-1515-4515-8515-151515151515",
    workspaceUri: "file:///workspace/right",
    request: "请检查 /workspace/wrong",
  });

  const projects = await discoverProjects(home, {
    disableNodeSqlite: true,
    disablePythonSqlite: true,
  });
  const wrong = projects.find((project) => project.id === "wrong");

  assert.equal(wrong.conversations.length, 0);
});

test("SSH project discovery prefers the longest nested transcript workspace root", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-nested-root-"));
  writeProject(home, {
    id: "app",
    name: "app",
    workspacePath: "/workspace/app",
  });
  writeProject(home, {
    id: "admin",
    name: "admin",
    workspacePath: "/workspace/app/packages/admin",
  });
  writeConversation(home, {
    id: "16161616-1616-4616-8616-161616161616",
    request: "请检查 /workspace/app/packages/admin/src/a.js",
  });

  const projects = await discoverProjects(home);
  const app = projects.find((project) => project.id === "app");
  const admin = projects.find((project) => project.id === "admin");

  assert.equal(app.conversations.length, 0);
  assert.deepEqual(
    admin.conversations.map((conversation) => conversation.id),
    ["16161616-1616-4616-8616-161616161616"],
  );
});

test("SSH project discovery leaves independent transcript workspace roots ambiguous", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-independent-roots-"));
  writeProject(home, {
    id: "a",
    name: "a",
    workspacePath: "/workspace/a",
  });
  writeProject(home, {
    id: "long-project",
    name: "long-project",
    workspacePath: "/workspace/long-project",
  });
  writeConversation(home, {
    id: "18181818-1818-4818-8818-181818181818",
    request: "比较 /workspace/a/src/a.js 和 /workspace/long-project/src/b.js",
  });

  const projects = await discoverProjects(home);

  assert.equal(projects.find((project) => project.id === "a").conversations.length, 0);
  assert.equal(projects.find((project) => project.id === "long-project").conversations.length, 0);
});

test("SSH project discovery normalizes transcript dot segments before matching", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-transcript-normalize-"));
  writeProject(home, {
    id: "app",
    name: "app",
    workspacePath: "/workspace/app",
  });
  writeProject(home, {
    id: "other",
    name: "other",
    workspacePath: "/workspace/other",
  });
  writeConversation(home, {
    id: "19191919-1919-4919-8919-191919191919",
    request: "请检查 /workspace/app/../other/file.js",
  });

  const projects = await discoverProjects(home);
  const app = projects.find((project) => project.id === "app");
  const other = projects.find((project) => project.id === "other");

  assert.equal(app.conversations.length, 0);
  assert.deepEqual(
    other.conversations.map((conversation) => conversation.id),
    ["19191919-1919-4919-8919-191919191919"],
  );
});

for (const [label, appPath, otherPath, request] of [
  [
    "POSIX",
    "/workspace/app",
    "/workspace/other",
    "请检查 /workspace/app/src/../../other/file.js",
  ],
  [
    "Windows with spaces",
    "C:/Work/My App",
    "C:/Work/Other",
    "请检查 C:\\Work\\My App\\src\\..\\..\\Other\\file.js",
  ],
]) {
  test(`SSH project discovery follows deep ${label} dot segments out of the original workspace`, async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-deep-dot-segments-"));
    writeProject(home, {
      id: "app",
      name: "app",
      workspacePath: appPath,
    });
    writeProject(home, {
      id: "other",
      name: "other",
      workspacePath: otherPath,
    });
    writeConversation(home, {
      id: "22222222-2222-4222-8222-222222222222",
      request,
    });

    const projects = await discoverProjects(home);
    const app = projects.find((project) => project.id === "app");
    const other = projects.find((project) => project.id === "other");

    assert.equal(app.conversations.length, 0);
    assert.deepEqual(
      other.conversations.map((conversation) => conversation.id),
      ["22222222-2222-4222-8222-222222222222"],
    );
  });
}

for (const [label, workspacePath, request] of [
  ["POSIX", "/workspace/My App", "请检查 /workspace/My App/src/a.js"],
  ["Windows", "C:/Program Files/App", "请检查 C:\\Program Files\\App\\src\\a.js"],
]) {
  test(`SSH project discovery matches an unquoted ${label} workspace path containing spaces`, async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-spaced-path-"));
    writeProject(home, {
      id: "spaced-app",
      name: "spaced-app",
      workspacePath,
    });
    writeConversation(home, {
      id: "20202020-2020-4020-8020-202020202020",
      request,
    });

    const projects = await discoverProjects(home);
    const app = projects.find((project) => project.id === "spaced-app");

    assert.deepEqual(
      app.conversations.map((conversation) => conversation.id),
      ["20202020-2020-4020-8020-202020202020"],
    );
  });
}

for (const [scheme, url] of [
  ["HTTPS", "https://example.com/repo/docs"],
  ["FTP", "ftp://example.com/repo/docs"],
  ["SSH", "ssh://example.com/repo/docs"],
]) {
  test(`SSH project discovery does not treat an ${scheme} URL as a workspace path`, async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-non-file-url-"));
    writeProject(home, {
      id: "remote-share",
      name: "remote-share",
      workspacePath: "file://example.com/repo",
    });
    writeConversation(home, {
      id: "21212121-2121-4121-8121-212121212121",
      request: `参考 ${url}`,
    });

    const projects = await discoverProjects(home);
    const remoteShare = projects.find((project) => project.id === "remote-share");

    assert.equal(remoteShare.conversations.length, 0);
  });
}

test("SSH project discovery matches a file URI containing an unencoded space", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-file-uri-space-"));
  writeProject(home, {
    id: "spaced-app",
    name: "spaced-app",
    workspacePath: "file:///workspace/My%20App",
  });
  writeConversation(home, {
    id: "23232323-2323-4323-8323-232323232323",
    request: "打开 file:///workspace/My App/src/a.js",
  });

  const projects = await discoverProjects(home);
  const app = projects.find((project) => project.id === "spaced-app");

  assert.deepEqual(
    app.conversations.map((conversation) => conversation.id),
    ["23232323-2323-4323-8323-232323232323"],
  );
});

test("SSH project discovery does not guess from transcript after metadata read failure", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-metadata-error-"));
  const conversationId = "12121212-1212-4212-8212-121212121212";
  writeProject(home, {
    id: "wrong",
    name: "wrong",
    workspacePath: "/workspace/wrong",
  });
  writeConversation(home, {
    id: conversationId,
    request: "请检查 /workspace/wrong",
  });
  const dbPath = path.join(
    home,
    ".gemini",
    "antigravity",
    "conversations",
    `${conversationId}.db`,
  );
  fs.writeFileSync(dbPath, "not a sqlite database");

  const projects = await discoverProjects(home);
  const wrong = projects.find((project) => project.id === "wrong");

  assert.equal(wrong.conversations.length, 0);
});

test("SSH project discovery leaves ambiguous multi-workspace metadata ungrouped", {
  skip: !CAN_CREATE_SQLITE_FIXTURE,
}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-metadata-ambiguous-"));
  writeProject(home, {
    id: "one",
    name: "one",
    workspacePath: "/workspace/one",
  });
  writeProject(home, {
    id: "two",
    name: "two",
    workspacePath: "/workspace/two",
  });
  writeConversation(home, {
    id: "13131313-1313-4313-8313-131313131313",
    workspaceUris: ["file:///workspace/one", "file:///workspace/two"],
    request: "请检查 /workspace/one",
  });

  const projects = await discoverProjects(home);
  assert.equal(projects.find((project) => project.id === "one").conversations.length, 0);
  assert.equal(projects.find((project) => project.id === "two").conversations.length, 0);
});

test("SSH createConversation resolves a project id to its real workspace path", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-create-path-"));
  writeProject(home, {
    id: "opaque-project-id",
    name: "app",
    workspacePath: "/workspace/app",
  });

  const created = await createConversation(home, "opaque-project-id");

  assert.equal(created.workspaceUri, "file:///workspace/app");
});

test("SSH createConversation resolves a path-like project id before using it as a path", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-create-path-like-id-"));
  writeProject(home, {
    id: "/opaque/project-id",
    fileName: "path-like-project-id",
    name: "app",
    workspacePath: "/workspace/real",
  });

  const created = await createConversation(home, "/opaque/project-id");

  assert.equal(created.workspaceUri, "file:///workspace/real");
});

test("SSH createConversation rejects an id that has no workspace path", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-create-no-path-"));
  writeProject(home, { id: "opaque-project-id", name: "app" });

  await assert.rejects(
    () => createConversation(home, "opaque-project-id"),
    /workspace path/i,
  );
});

test("SSH createConversation rejects a path-like stored id with no workspace path", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-create-path-like-no-path-"));
  writeProject(home, {
    id: "/opaque/project-id",
    fileName: "path-like-project-id",
    name: "app",
  });

  await assert.rejects(
    () => createConversation(home, "/opaque/project-id"),
    /workspace path/i,
  );
});

test("SSH createConversation rejects an unknown path-like project id", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rs-ssh-create-unknown-path-id-"));

  await assert.rejects(
    () => createConversation(home, "/not/a/stored/project"),
    /project not found/i,
  );
});
