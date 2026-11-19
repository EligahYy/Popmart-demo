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

  // Safari/older webviews may lack requestVideoFrameCallback. Exercise the
  // readiness-checked animation-frame path as a separate fresh visitor.
  const fallback = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
  await fallback.addInitScript(() => {
    Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', { value: undefined });
  });
  const older = await fallback.newPage();
  older.on('pageerror', error => errors.push(error.message));
  await older.goto(base);
  await older.locator('img.home-figure__poster').waitFor();
  await idle(older);
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
