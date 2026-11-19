export interface GreetingRenderer {
  /** Preserve the last good pixels until a complete decoded frame is ready. */
  draw(video: HTMLVideoElement): boolean;
  dispose(): void;
}

/** Decode left colour / right luminance-mask video into transparent pixels. */
export function createGreetingRenderer(canvas: HTMLCanvasElement): GreetingRenderer | null {
  const gl = canvas.getContext('webgl', {
    alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true,
    antialias: false, depth: false, stencil: false,
  });
  if (!gl) return null;
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Cannot create greeting shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      throw new Error('Cannot compile greeting shader');
    }
    return shader;
  };
  const vs = compile(gl.VERTEX_SHADER,
    'attribute vec2 p; varying vec2 v; void main(){ v=p*0.5+0.5; gl_Position=vec4(p,0.0,1.0); }');
  const fs = compile(gl.FRAGMENT_SHADER,
    `precision mediump float; varying vec2 v; uniform sampler2D t;
     void main(){ vec4 c=texture2D(t,vec2(v.x*0.5,v.y));
     float m=texture2D(t,vec2(0.5+v.x*0.5,v.y)).r;
     gl_FragColor=vec4(c.rgb*m,m); }`);
  const program = gl.createProgram();
  if (!program) { gl.deleteShader(vs); gl.deleteShader(fs); return null; }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program); gl.deleteShader(vs); gl.deleteShader(fs);
    return null;
  }
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
  gl.uniform1i(gl.getUniformLocation(program, 't'), 0);
  gl.viewport(0, 0, canvas.width, canvas.height);
  return {
    draw(video) {
      if (video.seeking || video.readyState < video.HAVE_CURRENT_DATA || !video.videoWidth || gl.isContextLost()) return false;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      if (gl.getError() !== gl.NO_ERROR) return false;
      // This quad replaces every pixel, including alpha. Never clear the
      // visible canvas while a mobile decoder is seeking or buffering.
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return gl.getError() === gl.NO_ERROR;
    },
    dispose() {
      gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program);
      gl.deleteShader(vs); gl.deleteShader(fs);
    },
  };
}
