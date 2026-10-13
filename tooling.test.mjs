import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

const require = createRequire(import.meta.url);
const cliRequire = createRequire(require.resolve("vercel/package.json"));
const pythonRequire = createRequire(
  cliRequire.resolve("@vercel/python-analysis"),
);
const funRequire = createRequire(cliRequire.resolve("@vercel/fun"));
const python = pythonRequire("@vercel/python-analysis");

async function withFixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "redirect-tooling-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("Python discovery preserves workspace members and exclusions", async () => {
  await withFixture(async (rootDir) => {
    await writeFile(
      join(rootDir, "pyproject.toml"),
      '[project]\nname = "workspace"\nversion = "1.0.0"\n[tool.uv.workspace]\nmembers = ["packages/*"]\nexclude = ["packages/excluded"]\n',
    );
    for (const name of ["included", "excluded"]) {
      const entrypointDir = join(rootDir, "packages", name);
      await mkdir(entrypointDir, { recursive: true });
      await writeFile(
        join(entrypointDir, "pyproject.toml"),
        python.stringifyManifest(python.createMinimalManifest({ name })),
      );
      const result = await python.discoverPythonPackage({
        rootDir,
        entrypointDir,
      });
      assert.equal(result.manifest.data.project.name, name);
      assert.equal(
        result.workspaceManifest.data.project.name,
        name === "included" ? "workspace" : "excluded",
      );
    }
    const lock = python.parseUvLock(
      'version = 1\n[[package]]\nname = "flask"\nversion = "3.1.0"\nsource = { registry = "https://pypi.org/simple" }\n',
    );
    assert.deepEqual(
      python.classifyPackages({ lockFile: lock }).publicPackages,
      ["flask"],
    );
    const yaml = pythonRequire("js-yaml");
    assert.equal(
      yaml.load("name: fixture", { filename: "fixture.yaml" }).name,
      "fixture",
    );
    assert.throws(() => yaml.load("a: [", { filename: "fixture.yaml" }));
  });
});

test("malformed TOML terminates with a parser error", () => {
  const parser = pythonRequire.resolve("smol-toml");
  const result = spawnSync(
    process.execPath,
    ["-e", `require(${JSON.stringify(parser)}).parse('a=[1 #')`],
    { timeout: 2000, encoding: "utf8" },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /TomlError/);
});

test("fun's event dependency preserves finish events and rejects aborted waits", async () => {
  const once = funRequire("@tootallnate/once").default;
  const emitter = new EventEmitter();
  const finished = once(emitter, "finish");
  emitter.emit("finish", "ok");
  assert.deepEqual(await finished, ["ok"]);
  const controller = new AbortController();
  const aborted = once(emitter, "finish", { signal: controller.signal });
  controller.abort();
  const result = await Promise.race([
    aborted.then(
      () => "resolved",
      () => "rejected",
    ),
    new Promise((resolve) => setTimeout(() => resolve("pending"), 250)),
  ]);
  assert.equal(result, "rejected");
});

test("fun's Node installer preserves streamed gzip extraction with strip 1", async () => {
  await withFixture(async (directory) => {
    const source = join(directory, "source");
    const destination = join(directory, "destination");
    await mkdir(join(source, "node-v24.19.0", "bin"), { recursive: true });
    await mkdir(destination);
    await writeFile(join(source, "node-v24.19.0", "bin", "node"), "fixture");
    const archivePath = join(directory, "node.tar.gz");
    const packed = spawnSync("tar", [
      "-czf",
      archivePath,
      "-C",
      source,
      "node-v24.19.0",
    ]);
    assert.equal(packed.status, 0);
    const archive = await readFile(archivePath);
    const fetchPath = funRequire.resolve("node-fetch");
    const previous = require.cache[fetchPath];
    require.cache[fetchPath] = {
      id: fetchPath,
      filename: fetchPath,
      loaded: true,
      exports: async (url) => {
        assert.match(url, /^https:\/\/nodejs.org\/dist\/v24\.19\.0\//);
        return { ok: true, body: Readable.from(archive) };
      },
    };
    try {
      const installer = funRequire(
        join(dirname(cliRequire.resolve("@vercel/fun")), "install-node.js"),
      );
      await installer.installNode(destination, "24.19.0", "linux", "x64");
      assert.equal(
        await readFile(join(destination, "bin", "node"), "utf8"),
        "fixture",
      );
    } finally {
      if (previous) require.cache[fetchPath] = previous;
      else delete require.cache[fetchPath];
    }
  });
});

test("NFT tracing preserves local dependencies without an optional Rollup peer", async () => {
  await withFixture(async (directory) => {
    await writeFile(
      join(directory, "entry.cjs"),
      'module.exports = require("./dependency.cjs");',
    );
    await writeFile(join(directory, "dependency.cjs"), "module.exports = 42;");
    const { nodeFileTrace } = cliRequire("@vercel/nft");
    const traced = await nodeFileTrace([join(directory, "entry.cjs")], {
      base: directory,
    });
    assert(traced.fileList.has("dependency.cjs"));
  });
});
