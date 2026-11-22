// Real WebGL2 GLSL ES 3.00 Optical Prism Backdrop Engine
// Renders chromatic dispersion caustics, concentric specular glass refraction rings,
// volumetric bokeh particles, diagonal light sweeps, and Dark Obsidian <-> Light Frost Nord morphing.
// Includes an optical Canvas2D fallback if WebGL2 is unavailable.

const VERT_SRC = `#version 300 es
precision highp float;
const vec2 POS[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2( 3.0, -1.0),
  vec2(-1.0,  3.0)
);
out vec2 vUv;
void main() {
  vec2 p = POS[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2 uRes;
uniform float uTime;
uniform float uRms;
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform float uBurst;
uniform float uSweep;
uniform float uLightMode;
uniform vec3 uAccent;
uniform vec2 uCam;
uniform float uZoom;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.52;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = rot * p * 2.04 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

// Caustic silk ribbon field
float causticField(vec2 p, float t) {
  vec2 q = vec2(
    fbm(p * 1.45 + vec2(t * 0.14, -t * 0.09)),
    fbm(p * 1.45 + vec2(-t * 0.11 + 4.2, t * 0.12 + 1.8))
  );
  float n = fbm(p * 2.1 + q * 2.35 + vec2(0.0, t * 0.08));
  float ridge = 1.0 - abs(n * 2.0 - 1.0);
  return pow(clamp(ridge, 0.0, 1.0), 4.2);
}

// Refracting glass ring with RGB chromatic dispersion
vec3 glassRing(vec2 p, vec2 center, float radius, float thickness, float disp, float t, float energy) {
  vec2 d = p - center;
  float dist = length(d);
  float ang = atan(d.y, d.x);

  float shimmer = 0.58 + 0.42 * sin(ang * 3.0 - t * 1.35 + radius * 4.0)
                + 0.25 * cos(ang * 5.0 + t * 0.85);
  shimmer = clamp(shimmer, 0.18, 1.35);

  float rDist = abs(dist - (radius - disp));
  float gDist = abs(dist - radius);
  float bDist = abs(dist - (radius + disp));

  float rCore = exp(-pow(rDist / thickness, 2.0));
  float gCore = exp(-pow(gDist / thickness, 2.0));
  float bCore = exp(-pow(bDist / thickness, 2.0));

  // Soft outer Fresnel halo
  float halo = exp(-abs(dist - radius) * 9.5) * 0.28;

  vec3 spec = vec3(rCore, gCore, bCore) * shimmer;
  // Blend prism cyan / violet / emerald spectral tint
  vec3 prismTint = vec3(0.45, 0.68, 1.0) * 0.55
                 + vec3(0.72, 0.52, 0.98) * 0.35
                 + vec3(0.32, 0.84, 0.68) * 0.20;
  return (spec * (0.72 + 0.65 * energy) + halo * prismTint) * (0.55 + 0.45 * shimmer);
}

// Procedural bokeh orbs
vec3 bokehLayer(vec2 p, float t, float scale, float seed, float treble) {
  vec2 gv = p * scale;
  vec2 id = floor(gv);
  vec2 uv = fract(gv) - 0.5;
  vec3 col = vec3(0.0);

  for (int oy = -1; oy <= 1; oy++) {
    for (int ox = -1; ox <= 1; ox++) {
      vec2 cid = id + vec2(float(ox), float(oy));
      float h = hash21(cid + seed);
      if (h < 0.72) continue;
      float h2 = hash21(cid * 1.37 + seed + 19.1);
      float h3 = hash21(cid * 2.13 + seed + 7.7);

      vec2 offs = vec2(
        sin(t * (0.28 + h2 * 0.35) + h * 6.2831) * 0.34,
        cos(t * (0.22 + h3 * 0.30) + h2 * 6.2831) * 0.34
      );
      float rad = mix(0.035, 0.13, h3) * (1.0 + treble * 0.22);
      float d = length(uv - vec2(float(ox), float(oy)) - offs);

      // Soft aperture disc with subtle bright rim
      float disc = smoothstep(rad, rad * 0.45, d);
      float rim = smoothstep(rad, rad * 0.86, d) * smoothstep(rad * 0.55, rad * 0.92, d);
      float twinkle = 0.55 + 0.45 * sin(t * (1.8 + h2 * 2.4) + h * 12.0);
      vec3 tint = mix(vec3(0.42, 0.66, 1.0), vec3(0.76, 0.56, 0.98), h2);
      tint = mix(tint, vec3(0.35, 0.88, 0.70), smoothstep(0.65, 1.0, h3));
      col += tint * (disc * 0.24 + rim * 0.32) * twinkle;
    }
  }
  return col;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 aspect = vec2(uRes.x / uRes.y, 1.0);
  vec2 p = (vUv - 0.5) * aspect;

  // Apply subtle camera parallax & zoom
  vec2 pCam = (p - uCam * 0.16) / max(0.6, uZoom);
  float t = uTime;

  // 1. Adaptive Dark Obsidian <-> Light Frost Nord base gradient
  vec3 darkBaseTop = vec3(0.028, 0.036, 0.068);
  vec3 darkBaseBot = vec3(0.052, 0.056, 0.095);
  vec3 darkGlow = mix(vec3(0.06, 0.12, 0.24), uAccent * 0.32, 0.45);

  vec3 lightBaseTop = vec3(0.89, 0.925, 0.968);
  vec3 lightBaseBot = vec3(0.945, 0.965, 0.992);
  vec3 lightGlow = mix(vec3(0.72, 0.84, 0.95), uAccent * 0.65 + 0.32, 0.4);

  vec3 bgDark = mix(darkBaseBot, darkBaseTop, smoothstep(-0.55, 0.55, p.y));
  bgDark += darkGlow * exp(-dot(pCam * vec2(0.8, 1.15), pCam * vec2(0.8, 1.15)) * 1.45);

  vec3 bgLight = mix(lightBaseBot, lightBaseTop, smoothstep(-0.55, 0.55, p.y));
  bgLight = mix(bgLight, lightGlow, exp(-dot(pCam, pCam) * 1.3) * 0.35);

  vec3 col = mix(bgDark, bgLight, uLightMode);

  // 2. Chromatic Dispersion Caustics (RGB shifted)
  float dispAmt = 0.014 + uBass * 0.018 + uBeat * 0.022 + uBurst * 0.045;
  vec2 dispDir = normalize(pCam + vec2(0.0001, 0.0002));
  float cR = causticField(pCam + dispDir * dispAmt, t);
  float cG = causticField(pCam, t);
  float cB = causticField(pCam - dispDir * dispAmt, t);

  vec3 causticDark = vec3(
    cR * 0.55 + cG * 0.20,
    cG * 0.58 + cB * 0.24,
    cB * 0.95 + cR * 0.25
  ) * mix(vec3(0.45, 0.68, 1.0), uAccent + vec3(0.25, 0.18, 0.35), 0.48);

  vec3 causticLight = vec3(
    cR * 0.35 + cG * 0.18,
    cG * 0.55 + cB * 0.35,
    cB * 0.85 + cR * 0.20
  ) * vec3(0.32, 0.56, 0.82);

  float causticStrength = 0.34 + uRms * 0.48 + uBeat * 0.25;
  col += mix(causticDark * causticStrength, -causticLight * (0.14 + uRms * 0.12) + causticLight * 0.22, uLightMode);

  // 3. Concentric Specular Glass Refraction Rings (Obsidian Prism signature)
  float beatExp = uBeat * 0.055 + uBass * 0.032;
  vec2 c1 = vec2(-0.32 + sin(t * 0.27) * 0.09, 0.12 + cos(t * 0.23) * 0.07);
  vec2 c2 = vec2( 0.38 + cos(t * 0.21) * 0.08, -0.14 + sin(t * 0.29) * 0.08);
  vec2 c3 = vec2( 0.02 + sin(t * 0.17) * 0.06,  0.02 + cos(t * 0.19) * 0.05);

  vec3 rings = vec3(0.0);
  rings += glassRing(pCam, c1, 0.46 + beatExp, 0.0085, 0.0065 + uBeat * 0.008, t, uRms + uBass * 0.5) * 0.55;
  rings += glassRing(pCam, c2, 0.58 + beatExp * 1.25, 0.010, 0.0075 + uBeat * 0.009, -t * 0.85, uRms + uTreble * 0.5) * 0.48;
  rings += glassRing(pCam, c3, 0.82 + beatExp * 1.4, 0.006, 0.0055 + uBurst * 0.015, t * 0.65, uRms + uBeat * 0.6) * 0.42;

  // Burst shockwave ring (Act 1 shatter & climax hits)
  if (uBurst > 0.001) {
    float shockR = mix(0.08, 1.35, 1.0 - uBurst);
    rings += glassRing(pCam, vec2(0.0), shockR, 0.024, 0.018, t * 3.0, 1.6) * uBurst * 1.85;
  }

  col += mix(rings * 0.68, rings * 0.32 * vec3(0.42, 0.66, 0.92), uLightMode);

  // 4. Diagonal Prismatic Light Beams (Optical god-rays)
  float diag = pCam.x * 0.72 + pCam.y * 0.69;
  float beam1 = exp(-pow((diag + 0.35 - sin(t * 0.22) * 0.18) * 3.8, 2.0));
  float beam2 = exp(-pow((diag - 0.42 + cos(t * 0.18) * 0.14) * 4.5, 2.0));
  vec3 beamCol = vec3(0.40, 0.64, 1.0) * beam1 * 0.16
               + vec3(0.68, 0.50, 0.98) * beam2 * 0.13;
  col += mix(beamCol * (0.85 + uRms * 0.65), beamCol * 0.35, uLightMode);

  // 5. Transition Chromatic Sweep Wipe (uSweep in 0..1)
  if (uSweep > 0.001 && uSweep < 0.999) {
    float sweepPos = mix(-1.45, 1.45, uSweep);
    float dSweep = diag - sweepPos;
    float env = sin(uSweep * 3.14159265);
    float sR = exp(-pow((dSweep - 0.032) * 14.0, 2.0));
    float sG = exp(-pow((dSweep) * 16.0, 2.0));
    float sB = exp(-pow((dSweep + 0.032) * 14.0, 2.0));
    col += vec3(sR * 0.95, sG * 1.0, sB * 1.15) * env * 0.58;
  }

  // 6. Volumetric Bokeh & Starlight Motes
  vec3 bokeh = bokehLayer(pCam + vec2(t * 0.018, -t * 0.012), t, 3.2, 11.3, uTreble) * 0.75
             + bokehLayer(pCam * 1.4 - vec2(t * 0.012, t * 0.015), t * 1.2, 5.6, 47.9, uTreble) * 0.55;
  col += mix(bokeh * (0.62 + uTreble * 0.65), bokeh * 0.28 * vec3(0.35, 0.60, 0.92), uLightMode);

  // 7. Subtle vignette + 8-bit anti-banding film dither
  float vig = smoothstep(1.38, 0.28, length(p * vec2(0.82, 0.95)));
  col *= mix(mix(0.64, 1.02, vig), mix(0.92, 1.0, vig), uLightMode);

  // Soft filmic tone curve
  col = col / (1.0 + col * mix(0.28, 0.06, uLightMode));
  float dither = (hash21(frag + fract(t) * 97.3) - 0.5) / 255.0;
  fragColor = vec4(clamp(col + dither, 0.0, 1.0), 1.0);
}
`;

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`WebGL2 shader compile error: ${log}`);
  }
  return sh;
}

export class PrismWebGL {
  constructor(canvas) {
    this.canvas = canvas;
    this.width = canvas.width || 1920;
    this.height = canvas.height || 1080;
    this.mode = 'none';
    this.gl = null;
    this.ctx2d = null;
    this.uniforms = {};
    this._init();
  }

  _init() {
    try {
      const gl = this.canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      });
      if (gl) {
        const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
        const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
          throw new Error(gl.getProgramInfoLog(prog) || 'Program link failed');
        }
        this.gl = gl;
        this.prog = prog;
        this.vao = gl.createVertexArray();
        const names = [
          'uRes', 'uTime', 'uRms', 'uBass', 'uTreble', 'uBeat',
          'uBurst', 'uSweep', 'uLightMode', 'uAccent', 'uCam', 'uZoom',
        ];
        for (const n of names) {
          this.uniforms[n] = gl.getUniformLocation(prog, n);
        }
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        this.renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        this.mode = 'webgl2';
        return;
      }
    } catch (err) {
      console.warn('[PrismWebGL] WebGL2 init failed, using Canvas2D optical fallback:', err.message);
    }
    this.ctx2d = this.canvas.getContext('2d');
    this.mode = 'canvas2d';
    this.renderer = 'Canvas2D Optical Fallback';
  }

  render(state) {
    const {
      time = 0,
      rms = 0.25,
      bass = 0.25,
      treble = 0.25,
      beat = 0,
      burst = 0,
      sweep = 0,
      lightMode = 0,
      accent = [0.40, 0.62, 0.96],
      camX = 0,
      camY = 0,
      zoom = 1,
    } = state || {};

    if (this.mode === 'webgl2' && this.gl) {
      const gl = this.gl;
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(this.prog);
      gl.bindVertexArray(this.vao);
      gl.uniform2f(this.uniforms.uRes, this.width, this.height);
      gl.uniform1f(this.uniforms.uTime, time);
      gl.uniform1f(this.uniforms.uRms, rms);
      gl.uniform1f(this.uniforms.uBass, bass);
      gl.uniform1f(this.uniforms.uTreble, treble);
      gl.uniform1f(this.uniforms.uBeat, beat);
      gl.uniform1f(this.uniforms.uBurst, burst);
      gl.uniform1f(this.uniforms.uSweep, sweep);
      gl.uniform1f(this.uniforms.uLightMode, lightMode);
      gl.uniform3f(this.uniforms.uAccent, accent[0], accent[1], accent[2]);
      gl.uniform2f(this.uniforms.uCam, camX, camY);
      gl.uniform1f(this.uniforms.uZoom, zoom);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return;
    }

    // Optical Canvas2D fallback (only used if WebGL2 unavailable)
    const ctx = this.ctx2d;
    if (!ctx) return;
    const w = this.width;
    const h = this.height;
    const g = ctx.createLinearGradient(0, 0, w, h);
    if (lightMode > 0.5) {
      g.addColorStop(0, '#e4ecf7');
      g.addColorStop(1, '#f3f7fc');
    } else {
      g.addColorStop(0, '#070912');
      g.addColorStop(0.5, '#0c1122');
      g.addColorStop(1, '#090b15');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const drawRing = (cx, cy, r, color) => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3 + beat * 4;
      ctx.stroke();
      ctx.restore();
    };
    drawRing(w * 0.34 + Math.sin(time * 0.3) * 60, h * 0.42, 340 + bass * 40, 'rgba(102,157,246,0.34)');
    drawRing(w * 0.68 + Math.cos(time * 0.25) * 60, h * 0.58, 420 + treble * 36, 'rgba(165,138,248,0.28)');
    if (burst > 0.01) {
      drawRing(w * 0.5, h * 0.5, (1 - burst) * 1100, `rgba(190,225,255,${(burst * 0.85).toFixed(3)})`);
    }
  }
}
