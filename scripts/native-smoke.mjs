// Run only against a test-launched WebView2 and the disposable local fixtures.
import { chromium, expect } from '@playwright/test';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9224');
const page = browser.contexts()[0].pages()[0];
const failures = [];
page.on('pageerror', e => failures.push(e.message));
await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
await page.screenshot({ path: 'docs/research/dbeaver/woojoo-desktop.png' });
for (const [engine, port, username] of [['PostgreSQL',55439,'postgres'],['MySQL',53309,'root'],['MariaDB',53310,'root']]) {
  await page.getByLabel('새 연결').click();
  await page.getByRole('button',{name:engine,exact:true}).click();
  await page.getByLabel('연결 이름').fill(`${engine} integration`);
  await page.getByLabel('호스트',{exact:true}).fill('127.0.0.1');
  await page.getByLabel('포트',{exact:true}).fill(String(port));
  await page.getByRole('textbox',{name:'데이터베이스',exact:true}).fill('woojoo_test');
  await page.getByLabel('사용자',{exact:true}).fill(username);
  await page.getByLabel('비밀번호',{exact:true}).fill('woojoo-local-test');
  await page.getByLabel('TLS 사용 · 서버 인증서 검증').uncheck();
  await page.getByRole('button',{name:'연결하기',exact:true}).click();
  await expect(page.getByRole('heading',{name:'새로운 연결'})).not.toBeVisible({timeout:15000});
  await expect(page.getByRole('cell',{name:'Native original',exact:true})).toBeVisible({timeout:15000});
  await page.getByRole('cell',{name:'Native original',exact:true}).dblclick();
  await page.getByLabel('셀 값').fill(`Native ${engine} updated`);
  await page.getByRole('button',{name:'변경 대기열에 추가'}).click();
  await page.getByRole('button',{name:/변경 검토/}).click();
  await page.getByRole('button',{name:'1개 행 적용'}).click();
  await expect(page.getByRole('heading',{name:'변경 사항 검토'})).not.toBeVisible();
  await page.getByLabel('테이블 새로고침').click();
  await expect(page.getByRole('cell',{name:`Native ${engine} updated`,exact:true})).toBeVisible();
  await page.locator('.cm-content').fill('SELECT id, name FROM users');
  await page.locator('.run-button').click();
  await expect(page.getByText('쿼리 결과 · 읽기 전용')).toBeVisible();
  await expect(page.getByRole('cell',{name:`Native ${engine} updated`,exact:true})).toBeVisible();
  console.log(`${engine}: native UI connect / browse / edit / persist / SQL passed`);
}
if (failures.length) throw new Error(failures.join('\n'));
await page.screenshot({ path:'docs/research/dbeaver/woojoo-live-db.png' });
await browser.close();
