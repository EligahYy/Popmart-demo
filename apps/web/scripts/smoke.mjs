import { chromium } from 'playwright-core';

const base = process.env.BASE_URL ?? 'http://localhost:5173';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
const page = await context.newPage();

const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('response', (response) => {
  if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
});

await page.goto(base, { waitUntil: 'networkidle' });
await page.getByText('我的小窝').first().waitFor({ timeout: 15000 });

const title = await page.locator('h1').first().textContent();
console.log('home title:', title);

// 打开新增面板
await page.locator('.tabbar__add').click();
await page.getByRole('dialog').waitFor();
const emptyHint = await page.getByText('图库还是空的').count();
console.log('add panel empty state:', emptyHint > 0);

// 打开导入面板
await page.getByRole('dialog').getByRole('button', { name: '＋ 导入新系列' }).click();
await page.getByRole('dialog', { name: '导入新系列' }).waitFor();
const importHeading = await page.getByRole('heading', { name: '导入新系列' }).count();
console.log('import dialog open:', importHeading > 0);

await page.screenshot({ path: '/tmp/my-popmart-home.png', fullPage: false });

console.log('page errors:', errors.length === 0 ? 'none' : errors.join(' | '));
await browser.close();
