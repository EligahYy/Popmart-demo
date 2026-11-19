import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';
import { buildApp } from '../../import-server/src/buildApp.js';
import { MemoryStore } from '../../import-server/src/shared/testing/memoryStore.js';

// No personal files or production writes: use a generated colour/mask clip in
// an isolated shared store. GREETING_VIDEO optionally exercises a local clip.
const scratch = mkdtempSync(join(tmpdir(), 'popmart-greeting-'));
let clip = process.env.GREETING_VIDEO;
if (!clip) {
  clip = join(scratch, 'greeting.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=144x192:rate=24:duration=3',
    '-f', 'lavfi', '-i', 'color=black:size=144x192:rate=24:duration=3',
    '-filter_complex', '[1:v]drawbox=x=30:y=16:w=84:h=176:color=white:t=fill[mask];[0:v][mask]hstack',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', clip]);
}
const store = new MemoryStore();
const app = buildApp({ sharedStore: store, signingSecret: 'greeting-test',
  staticDir: fileURLToPath(new URL('../dist', import.meta.url)) });
const base = await app.listen({ port: 0, host: '127.0.0.1' });
const browser = await chromium.launch({ headless: true,
  ...(existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : { channel: 'chrome' }) });
const errors: string[] = [];
const selector = '.home-figure__hidden-video';
async function idle(page: Page) {
  await page.waitForFunction(() => {
    const video = document.querySelector<HTMLVideoElement>('.home-figure__hidden-video');
    const poster = document.querySelector('.home-figure__poster');
    const canvas = document.querySelector('.home-figure__canvas');
    return video?.paused && video.currentTime < 0.05 && poster && canvas &&
      getComputedStyle(poster).opacity === '1' && getComputedStyle(canvas).opacity === '0';
  }, null, { timeout: 15000 });
}
async function active(page: Page) {
  await page.waitForFunction(() => {
    const video = document.querySelector<HTMLVideoElement>('.home-figure__hidden-video');
    const canvas = document.querySelector('.home-figure__canvas');
    return video && !video.paused && video.currentTime > 0.2 && canvas && getComputedStyle(canvas).opacity === '1';
  });
}

// Sample painted pixels with both layers halfway through the transition.
// The same opaque colour on both layers must not lighten over a white scene.
async function verifyBlend(page: Page) {
  await page.evaluate(() => {
    const group = document.createElement('div');
    group.id = 'blend-check';
    group.className = 'home-figure__greeting';
    group.style.cssText = 'position:fixed;left:0;top:0;width:32px;height:32px;z-index:9999';
    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:fixed;inset:0;background:white;z-index:9998';
    backdrop.id = 'blend-backdrop';
    for (const name of ['home-figure__poster', 'home-figure__canvas']) {
      const layer = document.createElement('canvas');
      layer.className = name;
      layer.width = layer.height = 32;
      const context = layer.getContext('2d')!;
      context.fillStyle = 'rgb(32, 48, 64)';
      context.fillRect(8, 8, 16, 16);
      group.append(layer);
    }
    document.body.append(backdrop, group);
    group.getBoundingClientRect();
  });
  for (const entering of [true, false]) {
    const opacities = await page.evaluate(async (on) => {
      const group = document.querySelector('#blend-check')!;
      group.classList.toggle('home-figure__greeting--active', on);
      getComputedStyle(group.lastElementChild!).opacity;
      await Promise.all(group.getAnimations({ subtree: true }).map(async animation => {
        animation.pause();
        await animation.ready;
        animation.currentTime = 90;
      }));
      return [...group.children].map(layer => Number(getComputedStyle(layer).opacity));
    }, entering);
    assert(opacities.every(opacity => opacity > 0 && opacity < 1), JSON.stringify(opacities));
    const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 32, height: 32 } });
    const pixels = await page.evaluate(async (png) => {
      const bitmap = new Image();
      bitmap.src = `data:image/png;base64,${png}`;
      await bitmap.decode();
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      return [
        [...context.getImageData(bitmap.width / 2, bitmap.height / 2, 1, 1).data],
        [...context.getImageData(1, 1, 1, 1).data],
      ];
    }, shot.toString('base64'));
    assert(pixels[0]!.every((channel, index) => Math.abs(channel - [32, 48, 64, 255][index]!) <= 2), JSON.stringify(pixels));
    assert.deepEqual(pixels[1], [255, 255, 255, 255]);
    await page.evaluate(() => {
      for (const animation of document.querySelector('#blend-check')!.getAnimations({ subtree: true })) animation.finish();
    });
  }
  await page.evaluate(() => {
    document.querySelector('#blend-check')?.remove();
    document.querySelector('#blend-backdrop')?.remove();
  });
  console.log('PASS: painted transition pixels stay opaque on the character and transparent around it');
}
try {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  // Simulate a decoder that cannot deliver a usable texture immediately.
  await page.addInitScript(() => {
    const state = window as unknown as { blockGreetingFrames: boolean; greetingNode?: HTMLVideoElement };
    state.blockGreetingFrames = true;
    const upload = WebGLRenderingContext.prototype.texImage2D;
    WebGLRenderingContext.prototype.texImage2D = function (...args: Parameters<typeof upload>) {
      if (state.blockGreetingFrames) throw new Error('Frame not decoded yet');
      return upload.apply(this, args);
    };
  });
  await page.goto(base);
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await page.locator('.settings-block').filter({ has: page.getByRole('heading', { name: '打招呼视频（可选）' }) })
    .locator('input[type=file]').setInputFiles(clip);
  await page.getByText('打招呼视频已保存到共享空间。').waitFor({ timeout: 30000 });
  await page.getByRole('link', { name: '我的小窝', exact: true }).click();
  await page.locator('img.home-figure__poster').waitFor();
  await idle(page);
  await verifyBlend(page);
  const touch = await page.locator('.home-figure').evaluate(button => ({
    highlight: getComputedStyle(button).getPropertyValue('-webkit-tap-highlight-color'),
    appearance: getComputedStyle(button).appearance,
    action: getComputedStyle(button).touchAction,
  }));
  assert.equal(touch.highlight, 'rgba(0, 0, 0, 0)');
  assert.equal(touch.appearance, 'none');
  assert.equal(touch.action, 'manipulation');
  assert.equal(await page.locator(selector).evaluate(video => getComputedStyle(video).visibility), 'hidden');
  await page.locator('.home-figure').tap();
  await page.waitForFunction(() => (document.querySelector('.home-figure__hidden-video') as HTMLVideoElement)?.currentTime > 0.25);
  assert.equal(await page.locator('.home-figure__canvas').evaluate(canvas => getComputedStyle(canvas).opacity), '0');
  assert.equal(await page.locator('.home-figure__poster').evaluate(poster => getComputedStyle(poster).opacity), '1');
  console.log('PASS: a delayed/invalid first frame never replaces the static poster');
  await page.evaluate(() => { (window as unknown as { blockGreetingFrames: boolean }).blockGreetingFrames = false; });
  await active(page);
  await page.screenshot({ path: '/tmp/popmart-greeting-playing.png' });
  const alpha = await page.locator('.home-figure__canvas').evaluate(canvas => {
    const target = canvas as HTMLCanvasElement;
    const gl = target.getContext('webgl')!;
    const corner = new Uint8Array(4);
    const center = new Uint8Array(4);
    gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, corner);
    gl.readPixels(target.width / 2, target.height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, center);
    return { corner: corner[3]!, center: center[3]! };
  });
  assert(alpha.corner < 5 && alpha.center > 240, `The mask must remain transparent: ${JSON.stringify(alpha)}`);
  const originalUrl = await page.locator(selector).getAttribute('src');
  await page.evaluate(() => {
    (window as unknown as { greetingNode: Element | null }).greetingNode = document.querySelector('.home-figure__hidden-video');
  });
  const datasetId = (await store.read())!.snapshot.tables.datasets.find(row => row.status === 'active')!.id;
  const change = await app.inject({ method: 'POST', url: '/api/shared/commands', payload: {
    name: 'setSpaceName', requestId: crypto.randomUUID(),
    payload: { commandId: crypto.randomUUID(), datasetId, name: '打招呼同步验证' },
  } });
  assert.equal(change.statusCode, 200);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('heading', { name: '打招呼同步验证', exact: true }).waitFor();
  assert.equal(await page.locator(selector).getAttribute('src'), originalUrl);
  assert(await page.evaluate(() => (window as unknown as { greetingNode: Element }).greetingNode === document.querySelector('.home-figure__hidden-video')));
  await idle(page);
  console.log('PASS: transparent animation survives shared edits and fades to the poster before rewinding');
  for (let repeat = 0; repeat < 2; repeat += 1) {
    await page.locator('.home-figure').tap();
    await active(page);
    await page.locator('.home-figure').tap();
    await idle(page);
  }
  console.log('PASS: repeat taps and complete replays do not expose empty or raw mask frames');
  await page.screenshot({ path: '/tmp/popmart-greeting-fixed.png' });
  await page.locator(selector).evaluate(video => {
    (video as HTMLVideoElement).play = () => Promise.reject(new DOMException('Blocked', 'NotAllowedError'));
  });
  await page.locator('.home-figure').tap();
  await idle(page);
  console.log('PASS: denied playback leaves the normal poster visible');
  await page.keyboard.press('Tab');
  await page.locator('.home-figure').focus();
  assert(await page.locator('.home-figure').evaluate(button => button.matches(':focus-visible') && getComputedStyle(button).outlineStyle !== 'none'));
  console.log('PASS: no rectangular touch highlight; keyboard focus remains visible');
  await context.close();

  // A first-time visitor stays on home when the first poster download fails.
  const cold = await browser.newContext({ isMobile: true, viewport: { width: 390, height: 844 } });
  const home = await cold.newPage();
  const posterId = (await store.read())!.snapshot.tables.assets.find(row => row.ownerId === 'greeting_poster' && row.status === 'ready')!.id;
  let posterAttempts = 0;
  await home.route(`**/api/shared/media/${posterId}/0`, route => ++posterAttempts === 1 ? route.abort() : route.continue());
  await home.goto(base);
  await home.waitForFunction(() => {
    const image = document.querySelector<HTMLImageElement>('img.home-figure__poster');
    return image?.complete && image.naturalWidth > 0;
  });
  assert.equal(posterAttempts, 2);
  await cold.close();
  console.log('PASS: a new device automatically recovers its portrait without leaving home');

  // Safari/older webviews may lack requestVideoFrameCallback. Exercise the
  // readiness-checked animation-frame path as a separate fresh visitor.
  const fallback = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
  await fallback.addInitScript(() => {
    Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', { value: undefined });
  });
  const older = await fallback.newPage();
  older.on('pageerror', error => errors.push(error.message));
  const greetingId = (await store.read())!.snapshot.tables.assets.find(row => row.ownerId === 'greeting' && row.status === 'ready')!.id;
  const mediaPattern = `**/api/shared/media/${greetingId}/*`;
  let releaseVideo!: () => void;
  let notifyDownload!: () => void;
  const pendingVideo = new Promise<void>(resolve => { releaseVideo = resolve; });
  const downloadStarted = new Promise<void>(resolve => { notifyDownload = resolve; });
  let mediaRequests = 0;
  await older.route(mediaPattern, async route => {
    mediaRequests += 1;
    notifyDownload();
    await pendingVideo;
    await route.continue();
  });
  await older.goto(`${base}/ledger`);
  try {
    const timeout = AbortSignal.timeout(10000);
    await Promise.race([downloadStarted, new Promise<never>((_, reject) => {
      timeout.addEventListener('abort', () => reject(new Error('Video preloading did not start on the ledger')));
    })]);
    assert.equal(await older.locator(selector).count(), 0);
    await older.getByRole('link', { name: '我的小窝', exact: true }).click();
    await older.waitForFunction(() => {
      const image = document.querySelector<HTMLImageElement>('img.home-figure__poster');
      return image?.complete && image.naturalWidth > 0;
    });
    const poster = await older.locator('img.home-figure__poster').elementHandle();
    assert.equal(await older.locator(selector).count(), 0);
    await older.locator('.home-figure').tap();
    releaseVideo();
    await active(older);
    assert(await poster!.evaluate(node => node === document.querySelector('img.home-figure__poster')));
    await idle(older);
  } finally { releaseVideo(); }
  const cachedUrl = await older.locator(selector).getAttribute('src');
  const downloaded = mediaRequests;
  await older.getByRole('link', { name: '捂一下钱包？', exact: true }).click();
  await older.getByRole('link', { name: '我的小窝', exact: true }).click();
  await idle(older);
  assert.equal(await older.locator(selector).getAttribute('src'), cachedUrl);
  const revalidated = older.waitForResponse(response =>
    response.url().includes('/api/shared/state?') && response.url().includes('instanceId=') && response.status() === 204);
  await older.reload();
  await revalidated;
  await idle(older);
  assert.equal(mediaRequests, downloaded);
  console.log('PASS: video preloads off-home, keeps the poster through a queued tap, and is reused after navigation and reload');
  await older.locator('.home-figure').tap();
  await active(older);
  await idle(older);
  console.log('PASS: playback works without the video-frame callback API');
  await older.locator('.home-figure__canvas').evaluate(canvas => {
    (canvas as HTMLCanvasElement).getContext('webgl')!.getExtension('WEBGL_lose_context')!.loseContext();
  });
  await older.waitForTimeout(250);
  await older.locator('.home-figure').tap();
  await idle(older);
  assert.equal(await older.locator('.home-figure__poster').evaluate(poster => getComputedStyle(poster).opacity), '1');
  console.log('PASS: losing the graphics context safely retains the static character');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await app.close();
  rmSync(scratch, { recursive: true, force: true });
}
