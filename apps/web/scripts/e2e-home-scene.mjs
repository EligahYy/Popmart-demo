import { chromium } from 'playwright-core';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
const log = (step) => console.log(`· ${step}`);

await page.goto(base, { waitUntil: 'networkidle' });
await page.getByText('红彤彤收纳').first().waitFor({ timeout: 15000 });
log('默认空间名称显示');

// 未上传时显示占位（纯本机存储）
await page.locator('.home-figure-placeholder').waitFor({ timeout: 10000 });
log('未上传时显示占位');

// 上传本机形象
await page.getByRole('link', { name: '设置' }).click();
await page.getByRole('heading', { name: '设置' }).waitFor();
await page.setInputFiles('input[type=file]', 'assets/persona-cutout.png');
await page.getByText('首页形象已保存到本机。').waitFor({ timeout: 15000 });
await page.getByRole('link', { name: '我的小窝' }).click();
await page.locator('.home-figure__media').waitFor({ timeout: 15000 });
const shelfVisible = await page.locator('.home-scene__shelf').isVisible();
log(`内置形象与收纳架：${shelfVisible}`);
if (!shelfVisible) throw new Error('收纳架未显示');

// 点击人物打招呼
await page.locator('.home-figure').click();
const bubble = page.locator('.home-figure__bubble');
await bubble.waitFor({ timeout: 3000 });
log(`点击人物：${await bubble.innerText()}`);
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/visual-greet.png' });
await bubble.waitFor({ state: 'hidden', timeout: 5000 });
log('招呼动效结束，气泡消失');

// 自定义空间名称
await page.getByRole('link', { name: '设置' }).click();
await page.getByRole('heading', { name: '设置' }).waitFor();
const nameInput = page.locator('.settings-block', { hasText: '空间名称' }).locator('input');
await nameInput.fill('我的收纳角');
await page.getByRole('button', { name: '保存名称' }).click();
await page.getByText('空间名称已保存。').waitFor({ timeout: 10000 });

await page.getByRole('link', { name: '我的小窝' }).click();
await page.getByText('我的收纳角').first().waitFor({ timeout: 10000 });
log('自定义名称生效');

await page.reload({ waitUntil: 'networkidle' });
await page.getByText('我的收纳角').first().waitFor({ timeout: 10000 });
log('刷新后名称仍在');

console.log('errors:', errors.length === 0 ? 'none' : errors.join(' | '));
await browser.close();
