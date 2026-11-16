import { useEffect, useState } from 'react';
import { useStyleImage } from '../media/useStyleImage.js';

export function StyleImage({
  url,
  assetId,
  alt,
  className,
  placeholder = '暂无图片',
  loading = 'lazy',
}: {
  url: string | null;
  assetId?: string | null;
  alt: string;
  className?: string;
  placeholder?: string;
  loading?: 'lazy' | 'eager';
}) {
  const resolved = useStyleImage(url, assetId);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [resolved]);

  if (!resolved || failed) {
    return <span className="style-card__placeholder">{placeholder}</span>;
  }

  return (
    <img
      src={resolved}
      alt={alt}
      loading={loading}
      referrerPolicy="no-referrer"
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
