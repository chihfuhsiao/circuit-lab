// 畫面共用：格點大小、攝影機、電壓配色、電流動畫。

export const G = 20;
export const FONT = '"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", system-ui, sans-serif';

export const INK = '#20262e';
export const INK_SOFT = '#5b6672';
export const SELECT = '#0b7285';
export const CANVAS_BG = '#fbfaf6';
export const GRID_DOT = '#d9d6cc';
export const ERROR = '#c92a2a';

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
  const base = [92, 102, 114];
  const hi = t >= 0 ? [214, 40, 40] : [28, 100, 214];
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
  color = '#e8a400',
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

/** 螢幕座標的提示框。 */
export function drawTooltip(g: CanvasRenderingContext2D, lines: string[], sx: number, sy: number, w: number, h: number): void {
  if (!lines.length) return;
  g.font = `13px ${FONT}`;
  const tw = Math.max(...lines.map((l) => g.measureText(l).width));
  const bw = tw + 16;
  const bh = lines.length * 18 + 10;
  let x = sx + 14;
  let y = sy + 16;
  if (x + bw > w - 4) x = sx - bw - 10;
  if (y + bh > h - 4) y = sy - bh - 10;
  g.fillStyle = 'rgba(32,38,46,0.94)';
  g.beginPath();
  g.roundRect(x, y, bw, bh, 5);
  g.fill();
  g.fillStyle = '#f4f4ef';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, x + 8, y + 14 + i * 18));
}

/** 小標籤（節點電壓）。 */
export function drawPill(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  g.font = `600 10.5px ${FONT}`;
  const w = g.measureText(text).width + 8;
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.strokeStyle = color;
  g.lineWidth = 1;
  g.beginPath();
  g.roundRect(x - w / 2, y - 7.5, w, 15, 4);
  g.fill();
  g.stroke();
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, y + 0.5);
}
