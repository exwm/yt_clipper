export let prevGammaVal = 1;

export function setPrevGammaVal(gammaVal: number) {
  prevGammaVal = gammaVal;
}

export type WebGLGammaRenderer = {
  outputCanvas: HTMLCanvasElement;
  render: (sourceCanvas: HTMLCanvasElement, gamma: number) => void;
  destroy: () => void;
};

const VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

in vec2 a_position;
out vec2 v_uv;

void main() {
  // Map NDC [-1, 1] -> UV [0, 1] for texture sampling.
  v_uv = 0.5 * (a_position + 1.0);
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// Gamma convention: exponent applied directly (not 1/gamma), matching
// FFmpeg's lutyuv=y=gammaval(gamma) — gamma > 1 darkens, gamma < 1 brightens.
//
// Per-channel (not luma-only) to avoid saturation artifacts: canvas pixels
// from ctx.drawImage are sRGB-encoded, so Rec.709 linear-light luma
// coefficients would be inaccurate. Scaling all channels by the same factor
// preserves their ratios (no hue or saturation shift).
const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_gamma;

out vec4 outColor;

void main() {
  vec4 color = texture(u_texture, v_uv);

  // Clamp base to 1e-6 to guard against pow(0, very_small_gamma) edge cases.
  // Alpha is passed through unchanged.
  outColor = vec4(pow(max(color.rgb, vec3(1e-6)), vec3(u_gamma)), color.a);
}
`;

// Fullscreen triangle: three vertices that extend past the clip boundary.
// The rasterizer clips to the viewport, so every on-screen fragment is covered
// by a single draw call. The interpolated UVs within NDC [-1,1]x[-1,1] fall
// correctly in [0,1]x[0,1]; CLAMP_TO_EDGE handles the out-of-range vertices
// at (3,-1) and (-1,3) but those positions are never actually sampled.
const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 3, -1, -1, 3]);

function createShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? 'Unknown shader compile error';
    gl.deleteShader(shader);
    throw new Error(info);
  }

  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string
): WebGLProgram {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error('Failed to create program');
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  // Shaders are no longer needed after linking.
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) ?? 'Unknown program link error';
    gl.deleteProgram(program);
    throw new Error(info);
  }

  return program;
}

export function createWebGLGammaRenderer(sourceCanvas: HTMLCanvasElement): WebGLGammaRenderer {
  const outputCanvas = document.createElement('canvas');
  outputCanvas.id = 'ytc-zoom-canvas-webgl';

  outputCanvas.width = sourceCanvas.width;
  outputCanvas.height = sourceCanvas.height;

  const gl = outputCanvas.getContext('webgl2', {
    // Required so the DOM compositor can read the finished frame;
    // without this the buffer may be cleared after compositing.
    preserveDrawingBuffer: true,
    // Source pixels have straight (non-premultiplied) alpha. Disabling
    // premultipliedAlpha prevents the driver from modifying RGB on upload.
    premultipliedAlpha: false,
  });

  if (!gl) throw new Error('WebGL 2 not supported');

  const program = createProgram(gl, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);

  // The VAO records the vertex buffer binding and attribute layout set up
  // below. Rebinding it in render() restores all of that state in one call.
  const vao = gl.createVertexArray();
  if (!vao) {
    gl.deleteProgram(program);
    throw new Error('Failed to create VAO');
  }

  const buffer = gl.createBuffer();
  if (!buffer) {
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
    throw new Error('Failed to create buffer');
  }

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLE, gl.STATIC_DRAW);

  const aPosition = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

  // Unbind VAO before unbinding the buffer so the VAO doesn't capture a null
  // ARRAY_BUFFER — the VAO stores the buffer reference, not the binding slot.
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  const texture = gl.createTexture();
  if (!texture) {
    gl.deleteBuffer(buffer);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
    throw new Error('Failed to create texture');
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);
  // CLAMP_TO_EDGE prevents border-colour bleed at the triangle edges that
  // extend past the viewport (vertices at (3,-1) and (-1,3)).
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.bindTexture(gl.TEXTURE_2D, null);

  // getUniformLocation returns null if the name is absent or was optimized
  // away by the driver. Both uniforms are actively used in the shader so
  // they will be present after a successful link; this is a safety guard.
  const uTexture = gl.getUniformLocation(program, 'u_texture');
  const uGamma = gl.getUniformLocation(program, 'u_gamma');

  if (!uTexture || !uGamma) {
    gl.deleteTexture(texture);
    gl.deleteBuffer(buffer);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
    throw new Error('Missing required uniform(s)');
  }

  function render(sourceCanvas: HTMLCanvasElement, gamma: number): void {
    // Assigning canvas dimensions resets the drawing buffer (clears it).
    // The viewport call and full-screen draw immediately after cover this.
    outputCanvas.style.width = sourceCanvas.style.width;
    outputCanvas.style.height = sourceCanvas.style.height;
    outputCanvas.width = sourceCanvas.width;
    outputCanvas.height = sourceCanvas.height;

    gl.viewport(0, 0, outputCanvas.width, outputCanvas.height);
    gl.useProgram(program);
    gl.bindVertexArray(vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // Canvas (0,0) is top-left; WebGL texture V=0 is bottom. Flipping on
    // upload corrects the orientation so the image appears right-side up.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);

    gl.uniform1i(uTexture, 0); // texture unit 0
    // Floor gamma at 1e-6 so pow(x, gamma) never degenerates to 1 for all x.
    gl.uniform1f(uGamma, Math.max(gamma, 1e-6));

    // No gl.clear() needed — the fullscreen triangle writes every pixel.
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  function destroy(): void {
    gl.deleteTexture(texture);
    gl.deleteBuffer(buffer);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);

    // Explicitly release GPU resources rather than waiting for GC.
    const loseContext = gl.getExtension('WEBGL_lose_context');
    if (loseContext) loseContext.loseContext();

    if (outputCanvas.parentNode) outputCanvas.parentNode.removeChild(outputCanvas);
  }

  return { outputCanvas, render, destroy };
}
