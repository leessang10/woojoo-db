import { test, expect } from './fixtures';
import { readFile } from 'node:fs/promises';
import { parseEnvironmentFile } from '../src/http/environment-import';

test('environment help stays closed on open and appears on hover', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'API', exact: true }).click();
  await page.getByRole('button', { name: '환경 변수 관리' }).click();
  const modal = page.locator('.api-env-modal');
  await expect(modal.getByRole('button', { name: '가져오기', exact: true })).toBeFocused();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await modal.getByRole('button', { name: '변수 사용법·파일 형식' }).hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(modal).toBeVisible();
});

test('drops environment files into the dialog and keeps changes as a draft', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'API', exact: true }).click();
  await page.getByRole('button', { name: '환경 변수 관리' }).click();
  const modal = page.locator('.api-env-modal');
  for (const [name, content, expected] of [
    ['.env.local', 'PORT=8080', '8080'],
    ['server.json', '{"PORT":9090}', '9090'],
    ['server.yml', 'PORT: 3000', '3000'],
  ]) {
    const dataTransfer = await page.evaluateHandle(({ name, content }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([content], name, { type: 'text/plain' }));
      return transfer;
    }, { name, content });
    await modal.dispatchEvent('dragenter', { dataTransfer });
    await expect(modal).toHaveAttribute('data-file-drag', 'true');
    await modal.dispatchEvent('drop', { dataTransfer });
    await expect(modal.getByRole('textbox', { name: '값', exact: true }).first()).toHaveValue(expected);
    await expect(modal).not.toHaveAttribute('data-file-drag');
    await dataTransfer.dispose();
  }
  await modal.getByRole('button', { name: '취소', exact: true }).click();
  await page.getByRole('button', { name: '환경 변수 관리' }).click();
  await expect(modal.getByLabel('환경 이름')).toHaveCount(0);
});

test('imports env files, updates keys, saves and cancels without persisting drafts', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'API', exact: true }).click();
  await page.getByRole('button', { name: '환경 변수 관리' }).click();
  const modal = page.locator('.api-env-modal');
  const upload = modal.getByLabel('환경 변수 파일 선택');
  const file = (text: string) => ({ name: '.env.local', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await upload.setInputFiles(file('# test\nURL=https://example.com?a=b\nTOKEN="a#b"\nEMPTY='));
  await expect(modal.getByLabel('환경 이름')).toHaveValue('.env.local');
  const keys = modal.getByRole('textbox', { name: '변수', exact: true });
  const values = modal.getByRole('textbox', { name: '값', exact: true });
  await expect(keys).toHaveCount(4);
  await expect(values.nth(1)).toHaveValue('a#b');
  await upload.setInputFiles(file('TOKEN=replaced\nNEW=value'));
  await expect(keys).toHaveCount(5);
  await expect(values.nth(0)).toHaveValue('https://example.com?a=b');
  await expect(values.nth(1)).toHaveValue('replaced');
  await upload.setInputFiles(file('TOKEN=wrong\ninvalid'));
  await expect(modal.getByRole('alert')).toContainText('2번째 줄');
  await expect(values.nth(1)).toHaveValue('replaced');
  await upload.setInputFiles(file('# no variables'));
  await expect(modal.getByRole('alert')).toContainText('가져올 환경 변수가 없습니다');
  await modal.getByRole('button', { name: '저장', exact: true }).click();
  await expect(modal).toBeHidden();
  await page.getByRole('button', { name: '환경 변수 관리' }).click();
  await expect(values.nth(1)).toHaveValue('replaced');
  await upload.setInputFiles(file('TOKEN=cancelled'));
  await modal.getByRole('button', { name: '취소', exact: true }).click();
  await page.getByRole('button', { name: '환경 변수 관리' }).click();
  await expect(values.nth(1)).toHaveValue('replaced');
});

test('imports JSON and YAML into the same environment and persists merged variables', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'API', exact: true }).click();
  await page.getByRole('button', { name: '환경 변수 관리' }).click();
  const modal = page.locator('.api-env-modal');
  const upload = modal.getByLabel('환경 변수 파일 선택');
  const values = modal.getByRole('textbox', { name: '값', exact: true });
  await upload.setInputFiles({ name: 'config.json', mimeType: 'application/json', buffer: Buffer.from('{"server":{"host":"localhost"},"PORT":8080}') });
  await expect(modal.getByLabel('환경 이름')).toHaveValue('config.json');
  await expect(modal.getByRole('textbox', { name: '변수', exact: true }).first()).toHaveValue('server.host');
  await expect(values.nth(1)).toHaveValue('8080');
  await upload.setInputFiles({ name: 'config.yml', mimeType: 'text/plain', buffer: Buffer.from('PORT: 9090\nDEBUG: true') });
  await expect(values.nth(1)).toHaveValue('9090');
  await expect(values.nth(2)).toHaveValue('true');
  await upload.setInputFiles({ name: 'config.yaml', mimeType: 'text/plain', buffer: Buffer.from('server:\n  host: example.com') });
  await expect(values.first()).toHaveValue('example.com');
  await upload.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"PORT":') });
  await expect(modal.getByRole('alert')).toBeVisible();
  await expect(values.nth(1)).toHaveValue('9090');
  await modal.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('button', { name: '환경 변수 관리' }).click();
  await expect(values.first()).toHaveValue('example.com');
  await expect(values.nth(1)).toHaveValue('9090');
  await expect(values.nth(2)).toHaveValue('true');
});

test('exports the selected draft as env, JSON and YAML from the export menu', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'API', exact: true }).click();
  await page.getByRole('button', { name: '환경 변수 관리' }).click();
  const modal = page.locator('.api-env-modal');
  await expect(modal.getByRole('button', { name: '가져오기', exact: true })).toBeVisible();
  const exportButton = modal.getByRole('button', { name: '내보내기', exact: true });
  await expect(exportButton).toBeDisabled();
  await modal.getByLabel('환경 변수 파일 선택').setInputFiles({
    name: 'local.json', mimeType: 'application/json', buffer: Buffer.from('{"HOST":"localhost","TOKEN":"a#b"}'),
  });
  await modal.getByRole('textbox', { name: '값', exact: true }).first().fill('edited-host');
  for (const format of ['env', 'json', 'yml']) {
    await exportButton.click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: `.${format}`, exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`local.${format}`);
    const text = await readFile((await download.path())!, 'utf8');
    expect(parseEnvironmentFile(text, download.suggestedFilename())).toEqual([
      { key: 'HOST', value: 'edited-host', enabled: true },
      { key: 'TOKEN', value: 'a#b', enabled: true },
    ]);
  }
  await modal.getByRole('button', { name: '취소', exact: true }).click();
  await page.getByRole('button', { name: '환경 변수 관리' }).click();
  await expect(exportButton).toBeDisabled();
});
