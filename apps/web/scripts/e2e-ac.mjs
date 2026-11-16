import { chromium } from 'playwright-core';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
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

const addDialog = page.getByRole('dialog', { name: '欢迎新宝宝' });
async function openAdd() {
  if (!(await addDialog.isVisible().catch(() => false))) {
    await page.locator('.tabbar__add').click();
  }
  await addDialog.waitFor();
}

async function importSeries(productId, titlePattern, price) {
  await openAdd();
  const emptyImport = addDialog.getByRole('button', { name: '＋ 导入新系列' });
  const chipAdd = addDialog.locator('.chip--add');
  await Promise.race([
    emptyImport.waitFor({ timeout: 15000 }).catch(() => undefined),
    chipAdd.waitFor({ timeout: 15000 }).catch(() => undefined),
  ]);
  if (await emptyImport.isVisible().catch(() => false)) {
    await emptyImport.click();
  } else {
    await chipAdd.click();
  }
  const importDialog = page.getByRole('dialog', { name: '导入新系列' });
  await importDialog.waitFor();
  await page.locator('textarea').fill(`https://www.popmart.com/ca/products/${productId}`);
  await page.getByRole('button', { name: '解析链接' }).click();
  const candidate = page.getByRole('button', { name: titlePattern }).first();
  await candidate.waitFor({ timeout: 60000 });
  await candidate.click();
  await page.getByText(/共 \d+ 款/).waitFor({ timeout: 60000 });
  await page.locator('input[inputmode="decimal"]').fill(String(price));
  await page.getByRole('button', { name: '保存到图库' }).click();
  await page.locator('.toast', { hasText: '已加入图库' }).waitFor({ timeout: 30000 });
}

// 1. 导入两个同 IP 的系列
await importSeries('9120', /Twinkle Twinkle Live the Ordinary/, 69);
log('系列 A 已导入');
await importSeries('3125', /Twinkle Twinkle Be a Little Star Series Figures/, 69);
log('系列 B 已导入');

// 2. 买 5 款（系列 A）
await openAdd();
await addDialog.getByRole('button', { name: '多选' }).click();
const pickChip = addDialog.getByRole('tab', { name: /Live the Ordinary/ });
await pickChip.click();
const cards = addDialog.locator('.style-card');
for (let index = 0; index < 5; index += 1) await cards.nth(index).click();
await addDialog.getByText(/已选 5 款/).waitFor({ timeout: 10000 });
await addDialog.getByRole('button', { name: '下一步：填写订单' }).click();
await addDialog.getByRole('button', { name: '保存这笔订单' }).click();
await page.locator('.toast', { hasText: '共 5 个宝宝已入住' }).waitFor({ timeout: 30000 });
log('系列 A 已入 5 只');

// 3. 买 1 款（系列 B）
await addDialog.getByRole('tab', { name: /Be a Little Star/ }).click();
await cards.first().click();
await addDialog.getByRole('button', { name: '下一步：填写订单' }).click();
await addDialog.getByRole('button', { name: '保存这笔订单' }).click();
await page.locator('.toast', { hasText: '共 1 个宝宝已入住' }).waitFor({ timeout: 30000 });
await page.getByRole('button', { name: '关闭' }).click();
log('系列 B 已入 1 只');

// 4. 首页无金额（AC29）
const homeText = await page.locator('main').innerText();
if (homeText.includes('¥')) throw new Error('首页不应出现金额');
log('首页无金额');

// 5. 卡组：最多三张，系列之间独立（AC10 / AC11）
await page.locator('.ip-card').first().click();
const blockA = page.locator('.series-block').filter({ hasText: 'Live the Ordinary' });
const blockB = page.locator('.series-block').filter({ hasText: 'Be a Little Star' });
await blockA.waitFor({ timeout: 10000 });

const cardsA = await blockA.locator('.fan__card').count();
const indicatorA = await blockA.locator('.fan__indicator').innerText();
const indicatorB = await blockB.locator('.fan__indicator').innerText();
log(`系列 A：可见 ${cardsA} 张，${indicatorA}；系列 B：${indicatorB}`);
if (cardsA !== 3) throw new Error('同时最多应显示 3 张卡');
if (!indicatorA.includes('第 1 / 5 款')) throw new Error(`系列 A 指示异常：${indicatorA}`);

await blockA.getByRole('button', { name: '下一款' }).click();
const indicatorA2 = await blockA.locator('.fan__indicator').innerText();
const indicatorB2 = await blockB.locator('.fan__indicator').innerText();
log(`翻页后：A ${indicatorA2}，B ${indicatorB2}`);
if (!indicatorA2.includes('第 2 / 5 款')) throw new Error('系列 A 未翻页');
if (indicatorB2 !== indicatorB) throw new Error('系列 B 受到了系列 A 的影响');

// 6. 二手切换清空自动金额（AC06）
await page.getByRole('link', { name: '我的小窝' }).click();
await page.locator('.tabbar__add').click();
await addDialog.waitFor();
await addDialog.locator('.style-card').first().click();
const amountInput = addDialog.locator('input[inputmode="decimal"]');
const before = await amountInput.inputValue();
await addDialog.getByRole('button', { name: '二手购入' }).click();
const after = await amountInput.inputValue();
log(`二手切换：${before} → "${after}"`);
if (before === '' || after !== '') throw new Error('切换二手后应清空自动金额');

await page.screenshot({ path: '/tmp/my-popmart-ac.png' });
console.log('errors:', errors.length === 0 ? 'none' : errors.join(' | '));
await browser.close();
