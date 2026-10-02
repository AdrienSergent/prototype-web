import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./src/test/global-setup.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://cir_app:cir_app@localhost:5432/cir_test",
      DATABASE_OWNER_URL: process.env.TEST_DATABASE_OWNER_URL ?? "postgres://cir_owner:cir_owner@localhost:5432/cir_test",
      DB_APP_PASSWORD: "cir_app",
      MFA_ENFORCED: "true",
      STORAGE_LOCAL_DIR: "./storage-test",
      LOG_LEVEL: "silent",
      RUN_WORKERS_IN_API: "false",
    },
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
