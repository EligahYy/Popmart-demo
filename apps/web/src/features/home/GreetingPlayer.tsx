import { useEffect, useRef, useState } from 'react';
import { createGreetingRenderer, type GreetingRenderer } from '../../media/greetingRenderer.js';

// Must outlast the 180ms poster/canvas opacity transition in global.css.
const RETURN_MS = 200;

/** Reveal animation only after an actual decoded frame has been composited. */
export function GreetingPlayer({ url, posterUrl, playing, onFinished }: {
  url: string;
  posterUrl?: string;
  playing: boolean;
  onFinished: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const posterRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controllerRef = useRef<{ start(): void; stop(): void } | null>(null);
  const [visibleUrl, setVisibleUrl] = useState<string | null>(null);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const poster = posterRef.current;
    if (!video || !canvas) return;
    let renderer: GreetingRenderer | null = null;
    try { renderer = createGreetingRenderer(canvas); } catch { /* Keep the poster. */ }
    let disposed = false;
    let requested = false;
    let run = 0;
    let frame: number | null = null;
    let resetTimer: number | undefined;
    let capturedPoster = false;
    const hasVideoFrames = typeof video.requestVideoFrameCallback === 'function';

    const cancelFrame = () => {
      if (frame === null) return;
      if (hasVideoFrames) video.cancelVideoFrameCallback(frame);
      else cancelAnimationFrame(frame);
      frame = null;
    };
    const draw = () => {
      try {
        if (!renderer?.draw(video)) return false;
        if (!capturedPoster && poster) {
          poster.getContext('2d')?.drawImage(canvas, 0, 0);
          capturedPoster = true;
        }
        return true;
      } catch { return false; }
    };
    const schedule = () => {
      if (disposed || !requested || frame !== null) return;
      const tick = () => {
        frame = null;
        if (disposed || !requested) return;
        if (draw()) setVisibleUrl(url);
        schedule();
      };
      frame = hasVideoFrames ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
    };
    const stop = (notify = false) => {
      requested = false;
      run += 1;
      cancelFrame();
      video.pause();
      setVisibleUrl(null);
      window.clearTimeout(resetTimer);
      // Keep the last valid frame throughout the fade. Rewind behind the
      // poster afterwards, rather than seeking on the visible canvas.
      resetTimer = window.setTimeout(() => {
        if (disposed || requested) return;
        try { if (video.currentTime > 0.05) video.currentTime = 0; } catch { /* Await metadata. */ }
        if (notify) onFinishedRef.current();
      }, RETURN_MS);
    };
    const start = () => {
      if (requested || disposed) return;
      if (!renderer || video.error) { onFinishedRef.current(); return; }
      window.clearTimeout(resetTimer);
      const token = ++run;
      requested = true;
      // The poster still covers the canvas during seeking/decoder warm-up.
      try { if (video.currentTime > 0.05) video.currentTime = 0; } catch { /* Await metadata. */ }
      void video.play().then(() => {
        if (!disposed && requested && run === token) schedule();
      }).catch(() => {
        if (!disposed && run === token) stop(true);
      });
      schedule();
    };
    const prepare = () => { if (!requested) draw(); };
    const ended = () => stop(true);
    const failed = () => stop(true);
    const paused = () => { if (requested && !video.ended) stop(true); };
    const contextLost = (event: Event) => {
      event.preventDefault();
      renderer?.dispose();
      renderer = null;
      stop(true);
    };
    const contextRestored = () => {
      renderer?.dispose();
      try { renderer = createGreetingRenderer(canvas); prepare(); } catch { renderer = null; }
    };
    controllerRef.current = { start, stop: () => stop() };
    video.addEventListener('loadeddata', prepare);
    video.addEventListener('seeked', prepare);
    video.addEventListener('ended', ended);
    video.addEventListener('error', failed);
    video.addEventListener('pause', paused);
    canvas.addEventListener('webglcontextlost', contextLost);
    canvas.addEventListener('webglcontextrestored', contextRestored);
    prepare();
    return () => {
      disposed = true;
      requested = false;
      run += 1;
      controllerRef.current = null;
      window.clearTimeout(resetTimer);
      cancelFrame();
      video.removeEventListener('loadeddata', prepare);
      video.removeEventListener('seeked', prepare);
      video.removeEventListener('ended', ended);
      video.removeEventListener('error', failed);
      video.removeEventListener('pause', paused);
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', contextRestored);
      video.pause();
      renderer?.dispose();
    };
  }, [url]);

  useEffect(() => {
    if (playing) controllerRef.current?.start();
    else controllerRef.current?.stop();
  }, [playing, url]);

  return (
    <span className={`home-figure__greeting${visibleUrl === url ? ' home-figure__greeting--active' : ''}`}>
      {posterUrl ? (
        <img className="home-figure__poster" src={posterUrl} alt="我的形象" draggable={false} />
      ) : (
        <canvas ref={posterRef} className="home-figure__poster" width={432} height={576} aria-hidden="true" />
      )}
      <canvas ref={canvasRef} className="home-figure__canvas" width={432} height={576} aria-hidden="true" />
      <video
        ref={videoRef}
        className="home-figure__hidden-video"
        src={url}
        muted
        playsInline
        disablePictureInPicture
        preload="auto"
        tabIndex={-1}
        aria-hidden="true"
      />
    </span>
  );
}
