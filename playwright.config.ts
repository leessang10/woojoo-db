import { defineConfig } from '@playwright/test';
const baseURL=process.env.WOOJOO_TEST_URL??'http://127.0.0.1:1420';
export default defineConfig({
  testDir: './tests',
  use: { baseURL, browserName: 'chromium', channel: 'chrome', locale: 'ko-KR', viewport: { width: 1440, height: 940 } },
  webServer: process.env.WOOJOO_TEST_URL?undefined:{ command: 'npm run dev', url: baseURL, reuseExistingServer: true },
});
