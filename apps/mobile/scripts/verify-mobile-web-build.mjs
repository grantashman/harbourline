import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const dist = resolve(import.meta.dirname, "../../web/dist");
const index = await readFile(resolve(dist, "index.html"), "utf8");
const assets = await readdir(resolve(dist, "assets"));
const scripts = await Promise.all(
  assets
    .filter((name) => name.endsWith(".js"))
    .map((name) => readFile(resolve(dist, "assets", name), "utf8"))
);
const bundle = `${index}\n${scripts.join("\n")}`;

if (!bundle.includes("HarbourlineMobile") || !bundle.includes("appUrlOpen")) {
  throw new Error("Mobile web build is missing the native bootstrap bundle.");
}
if (bundle.includes("manifest.webmanifest") || bundle.includes("registerSW.js")) {
  throw new Error("Mobile web build must not include the browser PWA service worker.");
}

console.log("Mobile web build guard: passed");