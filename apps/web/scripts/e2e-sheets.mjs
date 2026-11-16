import { chromium } from 'playwright-core';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const log = (step) => console.log(`· ${step}`);

await page.goto(base, { waitUntil: 'networkidle' });
await page.getByText('我的小窝').first().waitFor({ timeout: 15000 });

const add = page.getByRole('dialog', { name: '欢迎新宝宝' });
const importDialog = page.getByRole('dialog', { name: '导入新系列' });

// 1. 打开后焦点进入面板
await page.locator('.tabbar__add').click();
await add.waitFor();
const focusInside = await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
log(`打开后焦点在面板内：${focusInside}`);
if (!focusInside) throw new Error('打开面板后焦点未进入对话框');

// 2. Esc 关闭
await page.keyboard.press('Escape');
await add.waitFor({ state: 'hidden', timeout: 5000 });
const focusRestored = await page.evaluate(() => document.activeElement?.classList.contains('tabbar__add'));
log(`Esc 关闭，焦点回到触发按钮：${focusRestored}`);

// 3. 嵌套面板：返回键先关上层
await page.locator('.tabbar__add').click();
await add.waitFor();
const importButton = add.getByRole('button', { name: '＋ 导入新系列' });
await importButton.waitFor({ timeout: 15000 });
await importButton.click();
await importDialog.waitFor();

await page.evaluate(() => history.back());
await importDialog.waitFor({ state: 'hidden', timeout: 5000 });
const addStillOpen = await add.isVisible();
log(`返回键关闭导入面板，新增面板仍在：${addStillOpen}`);
if (!addStillOpen) throw new Error('返回键不应同时关闭下层');

await page.evaluate(() => history.back());
await add.waitFor({ state: 'hidden', timeout: 5000 });
log('再次返回关闭新增面板');

// 4. 关闭后地址栏不应残留历史
const historyLength = await page.evaluate(() => history.length);
log(`history.length=${historyLength}`);

console.log('errors:', errors.length === 0 ? 'none' : errors.join(' | '));
await browser.close();
