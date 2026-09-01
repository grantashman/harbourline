import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const outputRoot = fileURLToPath(new URL("./dist", import.meta.url));
const mobileBuild = process.env.HARBOURLINE_MOBILE === "1";
const release2Entry = fileURLToPath(new URL("./src/release2.ts", import.meta.url));
const mobileBootstrapEntry = fileURLToPath(new URL("../mobile/src/native-bootstrap.ts", import.meta.url));
const runtimeThemeAssets = [
  "assets/favicon-deep-ocean.svg",
  "assets/favicon-sunset-ledger.svg",
  "assets/harbourline-mark.svg",
  "assets/harbourline-mark-deep-ocean.svg",
  "assets/harbourline-mark-sunset-ledger.svg"
];

const runtimeThemeAssetPlugin: Plugin = {
  name: "harbourline-runtime-theme-assets",
  generateBundle() {
    for (const assetPath of runtimeThemeAssets) {
      this.emitFile({
        type: "asset",
        fileName: assetPath,
        source: readFileSync(new URL(`../../${assetPath}`, import.meta.url))
      });
    }
  }
};

const pdfVendorAssetPlugin: Plugin = {
  name: "harbourline-pdf-vendor-asset",
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "assets/vendor/pdf-lib.min.js",
      source: readFileSync(new URL("../../assets/vendor/pdf-lib.min.js", import.meta.url))
    });
  }
};

export default defineConfig(({ command }) => ({
  root: repositoryRoot,
  base: "./",
  plugins: [
    runtimeThemeAssetPlugin,
    pdfVendorAssetPlugin,
    {
      name: "harbourline-release-2-entry",
      transformIndexHtml: {
        order: "post",
        handler(html) {
          const release2Script = command === "serve"
            ? '  <script type="module" src="/apps/web/src/release2.ts"></script>'
            : '  <script type="module" src="./assets/release2.js"></script>';
          const scripts = [
            mobileBuild ? '  <script type="module" src="./assets/mobile-bootstrap.js"></script>' : "",
            release2Script
          ].filter(Boolean).join("\n");
          return html.replace("</body>", `${scripts}\n</body>`);
        }
      }
    },
    ...(mobileBuild ? [] : [VitePWA({
      // Financial edits must not be interrupted by an automatic reload. The
      // client presents an explicit update action after the user saves.
      injectRegister: false,
      registerType: "prompt",
      includeAssets: [
        "favicon.ico",
        "favicon.svg",
        "assets/favicon-deep-ocean.svg",
        "assets/favicon-sunset-ledger.svg",
        "assets/harbourline-mark.svg",
        "assets/harbourline-mark-deep-ocean.svg",
        "assets/harbourline-mark-sunset-ledger.svg",
        "assets/harbourline-logo.svg"
      ],
      manifest: {
        name: "Harbourline",
        short_name: "Harbourline",
        description: "Household payday, bills, savings and debt planning.",
        theme_color: "#0b2520",
        background_color: "#f3f7f5",
        display: "standalone",
        start_url: "./",
        icons: [
          {
            src: "assets/harbourline-mark.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,jpg,webp}"]
      }
    })])
  ],
  build: {
    outDir: outputRoot,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("../../index.html", import.meta.url)),
        release2: release2Entry,
        ...(mobileBuild ? { mobileBootstrap: mobileBootstrapEntry } : {})
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "mobileBootstrap") return "assets/mobile-bootstrap.js";
          if (chunk.name === "release2") return "assets/release2.js";
          return "assets/[name]-[hash].js";
        }
      }
    }
  },
  server: {
    fs: {
      allow: [repositoryRoot]
    }
  }
}));
