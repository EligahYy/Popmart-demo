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

// 导入 + 一次买两款
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
await addDialog.getByRole('button', { name: '多选' }).click();
await addDialog.locator('.style-card').nth(0).click();
await addDialog.locator('.style-card').nth(1).click();
await addDialog.getByRole('button', { name: '下一步：填写订单' }).click();
await addDialog.locator('input[inputmode="decimal"]').first().fill('180');
await addDialog.getByRole('button', { name: '保存这笔订单' }).click();
await page.locator('.toast', { hasText: '共 2 个宝宝已入住' }).waitFor({ timeout: 30000 });
await page.getByRole('button', { name: '关闭' }).click();
log('已录入 ¥180 / 2 只');

// 账本
await page.getByRole('link', { name: '捂一下钱包？' }).click();
await page.getByRole('heading', { name: '捂一下钱包？' }).waitFor({ timeout: 10000 });

const totals = await page.locator('.ledger-totals').innerText();
log(`累计：${totals.replace(/\n/g, ' / ')}`);
if (!totals.includes('¥180.00')) throw new Error('累计消费应为 ¥180.00');

const period = await page.locator('.period-figures').innerText();
log(`本期：${period.replace(/\n/g, ' / ')}`);
if (!period.includes('¥180.00')) throw new Error('本期消费应为 ¥180.00');

const bars = await page.locator('.chart__bar').count();
log(`本月柱子：${bars} 根`);
if (bars !== 30) throw new Error(`11 月应有 30 根柱子，实际 ${bars}`);

// 点击第一根有值的柱子
await page.locator('.chart__bar').nth(11).click({ force: true });
const chartValue = await page.locator('.chart__value').innerText();
log(`柱子提示：${chartValue}`);

// IP 筛选
await page.getByRole('button', { name: 'Twinkle Twinkle', exact: true }).click();
const filtered = await page.locator('.period-figures').innerText();
log(`筛选后本期：${filtered.replace(/\n/g, ' / ')}`);

// 设置预算
await page.getByRole('button', { name: '设置' }).click();
const sheet = page.getByRole('dialog', { name: '悠着点儿买' });
await sheet.waitFor();
await sheet.getByRole('checkbox').nth(0).check();
await sheet.locator('input[inputmode="decimal"]').fill('300');
await sheet.getByRole('checkbox').nth(1).check();
await sheet.locator('input[inputmode="numeric"]').fill('4');
await sheet.getByRole('button', { name: '保存' }).click();
await sheet.waitFor({ state: 'hidden', timeout: 10000 });

const budgetText = await page.locator('.budget').innerText();
log(`预算：${budgetText.replace(/\n/g, ' / ')}`);
if (!budgetText.includes('还剩 ¥120.00')) throw new Error('金额余额应为 ¥120.00');
if (!budgetText.includes('还剩 2 只')) throw new Error('数量余额应为 2 只');

// AC17：超出上限仍可保存
await page.locator('.tabbar__add').click();
const addPanel = page.getByRole('dialog', { name: '欢迎新宝宝' });
await addPanel.waitFor();
await addPanel.locator('.style-card').first().click();
await addPanel.getByRole('button', { name: '增加' }).click();
await addPanel.getByRole('button', { name: '增加' }).click();
await addPanel.getByRole('button', { name: '加入我的收藏' }).click();
await page.locator('.toast', { hasText: '已入住' }).waitFor({ timeout: 30000 });
await page.getByRole('button', { name: '关闭' }).click();

await page.getByRole('link', { name: '捂一下钱包？' }).click();
await page.getByRole('heading', { name: '捂一下钱包？' }).waitFor();
const exceeded = await page.locator('.budget').innerText();
log(`超限后：${exceeded.replace(/\n/g, ' / ').slice(0, 90)}`);
if (!exceeded.includes('已超出')) throw new Error('超出额度后应显示已超出');

await page.screenshot({ path: '/tmp/my-popmart-ledger.png', fullPage: true });
console.log('errors:', errors.length === 0 ? 'none' : errors.join(' | '));
await browser.close();
