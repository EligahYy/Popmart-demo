import { chromium } from 'playwright-core';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const persona = process.env.PERSONA ?? 'assets/persona.png';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const log = (step) => console.log(`· ${step}`);

await page.goto(base, { waitUntil: 'networkidle' });
await page.getByText('我的小窝').first().waitFor({ timeout: 15000 });

// 可选：上传个人形象（PERSONA=none 时使用内置默认形象）
if (persona !== 'none') {
  await page.getByRole('link', { name: '设置' }).click();
  await page.getByRole('heading', { name: '设置' }).waitFor();
  await page.setInputFiles('input[type=file]', persona);
  await page.getByText('首页形象已保存到本机。').waitFor({ timeout: 15000 });
  log('形象已上传');
}

// 首页
await page.getByRole('link', { name: '我的小窝' }).click();
await page.locator('.home-figure__media').waitFor({ timeout: 15000 });
const dismiss = page.getByRole('button', { name: '知道了' });
if (await dismiss.isVisible().catch(() => false)) await dismiss.click();

// 造一点数据
const addDialog = page.getByRole('dialog', { name: '欢迎新宝宝' });
await page.locator('.tabbar__add').click();
await addDialog.waitFor();
const emptyImport = addDialog.getByRole('button', { name: '＋ 导入新系列' });
await emptyImport.waitFor({ timeout: 15000 });
await emptyImport.click();
await page.getByRole('dialog', { name: '导入新系列' }).waitFor();
await page.locator('textarea').fill('https://www.popmart.com/ca/products/9120');
await page.getByRole('button', { name: '解析链接' }).click();
const candidate = page.getByRole('button', { name: /Twinkle Twinkle Live the Ordinary/ }).first();
await candidate.waitFor({ timeout: 60000 });
await candidate.click();
await page.getByText(/共 13 款/).waitFor({ timeout: 60000 });
await page.locator('input[inputmode="decimal"]').fill('69');
await page.getByRole('button', { name: '保存到图库' }).click();
await page.locator('.toast', { hasText: '已加入图库' }).waitFor({ timeout: 30000 });

await addDialog.getByRole('button', { name: '多选' }).waitFor({ timeout: 15000 });
await addDialog.getByRole('button', { name: '多选' }).click();
const cards = addDialog.locator('.style-card');
for (let index = 0; index < 4; index += 1) await cards.nth(index).click();
await addDialog.getByRole('button', { name: '下一步：填写订单' }).click();
await addDialog.getByRole('button', { name: '保存这笔订单' }).click();
await page.locator('.toast', { hasText: '已入住' }).waitFor({ timeout: 30000 });
await page.getByRole('button', { name: '关闭' }).click();
log('已造 4 只收藏');

await page.waitForFunction(
  () => {
    const img = document.querySelector('.ip-card__media img');
    return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
  },
  null,
  { timeout: 20000 },
).catch(() => undefined);
await page.waitForTimeout(800);
const box = await page.locator('.ip-card__media').first().evaluate((el) => {
  const img = el.querySelector('img');
  return {
    media: el.getBoundingClientRect().toJSON(),
    img: img ? img.getBoundingClientRect().toJSON() : null,
    imgHeight: img ? getComputedStyle(img).height : null,
    objectFit: img ? getComputedStyle(img).objectFit : null,
    src: img ? img.src.slice(0, 30) : null,
  };
});
console.log('IP media box:', JSON.stringify(box));
await page.screenshot({ path: '/tmp/visual-home.png' });

await page.locator('.ip-card').first().click();
await page.locator('.series-block').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/visual-collection.png' });

await page.locator('.fan__card').last().click();
await page.getByRole('dialog', { name: /身份卡/ }).waitFor({ timeout: 10000 });
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/visual-identity.png' });
await page.getByRole('button', { name: '关闭身份卡' }).click();

await page.getByRole('link', { name: '捂一下钱包？' }).click();
await page.getByRole('heading', { name: '捂一下钱包？' }).waitFor({ timeout: 10000 });
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/visual-ledger.png', fullPage: true });

console.log('errors:', errors.length === 0 ? 'none' : errors.join(' | '));
await browser.close();
