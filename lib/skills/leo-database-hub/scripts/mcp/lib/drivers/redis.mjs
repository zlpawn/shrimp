import net from "node:net";

/**
 * Redis Adapter for MCP
 * Uses ioredis if available, or falls back to an ultra-lightweight native RESP client (zero dependencies).
 */

class RespClient {
  constructor(config) {
    this.host = config.host || "127.0.0.1";
    this.port = config.port || 6379;
    this.password = config.password;
    this.db = config.db || 0;
    this.socket = null;
    this.buffer = "";
    this.queue = [];
  }

  async connect() {
    if (this.socket && !this.socket.destroyed) return;

    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port }, async () => {
        this.socket = socket;
        try {
          if (this.password) {
            await this.sendCommand(["AUTH", this.password]);
          }
          if (this.db > 0) {
            await this.sendCommand(["SELECT", String(this.db)]);
          }
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      socket.on("error", (err) => {
        if (this.queue.length > 0) {
          const req = this.queue.shift();
          req.reject(err);
        }
        reject(err);
      });

      socket.on("data", (chunk) => {
        this.buffer += chunk.toString("binary");
        this.processBuffer();
      });

      socket.on("close", () => {
        this.socket = null;
      });
    });
  }

  processBuffer() {
    while (this.queue.length > 0 && this.buffer.length > 0) {
      const parsed = this.parseResp(0);
      if (parsed === null) break; // Not enough data yet

      const [result, bytesConsumed] = parsed;
      this.buffer = this.buffer.slice(bytesConsumed);
      const req = this.queue.shift();
      req.resolve(result);
    }
  }

  parseResp(offset) {
    if (offset >= this.buffer.length) return null;
    const type = this.buffer[offset];
    const crlfIndex = this.buffer.indexOf("\r\n", offset);
    if (crlfIndex === -1) return null;

    const line = this.buffer.slice(offset + 1, crlfIndex);

    if (type === "+") { // Simple String
      return [line, crlfIndex + 2 - offset];
    }
    if (type === "-") { // Error
      return [new Error(line), crlfIndex + 2 - offset];
    }
    if (type === ":") { // Integer
      return [parseInt(line, 10), crlfIndex + 2 - offset];
    }
    if (type === "$") { // Bulk String
      const len = parseInt(line, 10);
      if (len === -1) return [null, crlfIndex + 2 - offset];
      const strStart = crlfIndex + 2;
      const strEnd = strStart + len;
      if (this.buffer.length < strEnd + 2) return null; // Incomplete bulk string
      const strVal = this.buffer.slice(strStart, strEnd);
      return [strVal, strEnd + 2 - offset];
    }
    if (type === "*") { // Array
      const count = parseInt(line, 10);
      if (count === -1) return [null, crlfIndex + 2 - offset];
      let currentOffset = crlfIndex + 2;
      const items = [];
      for (let i = 0; i < count; i++) {
        const itemRes = this.parseResp(currentOffset);
        if (itemRes === null) return null;
        items.push(itemRes[0]);
        currentOffset += itemRes[1];
      }
      return [items, currentOffset - offset];
    }

    return [line, crlfIndex + 2 - offset];
  }

  async sendCommand(args) {
    await this.connect();
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      // Encode RESP array
      let payload = `*${args.length}\r\n`;
      for (const arg of args) {
        const str = String(arg);
        const byteLen = Buffer.byteLength(str);
        payload += `$${byteLen}\r\n${str}\r\n`;
      }
      this.socket.write(payload, "binary");
    });
  }

  async close() {
    if (this.socket) {
      this.socket.end();
      this.socket.destroy();
      this.socket = null;
    }
  }
}

export class RedisAdapter {
  constructor(config) {
    this.config = config;
    this.client = null;
    this.useIoRedis = false;
  }

  async getClient() {
    if (this.client) return this.client;
    try {
      const ioRedisModule = await import("ioredis");
      const Redis = ioRedisModule.default || ioRedisModule;
      this.client = new Redis({
        host: this.config.host || "127.0.0.1",
        port: this.config.port || 6379,
        password: this.config.password || undefined,
        db: this.config.db || 0,
        lazyConnect: true,
        connectTimeout: 8000,
      });
      await this.client.connect();
      this.useIoRedis = true;
      return this.client;
    } catch {
      // Fallback to built-in RESP client
      const resp = new RespClient(this.config);
      await resp.connect();
      this.client = resp;
      this.useIoRedis = false;
      return this.client;
    }
  }

  async testConnection() {
    const client = await this.getClient();
    if (this.useIoRedis) {
      const res = await client.ping();
      return res === "PONG";
    }
    const res = await client.sendCommand(["PING"]);
    return res === "PONG";
  }

  async scanKeys(pattern = "*", count = 50) {
    const client = await this.getClient();
    let keys = [];

    if (this.useIoRedis) {
      const [, found] = await client.scan(0, "MATCH", pattern, "COUNT", count);
      keys = found;
    } else {
      const res = await client.sendCommand(["SCAN", "0", "MATCH", pattern, "COUNT", String(count)]);
      keys = Array.isArray(res) && Array.isArray(res[1]) ? res[1] : [];
    }

    // Enrich with type and ttl for the first 20 keys
    const enriched = [];
    for (const key of keys.slice(0, 30)) {
      try {
        const [type, ttl] = await Promise.all([
          this.executeCommand("TYPE", [key]),
          this.executeCommand("TTL", [key]),
        ]);
        enriched.push({ key, type, ttl });
      } catch {
        enriched.push({ key, type: "unknown", ttl: -1 });
      }
    }

    return {
      pattern,
      totalFound: keys.length,
      keys: enriched,
    };
  }

  async getKey(key) {
    const type = await this.executeCommand("TYPE", [key]);
    const ttl = await this.executeCommand("TTL", [key]);
    let value = null;

    switch (String(type).toLowerCase()) {
      case "string":
        value = await this.executeCommand("GET", [key]);
        try {
          // Attempt JSON parse if it looks like JSON
          if (typeof value === "string" && (value.startsWith("{") || value.startsWith("["))) {
            value = JSON.parse(value);
          }
        } catch {}
        break;
      case "hash": {
        const entries = await this.executeCommand("HGETALL", [key]);
        if (Array.isArray(entries)) {
          const map = {};
          for (let i = 0; i < entries.length; i += 2) {
            map[entries[i]] = entries[i + 1];
          }
          value = map;
        } else {
          value = entries;
        }
        break;
      }
      case "list":
        value = await this.executeCommand("LRANGE", [key, "0", "99"]);
        break;
      case "set":
        value = await this.executeCommand("SMEMBERS", [key]);
        break;
      case "zset":
        value = await this.executeCommand("ZRANGE", [key, "0", "99", "WITHSCORES"]);
        break;
      case "none":
        return { key, exists: false };
      default:
        value = `[Unsupported type: ${type}]`;
    }

    return {
      key,
      type,
      ttl,
      value,
    };
  }

  async executeCommand(command, args = []) {
    const client = await this.getClient();
    const cmdUpper = String(command).toUpperCase();
    const allArgs = [cmdUpper, ...args.map(String)];

    if (this.useIoRedis) {
      return await client.call(cmdUpper, ...args);
    }
    const res = await client.sendCommand(allArgs);
    if (res instanceof Error) throw res;
    return res;
  }

  async close() {
    if (this.client) {
      if (this.useIoRedis) {
        this.client.disconnect();
      } else {
        await this.client.close();
      }
      this.client = null;
    }
  }
}
