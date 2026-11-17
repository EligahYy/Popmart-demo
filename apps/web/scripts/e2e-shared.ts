import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { buildApp } from '../../import-server/src/buildApp.js';
import { MemoryStore } from '../../import-server/src/shared/testing/memoryStore.js';

const fixture = readFileSync(new URL('../../import-server/src/providers/__fixtures__/popmart-product-9120.html', import.meta.url),'utf8');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwZkAAAAASUVORK5CYII=','base64');
const app = buildApp({
  sharedStore: new MemoryStore(), signingSecret:'browser-test',
  staticDir:fileURLToPath(new URL('../dist',import.meta.url)),
  fetchImpl: (async (input) => String(input).includes('/products/')
    ? new Response(fixture,{headers:{'content-type':'text/html'}})
    : new Response(png,{headers:{'content-type':'image/png'}})) as typeof fetch,
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
  await panel.locator('.import-search input').fill('https://www.popmart.com/ca/products/9120');
  await panel.getByRole('button',{name:'导入',exact:true}).click();
  await panel.getByRole('button',{name:/Twinkle Twinkle Live the Ordinary/}).first().click();
  await panel.getByText(/共 13 款/).waitFor();
  await panel.locator('input[inputmode="decimal"]').fill('69');
  await panel.getByRole('button',{name:'保存到图库'}).click();
  await a.locator('.toast',{hasText:'系列导入成功'}).waitFor();
  await panel.locator('.style-card').first().click();
  await panel.getByRole('button',{name:'下一步：填写订单'}).click();
  await panel.getByRole('button',{name:'保存',exact:true}).click();
  await a.locator('.toast',{hasText:'已入住'}).waitFor();
  await b.locator('.ip-card').first().waitFor({timeout:15000});
  console.log('PASS: imported series and purchase appear in second browser');

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
