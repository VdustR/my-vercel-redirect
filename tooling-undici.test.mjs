import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

export default async function fixture(req, res) {
  const url = new URL(req.url, "http://fixture.local");
  if (url.pathname === "/error") throw new Error("intentional-consumer-error");
  if (url.pathname === "/stream") {
    res.setHeader("content-type", "text/plain");
    res.write("first:");
    await new Promise((resolve) => setTimeout(resolve, 20));
    res.end("second");
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  res.statusCode = Number(url.searchParams.get("status") || "201");
  res.setHeader("content-type", "application/json");
  res.setHeader("set-cookie", ["a=1; Path=/", "b=2; Path=/"]);
  res.end(
    JSON.stringify({
      method: req.method,
      pathname: url.pathname,
      query: url.search,
      body,
      custom: req.headers["x-fixture"],
    }),
  );
}

async function run() {
  const root = path.resolve(
    process.argv[2] || path.dirname(fileURLToPath(import.meta.url)),
  );
  const resultPath = process.argv[3];
  const result = {
    root,
    node: process.version,
    checks: [],
    failures: [],
    limitations: [],
  };
  const servers = [],
    sockets = new Set(),
    children = [],
    dispatchers = [];
  let childOutput = "";
  const envNames = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
  ];
  const savedEnv = Object.fromEntries(envNames.map((k) => [k, process.env[k]]));
  for (const k of envNames) delete process.env[k];
  function keepSocket(s) {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
    return s;
  }
  async function server(handler) {
    const s = http.createServer(handler);
    s.on("connection", keepSocket);
    servers.push(s);
    await new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
    return s;
  }
  async function check(name, fn) {
    try {
      await fn();
      result.checks.push(name);
    } catch (e) {
      result.failures.push({ name, error: e.stack });
    }
  }
  async function devServer(entrypoint, config, cwd) {
    const rootRequire = createRequire(path.join(root, "package.json"));
    const cliRequire = createRequire(
      rootRequire.resolve("vercel/package.json"),
    );
    const executable = path.join(
      path.dirname(cliRequire.resolve("@vercel/node")),
      "dev-server.mjs",
    );
    const require = createRequire(executable);
    result.nodeConsumer = {
      executable,
      undici: require("undici/package.json").version,
    };
    const child = fork(executable, [], {
      cwd,
      env: {
        PATH: process.env.PATH,
        VERCEL_DEV_ENTRYPOINT: entrypoint,
        VERCEL_DEV_CONFIG: JSON.stringify(config),
        DOMAIN: "vdustr.dev",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    children.push(child);
    child.on("error", (e) => {
      childOutput += "child error: " + e.message + "\n";
    });
    child.stdout.on("data", (d) => (childOutput += d));
    child.stderr.on("data", (d) => (childOutput += d));
    const address = await new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error("dev-server readiness timeout " + childOutput)),
        20000,
      );
      child.once("message", (a) => {
        clearTimeout(t);
        resolve(a);
      });
      child.once("exit", (c) => {
        clearTimeout(t);
        reject(new Error("dev-server exited " + c + " " + childOutput));
      });
    });
    return { child, url: `http://127.0.0.1:${address.port}` };
  }
  async function stop(child) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (child.connected) child.send("shutdown", () => {});
    else child.kill("SIGTERM");
    await new Promise((resolve) => {
      const t = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 3000);
      child.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
  try {
    const rootRequire = createRequire(path.join(root, "package.json"));
    const cliDir = path.dirname(rootRequire.resolve("vercel/package.json"));
    const chunk = fs
      .readdirSync(path.join(cliDir, "dist/chunks"))
      .find((f) => f.startsWith("fetch-proxy-") && f.endsWith(".js"));
    const dispatcherFile = path.join(cliDir, "dist/chunks", chunk);
    const require = createRequire(dispatcherFile);
    result.cliConsumer = {
      dispatcherFile,
      undici: require("undici/package.json").version,
    };
    const { EnvProxyDispatcher } = await import(
      pathToFileURL(dispatcherFile).href
    );
    const upstream = await server(async (req, res) => {
      let body = "";
      for await (const c of req) body += c;
      res.statusCode = 202;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ method: req.method, path: req.url, body }));
    });
    const upstreamPort = upstream.address().port;
    const url = `http://127.0.0.1:${upstreamPort}/echo?q=one`;
    let connects = 0;
    const proxy = await server((req, res) => {
      res.writeHead(405).end();
    });
    proxy.on("connect", (req, client, head) => {
      connects++;
      const [host, p] = req.url.split(":");
      if (host !== "127.0.0.1" || Number(p) !== upstreamPort) {
        client.destroy();
        return;
      }
      const target = keepSocket(
        net.connect(Number(p), host, () => {
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length) target.write(head);
          target.pipe(client);
          client.pipe(target);
        }),
      );
      target.on("error", () => client.destroy());
      client.on("error", () => target.destroy());
    });
    await check("CLI native fetch direct GET/status/query", async () => {
      const d = new EnvProxyDispatcher();
      dispatchers.push(d);
      const r = await fetch(url, { dispatcher: d });
      assert.equal(r.status, 202);
      assert.deepEqual(await r.json(), {
        method: "GET",
        path: "/echo?q=one",
        body: "",
      });
      await d.close();
    });
    process.env.http_proxy = `http://127.0.0.1:${proxy.address().port}`;
    await check("CLI native fetch HTTP CONNECT proxy POST/body", async () => {
      const d = new EnvProxyDispatcher();
      dispatchers.push(d);
      const before = connects;
      const r = await fetch(url, {
        method: "POST",
        body: "proxy-body",
        dispatcher: d,
      });
      assert.deepEqual(await r.json(), {
        method: "POST",
        path: "/echo?q=one",
        body: "proxy-body",
      });
      assert.ok(connects > before);
      await d.close();
    });
    await check("CLI NO_PROXY bypass and live refresh", async () => {
      process.env.no_proxy = "127.0.0.1";
      const d = new EnvProxyDispatcher();
      dispatchers.push(d);
      const before = connects;
      await (await fetch(url, { dispatcher: d })).text();
      assert.equal(connects, before);
      delete process.env.no_proxy;
      await (await fetch(url, { dispatcher: d })).text();
      assert.ok(connects > before);
      await d.close();
    });
    await check("CLI dispatcher destroy lifecycle", async () => {
      delete process.env.http_proxy;
      const d = new EnvProxyDispatcher();
      dispatchers.push(d);
      await (await fetch(url, { dispatcher: d })).text();
      await d.destroy();
      await assert.rejects(fetch(url, { dispatcher: d }));
    });
    await check(
      "actual @vercel/node serverless relay GET/POST/query/status/cookies/stream/error",
      async () => {
        const { child, url: base } = await devServer(
          path.basename(fileURLToPath(import.meta.url)),
          { helpers: false },
          path.dirname(fileURLToPath(import.meta.url)),
        );
        try {
          const get = await fetch(base + "/echo?q=a&q=b&status=203", {
            headers: {
              "x-forwarded-host": "fixture.local",
              "x-fixture": "present",
            },
          });
          assert.equal(get.status, 203);
          assert.equal(get.headers.getSetCookie().length, 2);
          assert.deepEqual(await get.json(), {
            method: "GET",
            pathname: "/echo",
            query: "?q=a&q=b&status=203",
            body: "",
            custom: "present",
          });
          const post = await fetch(base + "/echo?status=201", {
            method: "POST",
            headers: { "x-forwarded-host": "fixture.local" },
            body: "serverless-body",
          });
          assert.equal(post.status, 201);
          assert.equal((await post.json()).body, "serverless-body");
          const stream = await fetch(base + "/stream", {
            headers: { "x-forwarded-host": "fixture.local" },
          });
          assert.equal(await stream.text(), "first:second");
          await assert.rejects(
            fetch(base + "/error", {
              headers: { "x-forwarded-host": "fixture.local" },
            }),
            /fetch failed/,
          );
          assert.match(childOutput, /intentional-consumer-error/);
          result.limitations.push(
            "Serverless default Node handler uncaught rejection terminates child on both baseline and candidate; experiment verifies the same transport rejection, not a 500 response.",
          );
        } finally {
          await stop(child);
        }
      },
    );
    await check(
      "actual @vercel/node edge middleware relay redirect/query/404",
      async () => {
        const repo = path.dirname(fileURLToPath(import.meta.url));
        const { child, url: base } = await devServer(
          "middleware.ts",
          { middleware: true, zeroConfig: true },
          repo,
        );
        try {
          const r = await fetch(base + "/projects?source=fixture", {
            redirect: "manual",
            headers: { host: "vdustr.dev", "x-forwarded-host": "vdustr.dev" },
          });
          assert.equal(r.status, 307);
          assert.equal(
            r.headers.get("location"),
            "https://vdustr.github.io/projects?source=fixture",
          );
          const blog = await fetch(base + "/posts/hello?q=1", {
            redirect: "manual",
            headers: {
              host: "blog.vdustr.dev",
              "x-forwarded-host": "blog.vdustr.dev",
            },
          });
          assert.equal(blog.status, 307);
          assert.equal(
            blog.headers.get("location"),
            "https://vdustr.dev/blog/posts/hello?q=1",
          );
          const retired = await fetch(base + "/", {
            redirect: "manual",
            headers: {
              host: "gh.vdustr.dev",
              "x-forwarded-host": "gh.vdustr.dev",
            },
          });
          assert.equal(retired.status, 404);
        } finally {
          await stop(child);
        }
      },
    );
  } finally {
    for (const child of children)
      try {
        await stop(child);
      } catch {}
    for (const d of dispatchers)
      try {
        await d.destroy();
      } catch {}
    for (const socket of sockets) socket.destroy();
    await Promise.all(
      servers.map((s) => new Promise((resolve) => s.close(resolve))),
    );
    for (const k of envNames)
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    result.childOutput = childOutput;
    if (resultPath)
      fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n");
  }
  console.log(JSON.stringify(result, null, 2));
  if (result.failures.length) process.exitCode = 1;
}
if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await run();
