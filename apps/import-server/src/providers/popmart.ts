import { readFileSync } from 'node:fs';
import type {
  ImportErrorCode,
  ImportWarning,
  ProductKind,
  SeriesCandidate,
  SeriesPreview,
  SeriesPreviewStyle,
} from '@my-popmart/contracts';
import { assertMediaUrl, assertWebUrl, UrlGuardError } from '../security/urlGuard.js';
import {
  signToken,
  verifyToken,
  type CandidateTokenPayload,
  type MediaTokenPayload,
} from '../security/sign.js';

export class ImportError extends Error {
  override readonly name = 'ImportError';
  constructor(
    readonly code: ImportErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export const PARSER_VERSION = 'popmart-next-data/1';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_HTML_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const PRODUCT_PATH = /^\/([a-z]{2})\/products\/(\d+)(?:\/|$)/;
const COLLECTION_PATH = /^\/([a-z]{2})\/collection\/(\d+)(?:\/|$)/;

interface AliasEntry {
  readonly region: string;
  readonly spuId: string;
  readonly title: string;
  readonly ipName: string | null;
  readonly aliases: readonly string[];
  readonly source: string;
  readonly verifiedAt: string;
}

export interface ProviderOptions {
  readonly signingSecret: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly requestTimeoutMs?: number;
  readonly maxHtmlBytes?: number;
  readonly maxMediaBytes?: number;
  readonly aliasesPath?: string;
  readonly sitemapTtlMs?: number;
}

export interface MediaResult {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

export interface PopmartProvider {
  classify(input: string): 'web_url' | 'miniapp_text' | 'invalid';
  resolve(input: string): Promise<SeriesCandidate[]>;
  search(query: string): Promise<SeriesCandidate[]>;
  preview(candidateId: string): Promise<SeriesPreview>;
  media(token: string): Promise<MediaResult>;
  imageByUrl(rawUrl: string): Promise<MediaResult>;
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'style' : slug;
}

function humanizeSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function inferProductKind(title: string, styleCount: number): ProductKind {
  const lower = title.toLowerCase();
  if (lower.includes('pop bean')) return 'pop_bean';
  if (lower.includes('pendant') || lower.includes('plush')) return 'plush_pendant';
  if (styleCount > 0) return 'figure';
  if (lower.includes('figure') || lower.includes('series')) return 'figure';
  return 'accessory';
}

export function extractNextData(html: string): unknown {
  const matched = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!matched?.[1]) {
    throw new ImportError('SOURCE_CHANGED', '页面结构已变化，无法读取结构化数据', false);
  }
  try {
    return JSON.parse(matched[1]);
  } catch {
    throw new ImportError('SOURCE_CHANGED', '页面数据不是有效 JSON', false);
  }
}

interface CommonInfo {
  title?: unknown;
  toys?: unknown;
  banners?: unknown;
  desc?: unknown;
  ipDesignerInfo?: { brandName?: unknown; brandID?: unknown };
  spuPriceInfo?: { price?: unknown; currency?: unknown };
}

function pickCommonInfo(data: unknown): CommonInfo {
  const info = (data as { props?: { pageProps?: { serverSeoData?: { commonInfo?: CommonInfo } } } })
    ?.props?.pageProps?.serverSeoData?.commonInfo;
  if (!info || typeof info !== 'object') {
    throw new ImportError('SOURCE_CHANGED', '缺少商品数据结构', false);
  }
  return info;
}

export function buildPreview(
  data: unknown,
  context: { region: string; spuId: string; sourceUrl: string; fetchedAt: string },
  options: { signMedia: (url: string) => string },
): SeriesPreview {
  const info = pickCommonInfo(data);
  const title = typeof info.title === 'string' ? info.title.trim() : '';
  if (title === '') {
    throw new ImportError('SOURCE_CHANGED', '缺少系列名称', false);
  }

  const rawToys = Array.isArray(info.toys) ? info.toys : [];
  const toys = rawToys.filter(
    (toy): toy is { name: string; type?: number; url: string } =>
      typeof toy === 'object' &&
      toy !== null &&
      typeof (toy as { name?: unknown }).name === 'string' &&
      typeof (toy as { url?: unknown }).url === 'string',
  );

  const warnings: ImportWarning[] = ['PRICE_UNVERIFIED', 'CNY_PRICE_UNAVAILABLE'];
  if (toys.length === 0) warnings.push('NO_STYLES');

  const seen = new Map<string, number>();
  const styles: SeriesPreviewStyle[] = toys.map((toy) => {
    const base = slugify(toy.name);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const canonicalKey = count === 1 ? base : `${base}-${count}`;
    return {
      canonicalKey,
      name: toy.name,
      isSecret: toy.type === 2,
      image: { sourceUrl: toy.url, assetToken: options.signMedia(toy.url) },
      referenceUnitCents: null,
      sourcePrice: null,
    };
  });

  const brandName =
    typeof info.ipDesignerInfo?.brandName === 'string' && info.ipDesignerInfo.brandName.trim() !== ''
      ? info.ipDesignerInfo.brandName.trim()
      : null;
  const brandId = info.ipDesignerInfo?.brandID;

  return {
    previewVersion: 2,
    candidateId: '',
    canonicalKey: `popmart:${context.region}:${context.spuId}`,
    ip: {
      canonicalKey: brandName ? slugify(brandName) : `ip-${String(brandId ?? 'unknown')}`,
      name: brandName ?? '未知 IP',
      aliases: [],
    },
    name: title,
    productKind: inferProductKind(title, styles.length),
    region: context.region,
    sourceUrl: context.sourceUrl,
    fetchedAt: context.fetchedAt,
    parserVersion: PARSER_VERSION,
    seriesReferenceUnitCents: null,
    priceProvenance: null,
    foreignReference: null,
    styles,
    warnings,
  };
}

export function createPopmartProvider(options: ProviderOptions): PopmartProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxHtmlBytes = options.maxHtmlBytes ?? DEFAULT_MAX_HTML_BYTES;
  const maxMediaBytes = options.maxMediaBytes ?? DEFAULT_MAX_MEDIA_BYTES;
  const sitemapTtlMs = options.sitemapTtlMs ?? 60 * 60 * 1000;

  let aliases: AliasEntry[] | null = null;
  let sitemapCache: { expiresAt: number; items: Array<{ url: string; slug: string; region: string; spuId: string }> } | null =
    null;

  function loadAliases(): AliasEntry[] {
    if (aliases) return aliases;
    if (!options.aliasesPath) {
      aliases = [];
      return aliases;
    }
    try {
      const parsed = JSON.parse(readFileSync(options.aliasesPath, 'utf8')) as unknown;
      aliases = Array.isArray(parsed) ? (parsed as AliasEntry[]) : [];
    } catch {
      aliases = [];
    }
    return aliases;
  }

  async function requestFollow(
    rawUrl: string,
    accept: string,
    limitBytes: number,
  ): Promise<{ body: Uint8Array; contentType: string; finalUrl: string }> {
    let current = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(current, {
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'user-agent': USER_AGENT,
            accept,
            'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          },
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) {
            throw new ImportError('SOURCE_UNAVAILABLE', '重定向缺少目标地址', true);
          }
          current = new URL(location, current).toString();
          // 每一跳都重新过白名单
          assertWebUrl(current);
          continue;
        }

        if (!response.ok) {
          throw new ImportError('SOURCE_UNAVAILABLE', `来源返回 ${response.status}`, true);
        }

        const contentType = response.headers.get('content-type') ?? '';
        const buffer = new Uint8Array(await response.arrayBuffer());
        if (buffer.byteLength > limitBytes) {
          throw new ImportError('SOURCE_UNAVAILABLE', '响应体超过大小限制', false);
        }
        return { body: buffer, contentType, finalUrl: current };
      } catch (error) {
        if (error instanceof ImportError) throw error;
        if (error instanceof UrlGuardError) throw new ImportError('UNSUPPORTED_SOURCE', error.message, false);
        throw new ImportError('SOURCE_UNAVAILABLE', '无法连接来源站点', true);
      } finally {
        clearTimeout(timer);
      }
    }
    throw new ImportError('SOURCE_UNAVAILABLE', '重定向次数过多', false);
  }

  async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string }> {
    const result = await requestFollow(url, 'text/html,application/xhtml+xml', maxHtmlBytes);
    return { html: new TextDecoder().decode(result.body), finalUrl: result.finalUrl };
  }

  function signMedia(url: string): string {
    return signToken({ v: 1, u: url, e: now() + 60 * 60 * 1000 }, options.signingSecret);
  }

  function toCandidate(
    region: string,
    spuId: string,
    title: string,
    ipName: string | null,
    thumbnailUrl: string | null,
    productKind: ProductKind,
    matchReason: string | null,
  ): SeriesCandidate {
    return {
      candidateId: signToken({ v: 1, region, spuId }, options.signingSecret),
      canonicalKey: `popmart:${region}:${spuId}`,
      title,
      ipName,
      productKind,
      region,
      sourceUrl: `https://www.popmart.com/${region}/products/${spuId}`,
      thumbnailUrl,
      matchReason,
    };
  }

  async function previewBySpu(region: string, spuId: string): Promise<SeriesPreview> {
    const sourceUrl = `https://www.popmart.com/${region}/products/${spuId}`;
    const { html, finalUrl } = await fetchHtml(sourceUrl);
    const data = extractNextData(html);

    const preview = buildPreview(
      data,
      {
        region,
        spuId,
        sourceUrl: finalUrl,
        fetchedAt: new Date(now()).toISOString(),
      },
      { signMedia },
    );

    const candidateId = signToken({ v: 1, region, spuId }, options.signingSecret);
    return {
      ...preview,
      candidateId,
      ip: {
        ...preview.ip,
        aliases: [],
      },
      styles: preview.styles,
      warnings: preview.warnings,
    };
  }

  function classify(input: string): 'web_url' | 'miniapp_text' | 'invalid' {
    const text = input.trim();
    if (text === '') return 'invalid';
    if (text.includes('小程序://') || text.startsWith('#')) return 'miniapp_text';
    try {
      const url = new URL(text);
      return url.hostname.endsWith('popmart.com') ? 'web_url' : 'invalid';
    } catch {
      return 'invalid';
    }
  }

  async function resolve(input: string): Promise<SeriesCandidate[]> {
    const kind = classify(input);
    if (kind === 'miniapp_text') {
      throw new ImportError('MINIAPP_UNRESOLVED', '小程序分享码无法直接解析，请改用系列名称', false);
    }
    if (kind === 'invalid') {
      throw new ImportError('INVALID_INPUT', '请输入官方商品链接', false);
    }

    const url = assertWebUrl(input.trim());
    const product = PRODUCT_PATH.exec(url.pathname);
    if (product) {
      const region = product[1] ?? 'ca';
      const spuId = product[2] ?? '';
      const preview = await previewBySpu(region, spuId);
      return [
        toCandidate(
          region,
          spuId,
          preview.name,
          preview.ip.name,
          preview.styles[0]?.image?.sourceUrl ?? null,
          preview.productKind,
          'link',
        ),
      ];
    }

    const collection = COLLECTION_PATH.exec(url.pathname);
    if (collection) {
      return resolveCollection(collection[1] ?? 'ca', collection[2] ?? '');
    }

    throw new ImportError('UNSUPPORTED_SOURCE', '只支持商品页或系列页链接', false);
  }

  async function resolveCollection(region: string, collectionId: string): Promise<SeriesCandidate[]> {
    const pageUrl = `https://www.popmart.com/${region}/collection/${collectionId}`;
    const { html } = await fetchHtml(pageUrl);
    const data = extractNextData(html);
    const buildId = (data as { buildId?: unknown }).buildId;
    if (typeof buildId !== 'string' || buildId === '') {
      throw new ImportError('SOURCE_CHANGED', '无法确定站点版本', false);
    }

    const dataUrl = `https://www.popmart.com/_next/data/${buildId}/${region}/collection/${collectionId}.json`;
    const result = await requestFollow(dataUrl, 'application/json', maxHtmlBytes);
    const parsed = JSON.parse(new TextDecoder().decode(result.body)) as {
      pageProps?: {
        serverCollectionRaw?: { productData?: Array<{ id?: unknown; title?: unknown; bannerImages?: unknown }> };
      };
    };

    const products = parsed.pageProps?.serverCollectionRaw?.productData;
    if (!Array.isArray(products) || products.length === 0) {
      throw new ImportError('NO_MATCH', '该系列页没有可识别的商品', false);
    }

    return products.flatMap((product) => {
      const id = typeof product.id === 'string' ? product.id : String(product.id ?? '');
      const title = typeof product.title === 'string' ? product.title : '';
      if (id === '' || title === '') return [];
      const banner = Array.isArray(product.bannerImages) ? product.bannerImages[0] : null;
      return [
        toCandidate(
          region,
          id,
          title,
          null,
          typeof banner === 'string' ? banner : null,
          inferProductKind(title, 1),
          'collection',
        ),
      ];
    });
  }

  async function loadSitemap(): Promise<Array<{ url: string; slug: string; region: string; spuId: string }>> {
    if (sitemapCache && sitemapCache.expiresAt > now()) return sitemapCache.items;

    const { html } = await fetchHtml('https://www.popmart.com/ca/sitemap-products.xml');
    const items: Array<{ url: string; slug: string; region: string; spuId: string }> = [];
    const regex = /<loc>([^<]+)<\/loc>/g;
    let matched: RegExpExecArray | null;
    while ((matched = regex.exec(html)) !== null) {
      const url = matched[1];
      if (!url) continue;
      const path = PRODUCT_PATH.exec(new URL(url).pathname);
      if (!path) continue;
      const slug = url.split('/').pop() ?? '';
      items.push({ url, slug, region: path[1] ?? 'ca', spuId: path[2] ?? '' });
    }

    sitemapCache = { expiresAt: now() + sitemapTtlMs, items };
    return items;
  }

  async function search(query: string): Promise<SeriesCandidate[]> {
    const normalized = normalizeText(query);
    if (normalized === '') {
      throw new ImportError('NO_MATCH', '请输入系列名称', false);
    }

    const results = new Map<string, { candidate: SeriesCandidate; score: number }>();

    for (const entry of loadAliases()) {
      const aliasMatch = entry.aliases.some((alias) => {
        const normalizedAlias = normalizeText(alias);
        return normalizedAlias === normalized || normalizedAlias.includes(normalized) || normalized.includes(normalizedAlias);
      });
      if (!aliasMatch) continue;
      const candidate = toCandidate(
        entry.region,
        entry.spuId,
        entry.title,
        entry.ipName,
        null,
        'figure',
        'alias',
      );
      results.set(candidate.canonicalKey, { candidate, score: 100 });
    }

    if (results.size < 8) {
      try {
        const sitemap = await loadSitemap();
        const tokens = normalized.split(' ').filter(Boolean);
        for (const item of sitemap) {
          if (results.size >= 12) break;
          const slugText = item.slug.replace(/-/g, ' ');
          const hit = tokens.every((token) => slugText.includes(token));
          if (!hit) continue;
          const key = `popmart:${item.region}:${item.spuId}`;
          if (results.has(key)) continue;
          results.set(key, {
            candidate: toCandidate(
              item.region,
              item.spuId,
              humanizeSlug(item.slug),
              null,
              null,
              'other',
              'slug',
            ),
            score: 50,
          });
        }
      } catch (error) {
        // 有别名结果时仍可降级；没有结果时保留上游故障，避免误报名称不存在。
        if (results.size === 0) throw error;
      }
    }

    const sorted = [...results.values()]
      .sort((left, right) => right.score - left.score || left.candidate.title.localeCompare(right.candidate.title))
      .map((entry) => entry.candidate);

    if (sorted.length === 0) {
      throw new ImportError('NO_MATCH', '没有匹配的系列，请换个名称或粘贴链接', false);
    }
    return sorted.slice(0, 12);
  }

  async function preview(candidateId: string): Promise<SeriesPreview> {
    const payload = verifyToken<CandidateTokenPayload>(candidateId, options.signingSecret);
    if (!payload || payload.v !== 1 || !payload.region || !payload.spuId) {
      throw new ImportError('TOKEN_INVALID', '候选已失效，请重新搜索', false);
    }
    return previewBySpu(payload.region, payload.spuId);
  }

  async function media(token: string): Promise<MediaResult> {
    const payload = verifyToken<MediaTokenPayload>(token, options.signingSecret);
    if (!payload || payload.v !== 1 || typeof payload.u !== 'string') {
      throw new ImportError('TOKEN_INVALID', '媒体链接无效', false);
    }
    if (typeof payload.e !== 'number' || payload.e < now()) {
      throw new ImportError('TOKEN_INVALID', '媒体链接已过期', true);
    }
    const url = assertMediaUrl(payload.u);
    const result = await requestFollow(url.toString(), 'image/*', maxMediaBytes);
    if (!result.contentType.startsWith('image/')) {
      throw new ImportError('MEDIA_UNAVAILABLE', '来源返回的不是图片', false);
    }
    return { bytes: result.body, contentType: result.contentType };
  }

  async function imageByUrl(rawUrl: string): Promise<MediaResult> {
    let url: URL;
    try {
      url = assertMediaUrl(rawUrl);
    } catch (error) {
      throw new ImportError(
        'UNSUPPORTED_SOURCE',
        error instanceof Error ? error.message : '不支持的图片地址',
        false,
      );
    }
    const result = await requestFollow(url.toString(), 'image/*', maxMediaBytes);
    if (!result.contentType.startsWith('image/')) {
      throw new ImportError('MEDIA_UNAVAILABLE', '来源返回的不是图片', false);
    }
    return { bytes: result.body, contentType: result.contentType };
  }

  return { classify, resolve, search, preview, media, imageByUrl };
}
