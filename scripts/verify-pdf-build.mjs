import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const distRoot = join(repositoryRoot, "apps", "web", "dist");
const indexHtml = await readFile(join(distRoot, "index.html"), "utf8");
const pdfVendor = await readFile(
  join(distRoot, "assets", "vendor", "pdf-lib.min.js"),
  "utf8"
);
const assetNames = await readdir(join(distRoot, "assets"));
const javascriptAssets = assetNames.filter((assetName) => assetName.endsWith(".js"));
const javascript = await Promise.all(
  javascriptAssets.map((assetName) => readFile(join(distRoot, "assets", assetName), "utf8"))
);
const bundledJavascript = javascript.join("\n");

assert.doesNotMatch(
  indexHtml,
  /<script\s+src=["']assets\/vendor\/pdf-lib\.min\.js["']/i,
  "the production HTML must not eagerly load the pdf-lib vendor asset"
);
assert.ok(javascriptAssets.length > 0, "the production build must contain JavaScript assets");
assert.doesNotMatch(
  bundledJavascript,
  /PDFDocument/,
  "pdf-lib should remain a separate vendor asset rather than inflating the application bundle"
);
assert.match(
  indexHtml,
  /new URL\("assets\/vendor\/pdf-lib\.min\.js", document\.baseURI\)/,
  "the emitted planner HTML must retain the lazy PDF vendor loader"
);
assert.match(pdfVendor, /PDFLib/, "the vendor asset must retain the pdf-lib global bridge");
assert.match(pdfVendor, /PDFDocument/, "the vendor asset must contain PDFDocument");
assert.match(pdfVendor, /StandardFonts/, "the vendor asset must contain StandardFonts");

console.log("PDF build guard: passed");
