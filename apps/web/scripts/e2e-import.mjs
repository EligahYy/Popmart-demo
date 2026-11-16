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
log('首页加载');

// 1. 导入系列（顶部搜索框内联导入）
await page.locator('.tabbar__add').click();
const importDialog = page.getByRole('dialog', { name: '欢迎新宝宝' });
await importDialog.waitFor();
await importDialog
  .locator('.import-search input')
  .fill('https://www.popmart.com/ca/products/9120/twinkle-twinkle-live-the-ordinary-series-figures');
await importDialog.getByRole('button', { name: '导入' }).click();

const candidate = importDialog.getByRole('button', { name: /Twinkle Twinkle Live the Ordinary Series Figures/ }).first();
await candidate.waitFor({ timeout: 60000 });
log('链接解析出候选');
await candidate.click();

await importDialog.getByText(/共 13 款/).waitFor({ timeout: 60000 });
log('预览显示 13 款');

await importDialog.locator('input[inputmode="decimal"]').fill('69');
await importDialog.getByRole('button', { name: '保存到图库' }).click();
await page.locator('.toast', { hasText: '系列已加入图库' }).waitFor({ timeout: 30000 });
const importToast = await page.locator('.toast').textContent();
log(`导入完成：${importToast}`);

// 2. 新增一只
const addDialog = importDialog;
if (!(await addDialog.isVisible().catch(() => false))) {
  await page.locator('.tabbar__add').click();
}
await addDialog.waitFor();
await addDialog.locator('.style-card').first().click();
await addDialog.getByText(/已选 1 款/).waitFor();
await addDialog.getByRole('button', { name: '下一步：填写订单' }).click();

const amountInput = addDialog.locator('input[inputmode="decimal"]').first();
await amountInput.waitFor();
const defaultValue = await amountInput.inputValue();
log(`默认实付：${defaultValue}`);
if (defaultValue !== '69.00') throw new Error(`默认金额应为 69.00，实际 ${defaultValue}`);

await addDialog.getByRole('button', { name: '保存这笔订单' }).click();
await page.locator('.toast', { hasText: '已入住' }).waitFor({ timeout: 30000 });
const addToast = await page.locator('.toast').textContent();
log(`新增完成：${addToast}`);

// 3. 关闭面板检查收藏架
await page.getByRole('button', { name: '关闭' }).click();
await page.locator('.ip-card').first().waitFor({ timeout: 10000 });
const shelfText = await page.locator('.ip-card').first().innerText();
log(`IP 入口：${shelfText.replace(/\n/g, ' / ')}`);

const cover = page.locator('.ip-card img').first();
await cover.waitFor({ timeout: 15000 });
await page.waitForFunction(
  () => {
    const img = document.querySelector('.ip-card img');
    return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
  },
  null,
  { timeout: 15000 },
);
const coverInfo = await cover.evaluate((el) => ({ width: el.naturalWidth, src: el.src }));
log(`封面图加载：${coverInfo.width}px ${coverInfo.src.slice(0, 60)}…`);

await page.screenshot({ path: '/tmp/my-popmart-collection.png' });

console.log('errors:', errors.length === 0 ? 'none' : errors.join(' | '));
await browser.close();
