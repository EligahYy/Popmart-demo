export const WEB_HOSTS = new Set(['www.popmart.com', 'popmart.com']);

export const MEDIA_HOSTS = new Set([
  'prod-global-biz.popmart.com',
  'global-static.popmart.com',
  'prod-america-res.popmart.com',
  'cdn-global-naus.popmart.com',
]);

export class UrlGuardError extends Error {
  override readonly name = 'UrlGuardError';
}

function parse(raw: string, hosts: ReadonlySet<string>): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlGuardError('不是有效链接');
  }
  if (url.protocol !== 'https:') {
    throw new UrlGuardError('只支持 https 链接');
  }
  if (url.username || url.password) {
    throw new UrlGuardError('链接不能包含凭据');
  }
  if (url.port !== '' && url.port !== '443') {
    throw new UrlGuardError('不支持非标准端口');
  }
  if (!hosts.has(url.hostname)) {
    throw new UrlGuardError(`不支持的来源：${url.hostname}`);
  }
  return url;
}

export function assertWebUrl(raw: string): URL {
  return parse(raw, WEB_HOSTS);
}

export function assertMediaUrl(raw: string): URL {
  return parse(raw, MEDIA_HOSTS);
}

/**
 * 拒绝内网、回环、链路本地等地址；域名白名单之外的直接拒绝。
 * 白名单已覆盖主要风险，这里作为第二道防线。
 */
export function assertNotPrivateHost(hostname: string): void {
  if (hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new UrlGuardError('不允许访问本机地址');
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    throw new UrlGuardError('不允许直接访问 IP 地址');
  }
}
