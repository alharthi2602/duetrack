import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:4173",
    launchOptions: process.env.DUETRACK_CHROMIUM_PATH
      ? {
          executablePath: process.env.DUETRACK_CHROMIUM_PATH,
          args: ["--no-sandbox"],
        }
      : undefined,
  },
  webServer: {
    command: "npx vite preview --host 0.0.0.0 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
  },
  projects: [
    { name: "mobile", use: { viewport: { width: 412, height: 915 } } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
