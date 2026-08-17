import test from "node:test";
import assert from "node:assert/strict";
import { parseDatabaseUrl, loadDataSources } from "../lib/config-loader.mjs";

test("parseDatabaseUrl parses standard mysql URL", () => {
  const res = parseDatabaseUrl("mysql://root:secret%23123@192.168.1.50:3307/shop_db", "shop");
  assert.equal(res.id, "shop");
  assert.equal(res.type, "mysql");
  assert.equal(res.host, "192.168.1.50");
  assert.equal(res.port, 3307);
  assert.equal(res.user, "root");
  assert.equal(res.password, "secret#123");
  assert.equal(res.database, "shop_db");
});

test("parseDatabaseUrl parses JDBC MySQL URL seamlessly", () => {
  const res = parseDatabaseUrl("jdbc:mysql://10.0.0.8:3306/order_center?user=admin&password=my_password&useSSL=false", "orders");
  assert.equal(res.id, "orders");
  assert.equal(res.type, "mysql");
  assert.equal(res.host, "10.0.0.8");
  assert.equal(res.port, 3306);
  assert.equal(res.user, "admin");
  assert.equal(res.password, "my_password");
  assert.equal(res.database, "order_center");
  assert.equal(res.ssl, false);
});

test("parseDatabaseUrl parses redis and rediss URL with auth & dbIndex", () => {
  const res = parseDatabaseUrl("redis://:redis_pass@127.0.0.1:6379/3", "cache");
  assert.equal(res.id, "cache");
  assert.equal(res.type, "redis");
  assert.equal(res.host, "127.0.0.1");
  assert.equal(res.port, 6379);
  assert.equal(res.password, "redis_pass");
  assert.equal(res.db, 3);
  assert.equal(res.tls, false);
});

test("parseDatabaseUrl parses sqlite URL and file paths", () => {
  const res = parseDatabaseUrl("sqlite:///d:/data/mydb.sqlite", "local_db");
  assert.equal(res.id, "local_db");
  assert.equal(res.type, "sqlite");
  assert.ok(res.path.includes("mydb.sqlite"));
});

test("loadDataSources discovers multiple databases from env key-value pairs", () => {
  const fakeEnv = {
    order_db: "mysql://root:123@192.168.1.10:3306/orders",
    user_db: "jdbc:mysql://192.168.1.20:3306/users?user=root&password=456",
    cache_redis: "redis://:auth123@192.168.1.30:6379/0",
    local_sqlite: "sqlite:///d:/app/local.db",
    PATH: "C:\\Windows\\system32",
    NODE_ENV: "production",
  };

  const sources = loadDataSources(fakeEnv);
  assert.equal(sources.length, 4);

  const byId = new Map(sources.map((s) => [s.id, s]));
  assert.equal(byId.get("order_db").type, "mysql");
  assert.equal(byId.get("order_db").database, "orders");

  assert.equal(byId.get("user_db").type, "mysql");
  assert.equal(byId.get("user_db").user, "root");

  assert.equal(byId.get("cache_redis").type, "redis");
  assert.equal(byId.get("cache_redis").password, "auth123");

  assert.equal(byId.get("local_sqlite").type, "sqlite");
});

test("loadDataSources handles grouped prefix and JSON config", () => {
  const fakeEnv = {
    MYSQL_PROD_HOST: "192.168.1.99",
    MYSQL_PROD_PORT: "3306",
    MYSQL_PROD_USER: "prod_admin",
    MYSQL_PROD_PASSWORD: "secret_prod",
    MYSQL_PROD_DATABASE: "production_db",
  };

  const sources = loadDataSources(fakeEnv);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].id, "prod");
  assert.equal(sources[0].user, "prod_admin");
  assert.equal(sources[0].database, "production_db");
});
