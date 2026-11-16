import { chromium } from 'playwright-core';

const base = process.env.BASE_URL ?? 'http://localhost:4173';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, acceptDownloads: true });
const page = await context.newPage();

const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});
const log = (step) => console.log(`· ${step}`);

await page.goto(base, { waitUntil: 'networkidle' });
await page.getByText('我的小窝').first().waitFor({ timeout: 15000 });

// 准备数据
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
log('已准备 1 个系列 / 1 笔订单');

// 导出
await page.getByRole('link', { name: '设置' }).click();
await page.getByRole('heading', { name: '设置' }).waitFor();
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.getByRole('button', { name: '导出备份' }).click(),
]);
const downloadPath = await download.path();
log(`已下载备份：${download.suggestedFilename()}`);
if (!downloadPath) throw new Error('下载文件路径为空');

await page.getByText(/备份已生成/).waitFor({ timeout: 15000 });

// 恢复
await page.setInputFiles('input[type=file]', downloadPath);
const sheet = page.getByRole('dialog', { name: '恢复备份' });
await sheet.waitFor({ timeout: 15000 });
const summary = await sheet.innerText();
log(`恢复摘要：${summary.replace(/\n/g, ' / ').slice(0, 120)}`);

await sheet.getByRole('button', { name: '确认替换并恢复' }).click();
await page.waitForLoadState('networkidle');
await page.getByRole('link', { name: '我的小窝' }).click();
await page.locator('.ip-card').first().waitFor({ timeout: 20000 });
log('恢复后首页仍有收藏');

const info = await page.evaluate(async () => {
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
  const datasets = await readAll('datasets');
  const styles = await readAll('styles');
  return {
    datasets: datasets.map((dataset) => dataset.status),
    activeStyles: styles.filter((style) => style.datasetId === datasets.find((d) => d.status === 'active')?.id).length,
  };
});
log(`数据集：${JSON.stringify(info)}`);
if (!info.datasets.includes('active') || !info.datasets.includes('retired')) {
  throw new Error('恢复后应存在 active 与 retired 数据集');
}

await page.screenshot({ path: '/tmp/my-popmart-restore.png' });
console.log('errors:', errors.length === 0 ? 'none' : errors.join(' | '));
await browser.close();
