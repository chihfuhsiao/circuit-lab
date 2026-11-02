// 畫面共用：格點大小、攝影機、配色主題、電流動畫。

export const G = 20;
export const FONT = '"Segoe UI", "Microsoft JhengHei UI", "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", system-ui, sans-serif';
export const MONO = '"Cascadia Mono", Consolas, "SF Mono", Menlo, monospace';

export type ThemeName = 'dark' | 'light';

const PALETTES = {
  dark: {
    ink: '#dfe4ec',
    inkSoft: '#98a2b1',
    select: '#35c2e4',
    canvas: '#13161b',
    gridDot: '#2b313b',
    gridMajor: '#414a58',
    paper: '#1b1f27',
    paper2: '#2c323d',
    error: '#ff6b6b',
    bench: '#0f1216',
    benchDot: '#1b2027',
    dot: '#ffc93c',
    tipBg: 'rgba(9,11,14,0.97)',
    tipLine: '#414a58',
    tipInk: '#eef1f5',
    pillBg: 'rgba(19,22,27,0.94)',
    vBase: [150, 160, 174],
    vHigh: [255, 92, 92],
    vLow: [86, 156, 255],
  },
  light: {
    ink: '#1f2733',
    inkSoft: '#5b6672',
    select: '#0b7d9e',
    canvas: '#fcfcfd',
    gridDot: '#d8dde5',
    gridMajor: '#b4bcc9',
    paper: '#ffffff',
    paper2: '#e6e9ee',
    error: '#c92a2a',
    bench: '#dfe3e9',
    benchDot: '#cdd2da',
    dot: '#e8a400',
    tipBg: 'rgba(28,34,43,0.97)',
    tipLine: '#1c222b',
    tipInk: '#f4f6f8',
    pillBg: 'rgba(255,255,255,0.95)',
    vBase: [92, 102, 114],
    vHigh: [214, 40, 40],
    vLow: [28, 100, 214],
  },
};

// 用 export let：切換主題後，所有繪圖程式下一幀就會讀到新顏色。
export let INK = PALETTES.dark.ink;
export let INK_SOFT = PALETTES.dark.inkSoft;
export let SELECT = PALETTES.dark.select;
export let CANVAS_BG = PALETTES.dark.canvas;
export let GRID_DOT = PALETTES.dark.gridDot;
export let GRID_MAJOR = PALETTES.dark.gridMajor;
export let PAPER = PALETTES.dark.paper;
export let PAPER_2 = PALETTES.dark.paper2;
export let ERROR = PALETTES.dark.error;
export let BENCH = PALETTES.dark.bench;
export let BENCH_DOT = PALETTES.dark.benchDot;
export let DOT_COLOR = PALETTES.dark.dot;
let palette = PALETTES.dark;

export function setCanvasTheme(name: ThemeName): void {
  palette = PALETTES[name];
  INK = palette.ink;
  INK_SOFT = palette.inkSoft;
  SELECT = palette.select;
  CANVAS_BG = palette.canvas;
  GRID_DOT = palette.gridDot;
  GRID_MAJOR = palette.gridMajor;
  PAPER = palette.paper;
  PAPER_2 = palette.paper2;
  ERROR = palette.error;
  BENCH = palette.bench;
  BENCH_DOT = palette.benchDot;
  DOT_COLOR = palette.dot;
}

/** #rrggbb 加上透明度。 */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface PointerInfo {
  sx: number;
  sy: number;
  wx: number;
  wy: number;
  button: number;
  shift: boolean;
  ctrl: boolean;
  touch: boolean;
}

export interface EditorView {
  cam: Camera;
  draw(g: CanvasRenderingContext2D, w: number, h: number, dpr: number): void;
  pointerDown(p: PointerInfo): void;
  pointerMove(p: PointerInfo): void;
  pointerUp(p: PointerInfo): void;
  pointerLeave(): void;
  keyDown(e: KeyboardEvent): boolean;
  beginPlace(type: string): void;
  cancel(): void;
  fit(w: number, h: number): void;
  cursor(): string;
}

/** 依電壓給顏色：正電壓偏紅、負電壓偏藍、0V 為灰。 */
export function voltColor(v: number, vmax: number): string {
  const t = Math.max(-1, Math.min(1, v / Math.max(vmax, 1e-6)));
  const a = Math.abs(t);
  const base = palette.vBase;
  const hi = t >= 0 ? palette.vHigh : palette.vLow;
  const c = base.map((b, i) => Math.round(b + (hi[i] - b) * a));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** 電流對應的動畫速度（像素／秒）。用對數，µA 和 A 都看得出來。 */
export function dotSpeed(i: number): number {
  const a = Math.abs(i);
  if (a < 1e-6) return 0;
  const s = Math.max(6, Math.min(150, 30 * Math.log10(a / 1e-5) + 10));
  return i > 0 ? s : -s;
}

export const DOT_SPACING = 16;

export function drawDotsOnLine(
  g: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  phase: number,
  color = DOT_COLOR,
): void {
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 1) return;
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  let d = ((phase % DOT_SPACING) + DOT_SPACING) % DOT_SPACING;
  g.fillStyle = color;
  for (; d < len; d += DOT_SPACING) {
    g.beginPath();
    g.arc(ax + ux * d, ay + uy * d, 2.1, 0, Math.PI * 2);
    g.fill();
  }
}

export function fitCamera(cam: Camera, minX: number, minY: number, maxX: number, maxY: number, w: number, h: number, maxZoom = 1.6): void {
  const pad = 50;
  const zoom = Math.min((w - pad * 2) / Math.max(maxX - minX, 1), (h - pad * 2) / Math.max(maxY - minY, 1), maxZoom);
  cam.zoom = Math.max(0.2, zoom);
  cam.x = w / 2 - ((minX + maxX) / 2) * cam.zoom;
  cam.y = h / 2 - ((minY + maxY) / 2) * cam.zoom;
}

export function zoomAt(cam: Camera, sx: number, sy: number, factor: number): void {
  const z = Math.max(0.2, Math.min(4, cam.zoom * factor));
  const f = z / cam.zoom;
  cam.x = sx - (sx - cam.x) * f;
  cam.y = sy - (sy - cam.y) * f;
  cam.zoom = z;
}

/** 選取或出錯的元件：淡色底加四角括號。 */
export function drawSelectBox(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  g.fillStyle = alpha(color, 0.1);
  g.strokeStyle = alpha(color, 0.45);
  g.lineWidth = 1;
  g.beginPath();
  g.roundRect(x, y, w, h, 3);
  g.fill();
  g.stroke();
  const c = Math.min(8, w / 3, h / 3);
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.lineCap = 'square';
  g.beginPath();
  for (const [cx, cy, dx, dy] of [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ]) {
    g.moveTo(cx + dx * c, cy);
    g.lineTo(cx, cy);
    g.lineTo(cx, cy + dy * c);
  }
  g.stroke();
  g.lineCap = 'butt';
}

/** 螢幕座標的提示框。 */
export function drawTooltip(g: CanvasRenderingContext2D, lines: string[], sx: number, sy: number, w: number, h: number): void {
  if (!lines.length) return;
  const heading = lines.length > 1;
  const fontOf = (i: number) => (heading && i === 0 ? `600 12.5px ${FONT}` : `12.5px ${FONT}`);
  let tw = 0;
  lines.forEach((l, i) => {
    g.font = fontOf(i);
    tw = Math.max(tw, g.measureText(l).width);
  });
  const bw = tw + 20;
  const bh = lines.length * 18 + 12;
  let x = sx + 14;
  let y = sy + 16;
  if (x + bw > w - 4) x = sx - bw - 10;
  if (y + bh > h - 4) y = sy - bh - 10;
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.35)';
  g.shadowBlur = 12;
  g.shadowOffsetY = 3;
  g.fillStyle = palette.tipBg;
  g.beginPath();
  g.roundRect(x, y, bw, bh, 6);
  g.fill();
  g.restore();
  g.strokeStyle = palette.tipLine;
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = palette.tipInk;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => {
    g.font = fontOf(i);
    g.fillText(l, x + 10, y + 15 + i * 18);
  });
}

/** 小標籤（節點電壓）。 */
export function drawPill(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  g.font = `600 10.5px ${MONO}`;
  const w = g.measureText(text).width + 9;
  g.fillStyle = palette.pillBg;
  g.strokeStyle = color;
  g.lineWidth = 1;
  g.beginPath();
  g.roundRect(x - w / 2, y - 7.5, w, 15, 3);
  g.fill();
  g.stroke();
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, y + 0.5);
}
