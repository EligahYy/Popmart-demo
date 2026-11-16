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

// 导入系列（顶部搜索框内联导入）
await page.locator('.tabbar__add').click();
const importDialog = page.getByRole('dialog', { name: '欢迎新宝宝' });
await importDialog.waitFor();
await importDialog.locator('.import-search input').fill('https://www.popmart.com/ca/products/9120');
await importDialog.getByRole('button', { name: '导入' }).click();
const candidate = importDialog.getByRole('button', { name: /Twinkle Twinkle Live the Ordinary Series Figures/ }).first();
await candidate.waitFor({ timeout: 60000 });
await candidate.click();
await importDialog.getByText(/共 13 款/).waitFor({ timeout: 60000 });
await importDialog.locator('input[inputmode="decimal"]').fill('69');
await importDialog.getByRole('button', { name: '保存到图库' }).click();
await page.locator('.toast', { hasText: '系列已加入图库' }).waitFor({ timeout: 30000 });
log('系列已导入，单盒价 69');

// 多选两款
const addDialog = importDialog;
const cards = addDialog.locator('.style-card');
await cards.nth(0).click();
await cards.nth(1).click();
await addDialog.getByText(/已选 2 款 · 共 2 件/).waitFor();
log('已选 2 款');

// 第一款数量改为 2
await addDialog.getByRole('button', { name: /增加 Stay Curious/ }).click();
await addDialog.getByText(/已选 2 款 · 共 3 件/).waitFor();
log('数量 1 + 2 = 3 件');

await addDialog.getByRole('button', { name: '下一步：填写订单' }).click();

const totalInput = addDialog.locator('input[inputmode="decimal"]').first();
await totalInput.waitFor();
const defaultTotal = await totalInput.inputValue();
log(`默认订单总额：${defaultTotal}`);
if (defaultTotal !== '207.00') throw new Error(`默认总额应为 207.00，实际 ${defaultTotal}`);

// 改为 180，检查自动分摊
await totalInput.fill('180');
const allocInputs = addDialog.locator('.alloc-list__input');
const allocValues = await allocInputs.evaluateAll((nodes) => nodes.map((node) => node.value));
log(`自动分摊：${allocValues.join(' / ')}`);
if (allocValues[0] !== '120.00' || allocValues[1] !== '60.00') {
  throw new Error(`分摊应为 120.00 / 60.00，实际 ${allocValues.join(' / ')}`);
}

await addDialog.getByRole('button', { name: '保存这笔订单' }).click();
await page.locator('.toast', { hasText: '共 3 个宝宝已入住' }).waitFor({ timeout: 30000 });
const message = await page.locator('.toast').textContent();
log(`订单保存：${message}`);

await page.getByRole('button', { name: '关闭' }).click();
await page.locator('.ip-card').first().waitFor({ timeout: 10000 });
const count = await page.locator('.ip-card__count').first().textContent();
log(`首页持有数：${count}`);
if (count !== '3') throw new Error(`首页持有数应为 3，实际 ${count}`);

await page.screenshot({ path: '/tmp/my-popmart-multi.png' });
console.log('errors:', errors.length === 0 ? 'none' : errors.join(' | '));
await browser.close();
