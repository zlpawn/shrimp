import { test } from "node:test";
import assert from "node:assert/strict";
import EventEmitter from "node:events";
import { grpcUnary } from "../../lib/antigravity/grpc.mjs";

test("grpcUnary sends one frame and resolves the decoded response", async () => {
  let requestedPath = "";
  let requestBody = null;
  const fakeClient = {
    request(headers) {
      requestedPath = headers[":path"];
      const stream = new EventEmitter();
      stream.end = (body) => {
        requestBody = body;
        queueMicrotask(() => {
          stream.emit("response", {});
          stream.emit("data", Buffer.from([0, 0, 0, 0, 2, 0x18, 0x0c, 0x20, 0x58]));
          stream.emit("close");
        });
      };
      return stream;
    },
    destroy() {},
  };
  const payload = await grpcUnary({
    client: fakeClient,
    path: "/service/Method",
    requestBuffer: Buffer.from([1, 2]),
    decode: (buffer) => ({ remainingCredits: buffer.readUInt8(1) }),
  });
  assert.equal(requestedPath, "/service/Method");
  assert.deepEqual([...requestBody.slice(0, 5)], [0, 0, 0, 0, 2]);
  assert.deepEqual([...requestBody.slice(5)], [1, 2]);
  assert.equal(payload.remainingCredits, 12);
});
