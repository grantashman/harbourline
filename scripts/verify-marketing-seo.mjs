import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const publicPages = [
  {
    file: "marketing/index.html",
    url: "https://www.harbourline.app/",
    schemaTypes: ["Organization", "WebSite", "SoftwareApplication"]
  },
  {
    file: "marketing/blog/index.html",
    url: "https://www.harbourline.app/blog/",
    schemaTypes: ["CollectionPage"]
  },
  {
    file: "marketing/blog/payday-planning/index.html",
    url: "https://www.harbourline.app/blog/payday-planning/",
    schemaTypes: ["BlogPosting"]
  },
  {
    file: "marketing/blog/early-access/index.html",
    url: "https://www.harbourline.app/blog/early-access/",
    schemaTypes: ["BlogPosting"]
  }
];

function captureOne(html, pattern, label) {
  const match = html.match(pattern);
  assert.ok(match, `${label} is required`);
  return match[1];
}

function countMatches(html, pattern) {
  return [...html.matchAll(pattern)].length;
}

for (const page of publicPages) {
  const html = readFileSync(page.file, "utf8");
  const title = captureOne(html, /<title>([^<]+)<\/title>/i, `${page.file} title`);
  const description = captureOne(
    html,
    /<meta\s+name="description"\s+content="([^"]+)"\s*\/>/i,
    `${page.file} description`
  );
  const canonical = captureOne(
    html,
    /<link\s+rel="canonical"\s+href="([^"]+)"\s*\/>/i,
    `${page.file} canonical`
  );
  const ogUrl = captureOne(
    html,
    /<meta\s+property="og:url"\s+content="([^"]+)"\s*\/>/i,
    `${page.file} og:url`
  );

  assert.ok(title.length >= 20 && title.length <= 70, `${page.file} title length is outside 20-70 characters`);
  assert.ok(description.length >= 100 && description.length <= 170, `${page.file} description length is outside 100-170 characters`);
  assert.equal(canonical, page.url, `${page.file} canonical must use the public www URL`);
  assert.equal(ogUrl, page.url, `${page.file} og:url must match canonical`);
  assert.equal(countMatches(html, /<h1\b/gi), 1, `${page.file} must contain exactly one H1`);

  const jsonLdBlocks = [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  assert.ok(jsonLdBlocks.length > 0, `${page.file} must contain JSON-LD`);
  const types = jsonLdBlocks.flatMap(([, block]) => {
    const value = JSON.parse(block);
    const nodes = value["@graph"] ?? [value];
    return nodes.flatMap((node) => (Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]]));
  });
  for (const schemaType of page.schemaTypes) {
    assert.ok(types.includes(schemaType), `${page.file} JSON-LD must include ${schemaType}`);
  }
}

const robots = readFileSync("marketing/robots.txt", "utf8");
assert.match(robots, /^User-agent: \*\s*$/m, "marketing robots.txt must define the default user agent");
assert.match(robots, /^Allow: \/\s*$/m, "marketing robots.txt must allow public pages");
assert.match(robots, /^Sitemap: https:\/\/www\.harbourline\.app\/sitemap\.xml\s*$/m, "marketing robots.txt must point to the sitemap");

const sitemap = readFileSync("marketing/sitemap.xml", "utf8");
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url);
assert.deepEqual(sitemapUrls, publicPages.map(({ url }) => url), "sitemap URLs must match the public marketing pages in order");
assert.ok(
  sitemapUrls.every((url) => {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "www.harbourline.app";
  }),
  "sitemap URLs must use the public www host"
);

const appShell = readFileSync("index.html", "utf8");
assert.match(appShell, /<meta\s+name="robots"\s+content="noindex, follow"\s*\/>/i, "app shell must not be indexed as a marketing result");

const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
const blogRedirects = (vercel.redirects ?? []).filter(({ source }) => source === "/blog" || source === "/blog/:path*");
assert.equal(blogRedirects.length, 2, "app deployment must redirect apex blog paths to the public marketing host");
assert.ok(blogRedirects.every(({ destination, permanent }) => destination.startsWith("https://www.harbourline.app/blog") && permanent === true), "apex blog redirects must be permanent and use the public host");

console.log(`Marketing SEO guard passed for ${publicPages.length} public pages.`);
