import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://127.0.0.1:1420', browserName: 'chromium', channel: 'chrome', locale: 'ko-KR', viewport: { width: 1440, height: 940 } },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:1420', reuseExistingServer: true },
});
