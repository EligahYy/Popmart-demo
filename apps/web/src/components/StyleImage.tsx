import { useEffect, useState } from 'react';
import { useStyleImage } from '../media/useStyleImage.js';
import { rememberThumbnail, thumbnailUrl, type ImageWidth } from '../media/thumbnails.js';

export function StyleImage({
  url, assetId, alt, className, placeholder = '暂无图片', loading = 'lazy', width = 384,
}: {
  url: string | null;
  assetId?: string | null;
  alt: string;
  className?: string;
  placeholder?: string;
  loading?: 'lazy' | 'eager';
  width?: ImageWidth;
}) {
  const resolved = useStyleImage(url, assetId, width);
  const optimized = thumbnailUrl(url, width);
  const [failed, setFailed] = useState<string[]>([]);
  useEffect(() => { setFailed([]); }, [resolved, url, width]);
  const src = [resolved, optimized, url].find((candidate) => candidate && !failed.includes(candidate));
  if (!src) return <span className="style-card__placeholder">{placeholder}</span>;
  return (
    <img
      src={src}
      alt={alt}
      loading={loading}
      decoding="async"
      fetchPriority={loading === 'eager' ? 'high' : 'auto'}
      referrerPolicy="no-referrer"
      className={className}
      onLoad={() => { if (src === optimized && !navigator.serviceWorker?.controller) void rememberThumbnail(src); }}
      onError={() => setFailed((previous) => [...previous, src])}
    />
  );
}
