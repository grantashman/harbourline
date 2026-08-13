import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.harbourline.companion",
  appName: "Harbourline",
  webDir: "../web/dist",
  bundledWebRuntime: false,
  server: {
    // A remote production URL is deliberately not configured. Native builds
    // must run the reviewed local web bundle that was copied by `cap sync`.
    cleartext: false
  },
  plugins: {
    StatusBar: {
      overlaysWebView: false
    },
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#06110f",
      showSpinner: false
    }
  }
};

export default config;