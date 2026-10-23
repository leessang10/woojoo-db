import type { Locator } from '@playwright/test';
/** Open the actual Radix popup and select its visible option by stable value. */
export async function chooseOption(trigger: Locator, value: string) {
  await trigger.click();
  await trigger.page().getByRole('option').and(trigger.page().locator(`[data-value=${JSON.stringify(value)}]`)).click();
}
/** Language lives in Settings; open it, pick the language and close it again. */
export async function chooseLanguage(page: import('@playwright/test').Page, value: 'ko' | 'en') {
  await page.keyboard.press('Control+,');
  await chooseOption(page.getByLabel('언어 / Language'), value);
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
}
