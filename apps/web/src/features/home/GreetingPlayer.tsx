import { useEffect, useRef } from 'react';

/**
 * 彩色 + 蒙版的打招呼视频。
 * 常态只画第一帧（和首页形象完全一致），点击后播放，播完回到第一帧。
 * WebGL 上下文只创建一次，支持反复点击。
 */
export function GreetingPlayer({
  url,
  playing,
  onFinished,
}: {
  url: string;
  playing: boolean;
  onFinished: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const drawRef = useRef<() => void>(() => undefined);
  const startRef = useRef<() => void>(() => undefined);
  const stopRef = useRef<() => void>(() => undefined);
  const playingRef = useRef(false);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
    });
    if (!gl) {
      onFinishedRef.current();
      return;
    }

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    const vs = compile(
      gl.VERTEX_SHADER,
      'attribute vec2 p; varying vec2 v; void main(){ v=p*0.5+0.5; gl_Position=vec4(p,0.0,1.0); }',
    );
    const fs = compile(
      gl.FRAGMENT_SHADER,
      `precision mediump float; varying vec2 v; uniform sampler2D t;
       void main(){ vec4 c=texture2D(t, vec2(v.x*0.5, v.y));
       float m=texture2D(t, vec2(0.5+v.x*0.5, v.y)).r;
       gl_FragColor=vec4(c.rgb*m, m); }`,
    );
    const program = gl.createProgram();
    if (!vs || !fs || !program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    let raf = 0;

    const draw = () => {
      if (video.readyState < 2 || !video.videoWidth) return;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (raf) return;
      // 等第一帧解码完成再开始覆盖画布，避免点击瞬间闪一下
      window.setTimeout(() => {
        if (!playingRef.current || raf) return;
        raf = requestAnimationFrame(loop);
      }, 120);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const ended = () => {
      stop();
      video.pause();
      try {
        video.currentTime = 0;
      } catch {
        /* ignore */
      }
      draw();
      onFinishedRef.current();
    };

    drawRef.current = draw;
    startRef.current = start;
    stopRef.current = stop;

    video.addEventListener('ended', ended);

    const prepare = () => {
      draw();
      if (playingRef.current) return;
      // 让浏览器先解出一帧，再回到首帧静止
      void video
        .play()
        .then(() => {
          window.setTimeout(() => {
            if (playingRef.current) return;
            video.pause();
            try {
              video.currentTime = 0;
            } catch {
              /* ignore */
            }
            draw();
          }, 150);
        })
        .catch(() => undefined);
    };

    if (video.readyState >= 2) prepare();
    else video.addEventListener('loadeddata', prepare, { once: true });

    return () => {
      stop();
      video.removeEventListener('ended', ended);
      video.removeEventListener('loadeddata', prepare);
      video.pause();
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      // 已经停在 0 秒时不要再 seek，seek 会短暂出现黑帧
      if (video.currentTime > 0.05) {
        try {
          video.currentTime = 0;
        } catch {
          /* ignore */
        }
      }
      void video
        .play()
        .then(() => startRef.current())
        .catch(() => onFinishedRef.current());
    } else {
      stopRef.current();
      video.pause();
      try {
        video.currentTime = 0;
      } catch {
        /* ignore */
      }
      drawRef.current();
    }
  }, [playing]);

  return (
    <>
      <canvas ref={canvasRef} className="home-figure__canvas" width={432} height={576} />
      <video
        ref={videoRef}
        className="home-figure__hidden-video"
        src={url}
        muted
        playsInline
        preload="auto"
      />
    </>
  );
}
