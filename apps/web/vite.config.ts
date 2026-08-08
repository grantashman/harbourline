import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const outputRoot = fileURLToPath(new URL("./dist", import.meta.url));
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
  transformIndexHtml: {
    order: "post",
    handler(html) {
      return html.replace(
        "</body>",
        '  <script src="assets/vendor/pdf-lib.min.js"></script>\n</body>'
      );
    }
  },
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "assets/vendor/pdf-lib.min.js",
      source: readFileSync(new URL("../../assets/vendor/pdf-lib.min.js", import.meta.url))
    });
  }
};

export default defineConfig({
  root: repositoryRoot,
  base: "./",
  plugins: [
    runtimeThemeAssetPlugin,
    pdfVendorAssetPlugin,
    {
      name: "harbourline-release-2-entry",
      transformIndexHtml: {
        order: "pre",
        handler(html) {
          return html.replace(
            "</body>",
            '  <script type="module" src="/apps/web/src/release2.ts"></script>\n</body>'
          );
        }
      }
    },
    VitePWA({
      registerType: "autoUpdate",
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
    })
  ],
  build: {
    outDir: outputRoot,
    emptyOutDir: true
  },
  server: {
    fs: {
      allow: [repositoryRoot]
    }
  }
});
