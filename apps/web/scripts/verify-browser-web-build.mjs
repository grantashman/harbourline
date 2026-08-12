import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

if (process.env.HARBOURLINE_MOBILE === "1") {
  console.log("Browser web build guard: skipped for mobile bundle");
  process.exit(0);
}

const dist = resolve(import.meta.dirname, "../dist");
const index = await readFile(resolve(dist, "index.html"), "utf8");
const assets = await readdir(resolve(dist, "assets"));

if (!assets.includes("release2.js")) throw new Error("Browser web build is missing release2.js.");
if (!index.includes("manifest.webmanifest") || !assets.includes("sw.js")) {
  throw new Error("Browser web build is missing the PWA service worker entry.");
}
if (assets.includes("mobile-bootstrap.js")) {
  throw new Error("Browser web build must not include the native bootstrap.");
}

console.log("Browser web build guard: passed");