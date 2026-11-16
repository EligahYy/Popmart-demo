import { chromium } from 'playwright-core';

const base = process.env.BASE_URL ?? 'http://localhost:4173';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
const page = await context.newPage();

const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
const log = (step) => console.log(`· ${step}`);

await page.goto(base, { waitUntil: 'networkidle' });
await page.getByText('我的小窝').first().waitFor({ timeout: 15000 });

// 导入 + 购买
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
await addDialog.getByRole('button', { name: '加入我的收藏' }).click();
await page.locator('.toast', { hasText: '已入住' }).waitFor({ timeout: 30000 });
log('已导入并购买 1 只');

// 后台缓存进行中：轮询重载，直到封面使用本机 Blob
await page.getByRole('button', { name: '关闭' }).click();
await page.evaluate(async () => {
  await navigator.serviceWorker.ready;
});

let progress = { total: 0, cached: 0 };
for (let attempt = 0; attempt < 90; attempt += 1) {
  progress = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('my-popmart');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const styles = await new Promise((resolve) => {
      const query = db.transaction('styles').objectStore('styles').getAll();
      query.onsuccess = () => resolve(query.result);
      query.onerror = () => resolve([]);
    });
    return {
      total: styles.length,
      cached: styles.filter((style) => style.mediaStatus === 'cached').length,
    };
  });
  if (progress.total > 0 && progress.cached === progress.total) break;
  await page.waitForTimeout(1000);
}
log(`缓存进度：${progress.cached}/${progress.total}`);

const state = await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('my-popmart');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const readAll = (store) =>
    new Promise((resolve) => {
      const query = db.transaction(store).objectStore(store).getAll();
      query.onsuccess = () => resolve(query.result);
      query.onerror = () => resolve([]);
    });
  const styles = await readAll('styles');
  const blobs = await readAll('mediaBlobs');
  return {
    styles: styles.length,
    cached: styles.filter((style) => style.mediaStatus === 'cached').length,
    withAsset: styles.filter((style) => style.imageAssetId).length,
    blobs: blobs.length,
  };
});
log(`缓存状态：${JSON.stringify(state)}`);

await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(
  () => {
    const image = document.querySelector('.ip-card img');
    return image instanceof HTMLImageElement && image.src.startsWith('blob:');
  },
  null,
  { timeout: 20000 },
);
const cachedSrc = await page
  .locator('.ip-card img')
  .first()
  .evaluate((element) => element.src);
if (!cachedSrc.startsWith('blob:')) throw new Error('图片未缓存到本机');
log(`封面已缓存：${cachedSrc.slice(0, 20)}…`);

await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
log('Service Worker 已接管页面');

// 断网重载
await context.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByText('我的小窝').first().waitFor({ timeout: 20000 });
const ipCards = await page.locator('.ip-card').count();
const offlineSrc = await page.locator('.ip-card img').first().evaluate((element) => element.src);
log(`离线重载：IP 入口 ${ipCards} 个，封面 ${offlineSrc.slice(0, 20)}…`);
if (ipCards === 0) throw new Error('离线后收藏架为空');
if (!offlineSrc.startsWith('blob:')) throw new Error('离线后封面未使用本机 Blob');

await page.screenshot({ path: '/tmp/my-popmart-offline.png' });
console.log('errors:', errors.length === 0 ? 'none' : errors.join(' | '));
await browser.close();
