import { chromium } from 'playwright-core';

const base = process.env.BASE_URL ?? 'http://localhost:4173';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
const page = await context.newPage();

const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});
const log = (step) => console.log(`· ${step}`);

await page.goto(base, { waitUntil: 'networkidle' });
await page.getByText('我的小窝').first().waitFor({ timeout: 15000 });

// 导入 + 多选两款
await page.locator('.tabbar__add').click();
await page.getByRole('dialog').waitFor();
await page.getByRole('dialog').getByRole('button', { name: '＋ 导入新系列' }).click();
await page.locator('textarea').fill('https://www.popmart.com/ca/products/9120');
await page.getByRole('button', { name: '解析链接' }).click();
const candidate = page.getByRole('button', { name: /Twinkle Twinkle Live the Ordinary/ }).first();
await candidate.waitFor({ timeout: 60000 });
await candidate.click();
await page.getByText(/共 13 款/).waitFor({ timeout: 60000 });
await page.locator('input[inputmode="decimal"]').fill('69');
await page.getByRole('button', { name: '保存到图库' }).click();
await page.locator('.toast', { hasText: '已加入图库' }).waitFor({ timeout: 30000 });

const addDialog = page.getByRole('dialog', { name: '欢迎新宝宝' });
if (!(await addDialog.isVisible().catch(() => false))) await page.locator('.tabbar__add').click();
await addDialog.waitFor();
await addDialog.getByRole('button', { name: '多选' }).click();
await addDialog.locator('.style-card').nth(0).click();
await addDialog.locator('.style-card').nth(1).click();
await addDialog.getByRole('button', { name: '下一步：填写订单' }).click();
await addDialog.getByRole('button', { name: '保存这笔订单' }).click();
await page.locator('.toast', { hasText: '共 2 个宝宝已入住' }).waitFor({ timeout: 30000 });
await page.getByRole('button', { name: '关闭' }).click();
log('已录入 2 款，合计 ¥138');

// 账本 → 多明细退款
await page.getByRole('link', { name: '捂一下钱包？' }).click();
await page.locator('.entry-row').first().click();
const sheet = page.getByRole('dialog', { name: '购买详情' });
await sheet.waitFor();
await sheet.getByRole('button', { name: '退款／退货' }).click();

const checkboxes = sheet.getByRole('checkbox');
const checked = await checkboxes.evaluateAll((nodes) => nodes.filter((node) => node.checked).length);
log(`默认选中 ${checked} 款`);
if (checked !== 2) throw new Error('退款应默认选中全部明细');

await sheet.getByRole('button', { name: '按剩余实付重新分配' }).waitFor();
await sheet.locator('input[inputmode="decimal"]').first().fill('30');

const allocValues = await sheet.locator('.alloc-list__input').evaluateAll((nodes) => nodes.map((node) => node.value));
log(`自动分摊：${allocValues.join(' / ')}`);
if (allocValues[0] !== '15.00' || allocValues[1] !== '15.00') {
  throw new Error(`分摊应为 15.00 / 15.00，实际 ${allocValues.join(' / ')}`);
}

await sheet.getByRole('button', { name: '确认' }).click();
await sheet.getByRole('button', { name: '关闭' }).click();

await page.waitForFunction(
  () => document.querySelector('.ledger-totals')?.textContent?.includes('¥108.00'),
  null,
  { timeout: 10000 },
);
log('退款 ¥30 → 累计 ¥108.00');

await page.screenshot({ path: '/tmp/my-popmart-refund-multi.png' });
console.log('errors:', errors.length === 0 ? 'none' : errors.join(' | '));
await browser.close();
