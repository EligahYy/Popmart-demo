import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { buildApp } from '../../import-server/src/buildApp.js';
import { MemoryStore } from '../../import-server/src/shared/testing/memoryStore.js';

const fixture = readFileSync(new URL('../../import-server/src/providers/__fixtures__/popmart-product-9120.html', import.meta.url),'utf8');
const firstTitle = 'Twinkle Twinkle Live the Ordinary Series Figures';
const secondTitle = 'Twinkle Twinkle Second Test Series Figures';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwZkAAAAASUVORK5CYII=','base64');
const upstreamImages: string[] = [];
const app = buildApp({
  sharedStore: new MemoryStore(), signingSecret:'browser-test',
  staticDir:fileURLToPath(new URL('../dist',import.meta.url)),
  fetchImpl: (async (input) => {
    if (String(input).includes('/products/')) return new Response(
      String(input).includes('/products/9121') ? fixture.replaceAll(firstTitle, secondTitle) : fixture,
      {headers:{'content-type':'text/html'}},
    );
    upstreamImages.push(String(input));
    return new Response(png,{headers:{'content-type':'image/png'}});
  }) as typeof fetch,
});
const base = await app.listen({port:0,host:'127.0.0.1'});
const browser = await chromium.launch({ headless:true, ...(existsSync('/usr/bin/chromium') ? {executablePath:'/usr/bin/chromium'} : {channel:'chrome'}) });
const errors: string[] = [];
try {
  const contexts = await Promise.all([browser.newContext({viewport:{width:430,height:932}}),browser.newContext({viewport:{width:430,height:932}})]);
  for (const context of contexts) await context.route('https://**.popmart.com/**',route => route.fulfill({body:png,contentType:'image/png'}));
  const [a,b] = await Promise.all(contexts.map(context => context.newPage()));
  if (!a || !b) throw new Error('Missing test pages');
  for (const page of [a,b]) {
    page.on('pageerror',error => errors.push(error.message));
    page.on('console',message => { if (message.type() === 'error') console.log('browser console:',message.text()); });
  }
  await Promise.all([a.goto(base),b.goto(base)]);
  await Promise.all([a.getByText('共享展示空间 · 修改会对所有访客可见').waitFor({timeout:10000}),b.getByText('共享展示空间 · 修改会对所有访客可见').waitFor({timeout:10000})]).catch(async error => { console.log('BOOT:',await a.locator('body').innerText(),errors); throw error; });

  await a.getByRole('link',{name:'设置'}).click();
  await a.getByLabel('名称',{exact:true}).fill('云端同步验证');
  await a.getByRole('button',{name:'保存名称',exact:true}).click();
  await a.getByText('空间名称已保存。').waitFor();
  await b.getByRole('heading',{name:'云端同步验证',exact:true}).waitFor({timeout:15000});
  console.log('PASS: independent browser sees saved cloud name without reload');

  await a.getByRole('link',{name:'我的小窝',exact:true}).click();
  await a.locator('.tabbar__add').click();
  const panel = a.getByRole('dialog',{name:'欢迎新宝宝'});
  const imageRequests: string[] = [];
  a.on('request', request => {
    if (request.url().includes('/api/import/image?')) imageRequests.push(request.url());
  });
  async function importSeries(id: string, title: string) {
    await panel.locator('.import-search input').fill(`https://www.popmart.com/ca/products/${id}`);
    await panel.getByRole('button',{name:'导入',exact:true}).click();
    await panel.getByRole('button',{name:new RegExp(title)}).first().click();
    await panel.getByText(/共 13 款/).waitFor();
    await panel.locator('input[inputmode="decimal"]').fill('69');
    await panel.getByRole('button',{name:'保存到图库'}).click();
    await panel.locator('.series-picker__trigger',{hasText:title}).waitFor();
  }
  await importSeries('9120', firstTitle);
  await a.waitForFunction(() => {
    const img = document.querySelector<HTMLImageElement>('.style-card img');
    return img?.complete && img.naturalWidth > 0;
  });
  assert(imageRequests.length > 0);
  assert(imageRequests.every(url => new URL(url).searchParams.get('w') === '384'));
  console.log('PASS: import displays optimized cards without background original downloads');
  await panel.locator('.style-card').first().click();
  await panel.getByRole('button',{name:'下一步：填写订单'}).click();
  await panel.getByRole('button',{name:'保存',exact:true}).click();
  await a.locator('.toast',{hasText:'已入住'}).waitFor();
  await b.locator('.ip-card').first().waitFor({timeout:15000});
  console.log('PASS: imported series and purchase appear in second browser');

  await a.locator('.tabbar__add').click();
  await importSeries('9121', secondTitle);
  await a.waitForResponse(response => new URL(response.url()).pathname === '/api/shared/state' && response.request().method() === 'GET');
  await panel.locator('.series-picker__trigger',{hasText:secondTitle}).waitFor();
  await panel.locator('.series-picker__trigger').click();
  assert.deepEqual(await panel.locator('.series-picker__item .series-picker__name').allTextContents(), [secondTitle, firstTitle]);
  await panel.locator('.series-picker__item',{hasText:firstTitle}).click();
  const cachedImageCount = upstreamImages.length;
  await b.getByRole('link',{name:'设置',exact:true}).click();
  await b.getByLabel('名称',{exact:true}).fill('共享顺序更新');
  await b.getByRole('button',{name:'保存名称',exact:true}).click();
  await a.getByRole('heading',{name:'共享顺序更新',exact:true}).waitFor({timeout:15000});
  assert((await panel.locator('.series-picker__trigger').innerText()).includes(firstTitle));
  assert.equal(upstreamImages.length, cachedImageCount, 'cloud refresh must not re-fetch displayed images');
  await importSeries('9120', firstTitle);
  await panel.locator('.series-picker__trigger').click();
  assert.deepEqual(await panel.locator('.series-picker__item .series-picker__name').allTextContents(), [firstTitle, secondTitle]);
  await panel.getByRole('button',{name:'关闭',exact:true}).click();
  await a.locator('.tabbar__add').click();
  await panel.locator('.series-picker__trigger',{hasText:firstTitle}).waitFor();
  await panel.getByRole('button',{name:'关闭',exact:true}).click();
  console.log('PASS: newest import/reimport is selected first; manual selection survives cloud synchronization');

  await a.locator('.ip-card').first().click();
  await a.locator('.fan__card--active').click();
  const original = a.locator('.identity__media img');
  await original.waitFor();
  await a.waitForFunction(() => {
    const image = document.querySelector<HTMLImageElement>('.identity__media img');
    return image?.complete && image.naturalWidth > 0;
  });
  const originalSrc = await original.getAttribute('src');
  assert(originalSrc?.startsWith('/api/import/image?'));
  assert.equal(new URL(originalSrc!, base).searchParams.get('w'), null);
  await a.getByRole('button',{name:'关闭身份卡'}).click();
  console.log('PASS: identity card loads the untouched original image');

  await b.getByRole('link',{name:'我的小窝',exact:true}).click();
  await a.getByRole('link',{name:'我的小窝',exact:true}).click();
  await a.getByRole('link',{name:'设置',exact:true}).click();
  await a.locator('input[accept="image/*,video/*"]').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:png});
  await a.getByText('首页形象已保存到共享空间。').waitFor({timeout:15000});
  await b.getByAltText('我的形象',{exact:true}).waitFor({timeout:15000});
  await b.reload();
  await b.getByAltText('我的形象',{exact:true}).waitFor({timeout:15000});
  await b.locator('.ip-card').first().waitFor();
  console.log('PASS: uploaded media and collection survive a fresh cloud load');

  await b.getByRole('link',{name:'捂一下钱包？'}).click();
  await b.getByRole('heading',{name:'捂一下钱包？'}).waitFor();
  await b.getByText('Twinkle Twinkle',{exact:false}).first().waitFor();
  console.log('PASS: shared ledger is accessible');
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
  await app.close();
}
