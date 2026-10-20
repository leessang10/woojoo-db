import type { Locator } from '@playwright/test';
/** Open the actual Radix popup and select its visible option by stable value. */
export async function chooseOption(trigger: Locator, value: string) {
  await trigger.click();
  await trigger.page().getByRole('option').and(trigger.page().locator(`[data-value=${JSON.stringify(value)}]`)).click();
}
