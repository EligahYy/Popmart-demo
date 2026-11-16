import { chromium } from 'playwright-core';

const base = process.env.BASE_URL ?? 'http://localhost:5173';
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

// 导入 + 买 1 款 × 2
await page.locator('.tabbar__add').click();
await page.getByRole('dialog').waitFor();
await page.getByRole('dialog').getByRole('button', { name: '＋ 导入新系列' }).click();
await page.getByRole('dialog', { name: '导入新系列' }).waitFor();
await page.locator('textarea').fill('https://www.popmart.com/ca/products/9120');
await page.getByRole('button', { name: '解析链接' }).click();
const candidate = page.getByRole('button', { name: /Twinkle Twinkle Live the Ordinary Series Figures/ }).first();
await candidate.waitFor({ timeout: 60000 });
await candidate.click();
await page.getByText(/共 13 款/).waitFor({ timeout: 60000 });
await page.locator('input[inputmode="decimal"]').fill('69');
await page.getByRole('button', { name: '保存到图库' }).click();
await page.locator('.toast', { hasText: '已加入图库' }).waitFor({ timeout: 30000 });

const addDialog = page.getByRole('dialog', { name: '欢迎新宝宝' });
if (!(await addDialog.isVisible().catch(() => false))) {
  await page.locator('.tabbar__add').click();
}
await addDialog.waitFor();
await addDialog.locator('.style-card').first().click();
await addDialog.getByRole('button', { name: '增加' }).click();
await addDialog.getByRole('button', { name: '加入我的收藏' }).click();
await page.locator('.toast', { hasText: '已入住' }).waitFor({ timeout: 30000 });
await page.getByRole('button', { name: '关闭' }).click();
log('已录入 2 只，合计 ¥138');

// 账本 → 明细 → 编辑金额
await page.getByRole('link', { name: '捂一下钱包？' }).click();
await page.locator('.entry-row').first().waitFor({ timeout: 10000 });
await page.locator('.entry-row').first().click();
const sheet = page.getByRole('dialog', { name: '购买详情' });
await sheet.waitFor();

await sheet.getByRole('button', { name: '编辑' }).click();
await sheet.locator('input[inputmode="decimal"]').fill('120');
await sheet.getByRole('button', { name: '保存修改' }).click();
await sheet.getByRole('button', { name: '关闭' }).click();

await page.waitForFunction(
  () => document.querySelector('.ledger-totals')?.textContent?.includes('¥120.00'),
  null,
  { timeout: 10000 },
);
log('编辑金额 → 累计 ¥120.00');

// 退款 ¥20
await page.locator('.entry-row').first().click();
await sheet.waitFor();
await sheet.getByRole('button', { name: '退款／退货' }).click();
await sheet.locator('input[inputmode="decimal"]').fill('20');
await sheet.getByRole('button', { name: '确认' }).click();
await sheet.getByRole('button', { name: '关闭' }).click();

await page.waitForFunction(
  () => document.querySelector('.ledger-totals')?.textContent?.includes('¥100.00'),
  null,
  { timeout: 10000 },
);
log('退款 ¥20 → 累计 ¥100.00');

// 收藏夹 → 送出一只
await page.getByRole('link', { name: '我的小窝' }).click();
await page.locator('.ip-card').first().click();
await page.locator('.fan__card').last().waitFor({ timeout: 10000 });
await page.locator('.fan__card').last().click();
const card = page.getByRole('dialog', { name: /身份卡/ });
await card.waitFor();
await card.getByRole('button', { name: '送出／售出' }).click();
const transfer = page.getByRole('dialog', { name: '送出或售出' });
await transfer.waitFor();
await transfer.getByRole('button', { name: '确认' }).click();
await page.waitForTimeout(1200);
if (await transfer.isVisible()) {
  log(`转出对话框未关闭：${(await transfer.innerText()).replace(/\n/g, ' / ')}`);
}
await page.locator('.series-block').first().waitFor({ timeout: 10000 });
const block = await page.locator('.series-block').first().innerText();
log(`送出后：${block.replace(/\n/g, ' / ')}`);
if (!block.includes('共 1 只')) throw new Error('送出后应剩 1 只');

// 删除误录
await page.getByRole('link', { name: '捂一下钱包？' }).click();
await page.locator('.entry-row').first().click();
await sheet.waitFor();
await sheet.getByRole('button', { name: '删除误录' }).click();
await sheet.getByRole('button', { name: '确认删除' }).click();
await page.waitForFunction(
  () => document.querySelector('.ledger-totals')?.textContent?.includes('¥0.00'),
  null,
  { timeout: 10000 },
);
const empty = await page.getByText('这个时段还没有记录。').count();
log(`删除后累计 ¥0.00，明细清空：${empty > 0}`);

await page.screenshot({ path: '/tmp/my-popmart-refund.png', fullPage: true });
console.log('errors:', errors.length === 0 ? 'none' : errors.join(' | '));
await browser.close();
