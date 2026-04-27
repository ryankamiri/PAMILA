import { defineConfig, devices } from "@playwright/test";

const e2eToken = "dev-local-token";
const e2eApiPort = 17410;
const e2eWebPort = 15173;
const e2eApiUrl = `http://127.0.0.1:${e2eApiPort}`;
const e2eWebUrl = `http://127.0.0.1:${e2eWebPort}`;

export default defineConfig({
  expect: {
    timeout: 10_000
  },
  testDir: "tests/e2e",
  timeout: 45_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: e2eWebUrl,
    channel: "chrome",
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: `PAMILA_API_PORT=${e2eApiPort} PAMILA_DATABASE_URL=file:data/pamila-e2e.sqlite PAMILA_LOCAL_TOKEN=${e2eToken} pnpm --filter @pamila/api dev`,
      reuseExistingServer: false,
      timeout: 30_000,
      url: `${e2eApiUrl}/health`
    },
    {
      command: `VITE_PAMILA_API_BASE_URL=${e2eApiUrl} VITE_PAMILA_LOCAL_TOKEN=${e2eToken} pnpm --filter @pamila/web exec vite --host 127.0.0.1 --port ${e2eWebPort}`,
      reuseExistingServer: false,
      timeout: 30_000,
      url: e2eWebUrl
    }
  ],
  workers: 1
});
