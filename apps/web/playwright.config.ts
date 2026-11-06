import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3004";

// The app rate-limits sign-up per client IP from a trusted header (TRUSTED_IP_HEADERS). Each
// worker process loads this config, so each gets its own address and its own bucket.
const clientIp = `10.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${process.pid % 255}`;

// Black-box suite against a built app: `next build` first, then this starts `next start`
// (or reuses a server already on the port).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    colorScheme: "dark",
    extraHTTPHeaders: { "x-forwarded-for": clientIp },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bun run start",
    url: `${baseURL}/sign-in`,
    reuseExistingServer: !process.env.CI || Boolean(process.env.E2E_REUSE_SERVER),
    timeout: 120_000,
  },
});
