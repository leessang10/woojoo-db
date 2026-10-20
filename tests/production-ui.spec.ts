import { test, expect } from '@playwright/test';

test('startup contains only real profiles and no sample workspace', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.workspace-empty')).toBeVisible();
  await expect(page.locator('.connection')).toHaveCount(0);
  await expect(page.locator('.data-grid')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/playground|Demo|데모|Alex Morgan/);
  await page.getByRole('button', { name: '새 연결', exact: true }).last().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).not.toContainText(/데모|npm run/);
});

test('long connection labels stay inside the card in both themes', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('woojoo-profiles-v1', JSON.stringify([{
      id:'long-profile',name:'Production database with a very long connection name',
      engine:'postgres',host:'very-long-database-host.ap-northeast-2.rds.amazonaws.com',
      port:5432,database:'app',username:'app',tls:true,
      group:'Platform infrastructure team',environment:'production',readOnly:true,
    }]));
  });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  const card = page.locator('.connection');
  await expect(card).toHaveCount(1);
  for (const theme of ['light','dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const layout = await card.evaluate(element => {
      const icon = element.querySelector('.db-icon')!.getBoundingClientRect();
      const svg = element.querySelector('.db-icon svg')!.getBoundingClientRect();
      const name = element.querySelector('.connection-name')!.getBoundingClientRect();
      const dot = element.querySelector('.live-dot')!.getBoundingClientRect();
      return { centered:Math.abs(icon.x+icon.width/2-svg.x-svg.width/2)<1,
        noOverlap:name.right<=dot.left, noOverflow:element.scrollWidth<=element.clientWidth };
    });
    expect(layout).toEqual({centered:true,noOverlap:true,noOverflow:true});
  }
});

test('sidebar header is compact and its add action aligns with its label', async ({ page }) => {
  await page.setViewportSize({width:960,height:700});
  await page.goto('/');
  const layout = await page.locator('.section-label').first().evaluate(element => {
    const rect=element.getBoundingClientRect(), button=element.querySelector('button')!.getBoundingClientRect();
    const sidebar=element.closest('.sidebar')!, box=sidebar.getBoundingClientRect();
    const brand=sidebar.querySelector('.workspace-brand')!.getBoundingClientRect();
    return { gap:rect.top-brand.bottom, inset:box.right-button.right, center:Math.abs(rect.y+rect.height/2-button.y-button.height/2), overflow:sidebar.scrollWidth>sidebar.clientWidth };
  });
  expect(layout.gap).toBeLessThanOrEqual(8);
  expect(layout.inset).toBeLessThanOrEqual(16);
  expect(layout.center).toBeLessThan(1);
  expect(layout.overflow).toBe(false);
});
