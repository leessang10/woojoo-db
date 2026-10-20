import { test as base, expect } from '@playwright/test';
export type { Page } from '@playwright/test';

// Data interaction tests opt in; ordinary app startup never shows fixture data.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => localStorage.setItem('woojoo-test-fixtures', 'enabled'));
    await use(page);
  },
});
export { expect };
