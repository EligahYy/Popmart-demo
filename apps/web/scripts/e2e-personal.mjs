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

// 上传个人形象
await page.getByRole('link', { name: '设置' }).click();
await page.getByRole('heading', { name: '设置' }).waitFor();
await page.setInputFiles('input[type=file]', '/tmp/personal-test.png');
await page.getByText('首页形象已保存到本机。').waitFor({ timeout: 15000 });
log('个人形象已保存');

// 首页背景生效
await page.getByRole('link', { name: '我的小窝' }).click();
await page.locator('.home-bg img').waitFor({ timeout: 15000 });
const bgSrc = await page.locator('.home-bg img').evaluate((element) => element.src);
log(`首页背景：${bgSrc.slice(0, 24)}…`);
if (!bgSrc.startsWith('blob:')) throw new Error('首页背景应使用本机 Blob');

// 导入 + 购买，进入身份卡编辑
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
if (!(await addDialog.isVisible().catch(() => false))) {
  await page.locator('.tabbar__add').click();
}
await addDialog.waitFor();
await addDialog.locator('.style-card').first().click();
await addDialog.getByRole('button', { name: '加入我的收藏' }).click();
await page.locator('.toast', { hasText: '已入住' }).waitFor({ timeout: 30000 });
await page.getByRole('button', { name: '关闭' }).click();

await page.locator('.ip-card').first().click();
await page.locator('.fan__card').last().waitFor({ timeout: 10000 });
await page.locator('.fan__card').last().click();
const card = page.getByRole('dialog', { name: /身份卡/ });
await card.waitFor();
await card.getByRole('button', { name: '翻到背面' }).click();
await card.getByRole('button', { name: '编辑小名与故事' }).click();
await card.locator('input.field__input').fill('小星');
await card.locator('textarea').fill('第一次抽到隐藏款的那天');
await card.getByRole('button', { name: '保存' }).click();
await card.getByRole('button', { name: '看正面' }).click();
const front = await card.innerText();
log(`正面：${front.replace(/\n/g, ' / ')}`);
if (!front.includes('小名：小星')) throw new Error('小名未显示在身份卡正面');

await page.screenshot({ path: '/tmp/my-popmart-personal.png' });
console.log('errors:', errors.length === 0 ? 'none' : errors.join(' | '));
await browser.close();
