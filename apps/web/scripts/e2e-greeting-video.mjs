import { chromium } from 'playwright-core';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 430, height: 932 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const log = (step) => console.log(`· ${step}`);

await page.goto(base, { waitUntil: 'networkidle' });
await page.getByRole('link', { name: '设置' }).click();
await page.getByRole('heading', { name: '设置' }).waitFor();
await page
  .locator('.settings-block')
  .filter({ has: page.getByRole('heading', { name: '首页形象' }) })
  .locator('input[type=file]')
  .setInputFiles('assets/persona-cutout.png');
await page.getByText('首页形象已保存到本机。').waitFor({ timeout: 20000 });
await page
  .locator('.settings-block')
  .filter({ has: page.getByRole('heading', { name: '打招呼视频（可选）' }) })
  .locator('input[type=file]')
  .setInputFiles('assets/greeting.mp4');
await page.getByText('打招呼视频已保存到本机。').waitFor({ timeout: 30000 });
log('素材已上传');

await page.getByRole('link', { name: '我的小窝' }).click();
await page.locator('.home-figure__canvas').waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/greet-idle.png' });

const alpha = await page.locator('.home-figure__canvas').evaluate((canvas) => {
  const gl = canvas.getContext('webgl');
  const read = (x, y) => {
    const px = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px[3];
  };
  return { corner: read(2, 2), center: read(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2)) };
});
log(`常态 alpha 角=${alpha.corner} 中心=${alpha.center}`);

async function playOnce(label) {
  await page.locator('.home-figure').click();
  await page.waitForFunction(
    () => {
      const v = document.querySelector('.home-figure__hidden-video');
      return v instanceof HTMLVideoElement && v.currentTime > 0.2 && !v.paused;
    },
    null,
    { timeout: 10000 },
  );
  log(`${label}：视频播放中`);
  await page.waitForFunction(
    () => {
      const v = document.querySelector('.home-figure__hidden-video');
      return v instanceof HTMLVideoElement && v.currentTime === 0 && v.paused;
    },
    null,
    { timeout: 12000 },
  );
  log(`${label}：播放结束回到首帧`);
}

await playOnce('第一次点击');
await page.waitForTimeout(300);
await playOnce('第二次点击');
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/greet-after.png' });

console.log('errors:', errors.length === 0 ? 'none' : errors.join(' | '));
await browser.close();
