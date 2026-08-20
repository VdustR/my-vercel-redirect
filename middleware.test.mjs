import assert from "node:assert/strict";
import test from "node:test";

import middleware from "./middleware.ts";

test("redirects the apex domain to GitHub Pages", () => {
  const response = middleware(
    new Request("https://vdustr.dev/projects?source=home"),
  );

  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("Location"),
    "https://vdustr.github.io/projects?source=home",
  );
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("redirects the blog subdomain while preserving the path and query", () => {
  const response = middleware(
    new Request("https://blog.vdustr.dev/posts/hello?source=archive"),
  );

  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("Location"),
    "https://vdustr.dev/blog/posts/hello?source=archive",
  );
  assert.equal(
    response.headers.get("Cache-Control"),
    "public, max-age=3600, must-revalidate",
  );
});

test("returns 404 for retired social subdomains", () => {
  const response = middleware(new Request("https://gh.vdustr.dev/"));

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("Location"), null);
});
