import { defineConfig, devices } from "@playwright/test";

const e2eToken = "dev-local-token";

export default defineConfig({
  expect: {
    timeout: 10_000
  },
  testDir: "tests/e2e",
  timeout: 45_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:5173",
    channel: "chrome",
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: `PAMILA_DATABASE_URL=file:data/pamila-e2e.sqlite PAMILA_LOCAL_TOKEN=${e2eToken} pnpm dev:api`,
      reuseExistingServer: true,
      timeout: 30_000,
      url: "http://127.0.0.1:7410/health"
    },
    {
      command: `VITE_PAMILA_LOCAL_TOKEN=${e2eToken} pnpm dev:web`,
      reuseExistingServer: true,
      timeout: 30_000,
      url: "http://localhost:5173"
    }
  ],
  workers: 1
});
