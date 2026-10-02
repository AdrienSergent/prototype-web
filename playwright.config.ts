import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de bout en bout sur le jeu de démonstration (npm run db:reset && npm run db:seed),
 * API et front démarrés (npm run dev). PW_CHROMIUM permet d'utiliser un Chromium déjà installé.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 900 } }, testIgnore: /mobile\..*spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\..*spec\.ts/ },
  ],
});
