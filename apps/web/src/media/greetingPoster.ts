/**
 * 从「左彩色 + 右蒙版」的打招呼视频提取第一帧，生成透明 PNG。
 * 常态形象用它，点击播放时首帧与静态完全一致，衔接不会有跳变。
 */
export async function createGreetingPoster(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('视频读取失败'));
      window.setTimeout(() => reject(new Error('视频读取超时')), 8000);
    });
    // iOS 上暂停在 0 秒可能还没有可绘制的帧，先短暂播放再回到首帧
    video.currentTime = 0;
    video.play().catch(() => undefined);
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    video.pause();
    video.currentTime = 0;
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      window.setTimeout(resolve, 350);
    });

    const width = 432;
    const height = 576;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('画布不可用');

    const half = video.videoWidth / 2;
    const full = video.videoHeight;
    if (!half || !full) throw new Error('视频尺寸异常');

    ctx.drawImage(video, 0, 0, half, full, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) throw new Error('画布不可用');
    maskCtx.drawImage(video, half, 0, half, full, 0, 0, width, height);
    const mask = maskCtx.getImageData(0, 0, width, height);

    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i + 3] = mask.data[i] ?? 0;
    }
    ctx.putImageData(image, 0, 0);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('生成失败'))), 'image/png');
    });
    return new File([blob], 'greeting-poster.png', { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
    video.remove();
  }
}
