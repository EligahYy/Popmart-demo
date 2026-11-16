import { chromium } from 'playwright-core';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
const page = await context.newPage();

const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('ERR_FAILED') && !message.text().includes('Failed to load resource')) {
    errors.push(`console: ${message.text()}`);
  }
});
const log = (step) => console.log(`· ${step}`);

await page.goto(base, { waitUntil: 'networkidle' });
await page.getByText('我的小窝').first().waitFor({ timeout: 15000 });

// PWA manifest 与 Service Worker
const manifest = await page.evaluate(async () => {
  const response = await fetch('/manifest.webmanifest');
  return response.json();
});
log(
  `manifest: name=${manifest.name}, display=${manifest.display}, start=${manifest.start_url}, icons=${manifest.icons.length}`,
);
if (manifest.display !== 'standalone' || manifest.icons.length < 2) throw new Error('manifest 不完整');

const addDialog = page.getByRole('dialog', { name: '欢迎新宝宝' });
async function openAdd() {
  if (!(await addDialog.isVisible().catch(() => false))) await page.locator('.tabbar__add').click();
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
  if (await emptyImport.isVisible().catch(() => false)) await emptyImport.click();
  else await chipAdd.click();

  await page.getByRole('dialog', { name: '导入新系列' }).waitFor();
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

// 1. 导入 A，选 2 款但不保存
await importSeries('9120', /Twinkle Twinkle Live the Ordinary/, 69);
await openAdd();
await addDialog.getByRole('tab', { name: /Live the Ordinary/ }).click();
await addDialog.getByRole('button', { name: '多选' }).click();
const cardsA = addDialog.locator('.style-card');
await cardsA.nth(0).click();
await cardsA.nth(1).click();
await addDialog.getByText(/已选 2 款/).waitFor({ timeout: 10000 });
log('系列 A 已选 2 款');

// 2. 导入 B，选择应保留（AC30 / 跨系列多选）
await importSeries('3125', /Twinkle Twinkle Be a Little Star Series Figures/, 69);
await addDialog.getByText(/已选 2 款/).waitFor({ timeout: 15000 });
log('导入 B 后仍保留 2 款已选');

await addDialog.getByRole('tab', { name: /Be a Little Star/ }).click();
await addDialog.locator('.style-card').first().click();
await addDialog.getByText(/已选 3 款/).waitFor({ timeout: 10000 });
log('跨系列共选 3 款');

await addDialog.getByRole('button', { name: '下一步：填写订单' }).click();
const total = await addDialog.locator('input[inputmode="decimal"]').first().inputValue();
log(`跨系列订单总额：${total}`);
if (total !== '207.00') throw new Error(`应为 207.00，实际 ${total}`);
await addDialog.getByRole('button', { name: '保存这笔订单' }).click();
await page.locator('.toast', { hasText: '共 3 个宝宝已入住' }).waitFor({ timeout: 30000 });
await page.getByRole('button', { name: '关闭' }).click();
log('跨系列订单已保存');

// 3. 图片加载失败：占位不阻断记账（AC22）
await page.route('**/globalAdmin/**', (route) => route.abort());
await page.route('**/api/import/image**', (route) => route.abort());
await importSeries('3114', /CRYBABY Crying For Love/, 69);
await openAdd();
await addDialog.getByRole('tab', { name: /CRYBABY Crying For Love/ }).click();
await addDialog.locator('.style-card').first().waitFor({ timeout: 10000 });
await page.waitForTimeout(2500);
const placeholders = await addDialog.locator('.style-card__placeholder').count();
log(`图片被拦截后占位数量：${placeholders}`);
if (placeholders === 0) throw new Error('图片失败时应显示占位');
await addDialog.locator('.style-card').first().click();
await addDialog.getByRole('button', { name: '加入我的收藏' }).click();
await page.locator('.toast', { hasText: '已入住' }).waitFor({ timeout: 30000 });
log('图片缺失时仍可保存');
await page.getByRole('button', { name: '关闭' }).click();
await page.unroute('**/globalAdmin/**');
await page.unroute('**/api/import/image**');

// 4. 减弱动态效果时关闭漂浮（AC34 的可自动化部分）
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.reload({ waitUntil: 'networkidle' });
await page.locator('.ip-card').first().waitFor({ timeout: 15000 });
const animation = await page
  .locator('.ip-card__media img')
  .first()
  .evaluate((element) => getComputedStyle(element).animationName)
  .catch(() => 'none');
log(`reduce-motion 下动画：${animation}`);
if (animation !== 'none') throw new Error('减弱动态效果时应关闭漂浮');
await page.emulateMedia({ reducedMotion: 'no-preference' });

// 5. 替换个人素材不改变收藏关联（AC35）
const beforeIps = await page.locator('.ip-card').count();
await page.getByRole('link', { name: '设置' }).click();
await page.setInputFiles('input[type=file]', '/tmp/personal-test.png');
await page.getByText('首页形象已保存到本机。').waitFor({ timeout: 15000 });
await page.getByRole('link', { name: '我的小窝' }).click();
await page.locator('.home-bg img').waitFor({ timeout: 15000 });
const afterIps = await page.locator('.ip-card').count();
log(`替换人物素材前后 IP 入口：${beforeIps} → ${afterIps}`);
if (beforeIps !== afterIps) throw new Error('替换个人素材不应改变收藏');

// 6. Service Worker 已注册
const sw = await page.evaluate(async () => {
  const registration = await navigator.serviceWorker.getRegistration();
  return Boolean(registration);
});
log(`Service Worker 注册：${sw}`);
if (!sw) throw new Error('Service Worker 未注册');

await page.screenshot({ path: '/tmp/my-popmart-device-prep.png' });
console.log('errors:', errors.length === 0 ? 'none' : errors.join(' | '));
await browser.close();
