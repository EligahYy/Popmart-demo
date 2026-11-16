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

async function importSeries() {
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
}

await page.goto(base, { waitUntil: 'networkidle' });
await page.getByText('我的小窝').first().waitFor({ timeout: 15000 });
await importSeries();
log('系列导入完成');

// 多选三款，一次下单
const addDialog = page.getByRole('dialog', { name: '欢迎新宝宝' });
if (!(await addDialog.isVisible().catch(() => false))) {
  await page.locator('.tabbar__add').click();
}
await addDialog.waitFor();
await addDialog.getByRole('button', { name: '多选' }).click();
const cards = addDialog.locator('.style-card');
for (let index = 0; index < 3; index += 1) await cards.nth(index).click();
await addDialog.getByRole('button', { name: '下一步：填写订单' }).click();
await addDialog.getByRole('button', { name: '保存这笔订单' }).click();
await page.locator('.toast', { hasText: '共 3 个宝宝已入住' }).waitFor({ timeout: 30000 });
await page.getByRole('button', { name: '关闭' }).click();
log('3 只已入住');

// 首页 IP 入口
const ipCard = page.locator('.ip-card').first();
await ipCard.waitFor({ timeout: 10000 });
const ipText = await ipCard.innerText();
log(`IP 入口：${ipText.replace(/\n/g, ' / ')}`);
await ipCard.click();

// 收藏夹
await page.locator('.series-block').first().waitFor({ timeout: 10000 });
const indicator = await page.locator('.fan__indicator').first().innerText();
log(`卡组指示：${indicator}`);
if (!indicator.includes('第 1 / 3 款')) throw new Error(`卡组指示异常：${indicator}`);

await page.getByRole('button', { name: '下一款' }).first().click();
const indicator2 = await page.locator('.fan__indicator').first().innerText();
log(`翻到：${indicator2}`);

// 打开身份卡
await page.locator('.fan__card').last().click();
const card = page.getByRole('dialog', { name: /身份卡/ });
await card.waitFor({ timeout: 10000 });
const frontText = await card.innerText();
if (frontText.includes('¥')) throw new Error('身份卡正面不应出现金额');
log('身份卡正面无金额');

await card.getByRole('button', { name: '翻到背面' }).click();
const backText = await card.innerText();
if (backText.includes('¥')) throw new Error('身份卡背面不应出现金额');
const hasRecords = backText.includes('获取记录');
log(`背面：记录 ${hasRecords ? '正常' : '缺失'}，持有 ${backText.includes('当前拥有') ? '显示' : '缺失'}`);

await page.screenshot({ path: '/tmp/my-popmart-identity.png' });

await card.getByRole('button', { name: '关闭身份卡' }).click();
const indicator3 = await page.locator('.fan__indicator').first().innerText();
log(`关闭后卡组位置：${indicator3}`);
if (indicator3 !== indicator2) throw new Error('关闭身份卡后未恢复原选中款式');

console.log('errors:', errors.length === 0 ? 'none' : errors.join(' | '));
await browser.close();
