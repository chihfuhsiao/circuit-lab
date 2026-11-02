// 電路圖符號。座標是元件本地的像素，未旋轉時兩腳元件的腳在 (±40, 0)。

import { Led, Meter } from '../engine/analog';
import { Chip } from '../engine/digital';
import { Device } from '../engine/sim';
import { CompDef, getDef, LED_COLORS } from '../circuit/catalog';
import { formatValue } from '../circuit/format';
import { Comp } from '../circuit/types';
import { FONT, G, INK } from './common';

export interface SymCtx {
  g: CanvasRenderingContext2D;
  comp: Comp;
  def: CompDef;
  rot: number;
  /** 腳的導線顏色（依電壓）。 */
  lead: (pin: number) => string;
  /** 腳的電壓。 */
  volt: (pin: number) => number;
  dev?: Device;
  live: boolean;
}

function pinXY(s: SymCtx, pin: number): [number, number] {
  const [x, y] = s.def.pins[pin].sch;
  return [x * G, y * G];
}

/** 從腳畫一條線到 (x, y)，用該腳的顏色。 */
function lead(s: SymCtx, pin: number, x: number, y: number): void {
  const { g } = s;
  const [px, py] = pinXY(s, pin);
  g.strokeStyle = s.lead(pin);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(px, py);
  g.lineTo(x, y);
  g.stroke();
  g.strokeStyle = INK;
}

/** 不隨元件旋轉的文字。 */
function text(s: SymCtx, str: string, x: number, y: number, size = 11, align: CanvasTextAlign = 'center', color = INK, weight = ''): void {
  const { g } = s;
  g.save();
  g.translate(x, y);
  g.rotate((-s.rot * Math.PI) / 2);
  g.fillStyle = color;
  g.font = `${weight} ${size}px ${FONT}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(str, 0, 0);
  g.restore();
}

function path(g: CanvasRenderingContext2D, pts: [number, number][], close = false): void {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  if (close) g.closePath();
}

function zigzag(g: CanvasRenderingContext2D, x0: number, x1: number, amp = 7): void {
  const n = 6;
  const step = (x1 - x0) / n;
  g.beginPath();
  g.moveTo(x0, 0);
  for (let i = 0; i < n; i++) g.lineTo(x0 + step * (i + 0.5), i % 2 ? amp : -amp);
  g.lineTo(x1, 0);
  g.stroke();
}

function diodeBody(s: SymCtx, x0: number, x1: number): void {
  const { g } = s;
  path(g, [[x0, -10], [x1, 0], [x0, 10]], true);
  g.fillStyle = INK;
  g.fill();
  g.beginPath();
  g.moveTo(x1, -10);
  g.lineTo(x1, 10);
  g.stroke();
}

function waveGlyph(g: CanvasRenderingContext2D, wave: string, r: number): void {
  g.beginPath();
  if (wave === 'square') {
    path(g, [[-r, 3], [-r, -5], [0, -5], [0, 5], [r, 5], [r, -3]]);
  } else if (wave === 'triangle') {
    path(g, [[-r, 0], [-r / 2, -6], [r / 2, 6], [r, 0]]);
  } else {
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const x = -r + 2 * r * t;
      const y = -6 * Math.sin(t * Math.PI * 2);
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
  }
  g.stroke();
}

function box(s: SymCtx, hw: number, hh: number, title?: string): void {
  const { g } = s;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.rect(-hw, -hh, hw * 2, hh * 2);
  g.fill();
  g.stroke();
  if (title) text(s, title, 0, 0, 11, 'center', INK, '600');
}

/** 方塊元件的腳：畫短線與腳名。 */
function boxPins(s: SymCtx, hw: number): void {
  s.def.pins.forEach((pin, i) => {
    const [x, y] = pinXY(s, i);
    lead(s, i, x > 0 ? hw : -hw, y);
    text(s, pin.name, x > 0 ? hw - 4 : -hw + 4, y, 10, x > 0 ? 'right' : 'left');
  });
}

type GateShape = 'and' | 'or' | 'not' | 'xor';

function gateBody(s: SymCtx, shape: GateShape, invert: boolean): void {
  const { g } = s;
  g.fillStyle = '#ffffff';
  const inputs = s.def.pins.length - 1;
  const outX = invert ? 30 : 34;
  // 輸入與輸出引線
  if (inputs === 1) {
    lead(s, 0, -24, 0);
  } else {
    const inner = shape === 'and' ? -24 : shape === 'xor' ? -20 : -20;
    lead(s, 0, inner, -20);
    lead(s, 1, inner, 20);
  }
  lead(s, inputs, invert ? 38 : outX, 0);

  if (shape === 'and') {
    g.beginPath();
    g.moveTo(-24, -30);
    g.lineTo(4, -30);
    g.arc(4, 0, 30, -Math.PI / 2, Math.PI / 2);
    g.lineTo(-24, 30);
    g.closePath();
    g.fill();
    g.stroke();
  } else if (shape === 'not') {
    path(g, [[-24, -24], [28, 0], [-24, 24]], true);
    g.fill();
    g.stroke();
  } else {
    g.beginPath();
    g.moveTo(-28, -30);
    g.quadraticCurveTo(-12, 0, -28, 30);
    g.quadraticCurveTo(14, 30, 34, 0);
    g.quadraticCurveTo(14, -30, -28, -30);
    g.closePath();
    g.fill();
    g.stroke();
    if (shape === 'xor') {
      g.beginPath();
      g.moveTo(-36, -30);
      g.quadraticCurveTo(-20, 0, -36, 30);
      g.stroke();
    }
  }
  if (invert) {
    const bx = shape === 'not' ? 33 : 34 + 0;
    g.beginPath();
    g.arc(bx, 0, 5, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
    g.stroke();
  }
}

const SYMBOLS: Record<string, (s: SymCtx) => void> = {
  res(s) {
    lead(s, 0, -24, 0);
    lead(s, 1, 24, 0);
    zigzag(s.g, -24, 24);
  },
  pot(s) {
    const { g } = s;
    lead(s, 0, -24, 0);
    lead(s, 1, 24, 0);
    zigzag(g, -24, 24);
    const pos = Number(s.comp.params.pos);
    const ax = -20 + 40 * pos;
    g.strokeStyle = s.lead(2);
    g.lineWidth = 2;
    path(g, [[0, -40], [0, -22], [ax, -22], [ax, -11]]);
    g.stroke();
    path(g, [[ax - 4, -14], [ax, -8], [ax + 4, -14]], true);
    g.fillStyle = s.lead(2);
    g.fill();
  },
  cap(s) {
    const { g } = s;
    lead(s, 0, -4, 0);
    lead(s, 1, 4, 0);
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(-4, -13);
    g.lineTo(-4, 13);
    g.stroke();
    g.beginPath();
    if (s.comp.params.polar === true) {
      g.moveTo(9, -13);
      g.quadraticCurveTo(2, 0, 9, 13);
      text(s, '+', -14, -12, 12, 'center', INK, '700');
    } else {
      g.moveTo(4, -13);
      g.lineTo(4, 13);
    }
    g.stroke();
  },
  ind(s) {
    const { g } = s;
    lead(s, 0, -24, 0);
    lead(s, 1, 24, 0);
    g.beginPath();
    for (let i = 0; i < 4; i++) g.arc(-18 + i * 12, 0, 6, Math.PI, 0);
    g.stroke();
  },
  dc(s) {
    const { g } = s;
    lead(s, 0, -5, 0);
    lead(s, 1, 5, 0);
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(-5, -16);
    g.lineTo(-5, 16);
    g.stroke();
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(5, -8);
    g.lineTo(5, 8);
    g.stroke();
    text(s, '+', -16, -12, 13, 'center', INK, '700');
  },
  ac(s) {
    const { g } = s;
    lead(s, 0, -20, 0);
    lead(s, 1, 20, 0);
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(0, 0, 20, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.save();
    g.rotate((-s.rot * Math.PI) / 2);
    waveGlyph(g, String(s.comp.params.wave), 12);
    g.restore();
  },
  isrc(s) {
    const { g } = s;
    lead(s, 0, -20, 0);
    lead(s, 1, 20, 0);
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(0, 0, 20, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    path(g, [[-11, 0], [9, 0]]);
    g.stroke();
    path(g, [[11, 0], [3, -6], [3, 6]], true);
    g.fillStyle = INK;
    g.fill();
  },
  gnd(s) {
    const { g } = s;
    g.strokeStyle = s.lead(0);
    g.lineWidth = 2;
    path(g, [[0, 0], [0, 10]]);
    g.stroke();
    g.strokeStyle = INK;
    for (const [y, hw] of [[10, 12], [15, 7.5], [20, 3]] as const) {
      path(g, [[-hw, y], [hw, y]]);
      g.stroke();
    }
  },
  rail(s) {
    const { g } = s;
    g.strokeStyle = s.lead(0);
    g.lineWidth = 2;
    path(g, [[0, 0], [0, -12]]);
    g.stroke();
    g.lineWidth = 2.4;
    path(g, [[-11, -12], [11, -12]]);
    g.stroke();
  },
  lamp(s) {
    const { g } = s;
    lead(s, 0, -16, 0);
    lead(s, 1, 16, 0);
    if (s.live && s.dev) {
      const i = s.dev.currents[0];
      const p = i * i * Number(s.comp.params.R);
      const b = Math.min(1, p / Number(s.comp.params.Pfull));
      if (b > 0.01) {
        const grad = g.createRadialGradient(0, 0, 4, 0, 0, 34);
        grad.addColorStop(0, `rgba(255,214,70,${0.9 * b})`);
        grad.addColorStop(1, 'rgba(255,214,70,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0, 0, 34, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.beginPath();
    g.arc(0, 0, 16, 0, Math.PI * 2);
    g.stroke();
    path(g, [[-11, -11], [11, 11]]);
    g.stroke();
    path(g, [[-11, 11], [11, -11]]);
    g.stroke();
  },
  diode(s) {
    lead(s, 0, -10, 0);
    lead(s, 1, 10, 0);
    diodeBody(s, -10, 10);
  },
  zener(s) {
    const { g } = s;
    lead(s, 0, -10, 0);
    lead(s, 1, 10, 0);
    path(g, [[-10, -10], [10, 0], [-10, 10]], true);
    g.fillStyle = INK;
    g.fill();
    path(g, [[5, -13], [10, -10], [10, 10], [15, 13]]);
    g.stroke();
  },
  led(s) {
    const { g } = s;
    const color = (LED_COLORS[String(s.comp.params.color)] ?? LED_COLORS.red).color;
    const led = s.dev instanceof Led ? s.dev : null;
    const b = s.live && led ? led.brightness : 0;
    if (b > 0.01) {
      const grad = g.createRadialGradient(0, 0, 3, 0, 0, 36);
      grad.addColorStop(0, color);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.globalAlpha = Math.min(1, 0.25 + b);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, 36, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }
    lead(s, 0, -10, 0);
    lead(s, 1, 10, 0);
    path(g, [[-10, -10], [10, 0], [-10, 10]], true);
    g.fillStyle = b > 0.01 ? color : '#fff';
    g.fill();
    g.stroke();
    path(g, [[10, -10], [10, 10]]);
    g.stroke();
    if (led?.burned) {
      g.strokeStyle = '#c92a2a';
      g.lineWidth = 3;
      path(g, [[-14, -14], [14, 14]]);
      g.stroke();
      path(g, [[-14, 14], [14, -14]]);
      g.stroke();
    } else {
      g.lineWidth = 1.4;
      for (const dx of [0, 7]) {
        path(g, [[dx - 3, -13], [dx + 5, -22]]);
        g.stroke();
        path(g, [[dx + 5, -22], [dx + 1, -21], [dx + 4, -18]], true);
        g.fillStyle = INK;
        g.fill();
      }
    }
  },
  npn: (s) => bjt(s, true),
  pnp: (s) => bjt(s, false),
  nmos: (s) => mos(s, true),
  pmos: (s) => mos(s, false),
  opamp(s) {
    const { g } = s;
    lead(s, 0, -30, -20);
    lead(s, 1, -30, 20);
    lead(s, 2, 34, 0);
    lead(s, 3, 0, -19);
    lead(s, 4, 0, 19);
    path(g, [[-30, -36], [34, 0], [-30, 36]], true);
    g.fillStyle = '#fff';
    g.fill();
    g.stroke();
    text(s, '−', -22, -20, 14, 'center', INK, '700');
    text(s, '+', -22, 20, 14, 'center', INK, '700');
  },
  sw(s) {
    const { g } = s;
    lead(s, 0, -18, 0);
    lead(s, 1, 18, 0);
    const closed = s.comp.params.closed === true;
    g.fillStyle = '#fff';
    for (const x of [-16, 16]) {
      g.beginPath();
      g.arc(x, 0, 3.2, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.lineWidth = 2.4;
    path(g, closed ? [[-14, -1], [14, -1]] : [[-14, -2], [12, -15]]);
    g.stroke();
  },
  push(s) {
    const { g } = s;
    lead(s, 0, -18, 0);
    lead(s, 1, 18, 0);
    const closed = s.comp.params.closed === true;
    g.fillStyle = '#fff';
    for (const x of [-16, 16]) {
      g.beginPath();
      g.arc(x, 0, 3.2, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    const y = closed ? -4 : -11;
    g.lineWidth = 2.4;
    path(g, [[-16, y], [16, y]]);
    g.stroke();
    g.lineWidth = 2;
    path(g, [[0, y], [0, y - 9]]);
    g.stroke();
  },
  meter(s) {
    const { g } = s;
    lead(s, 0, -24, 0);
    lead(s, 1, 24, 0);
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(0, 0, 24, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    const mode = String(s.comp.params.mode);
    const unit = mode === 'dcv' || mode === 'acv' ? 'V' : mode === 'ohm' ? 'Ω' : 'A';
    text(s, unit, 0, -5, 17, 'center', INK, '700');
    if (s.live && s.dev instanceof Meter) {
      const r = s.dev.reading;
      const str = r === Infinity ? 'OL' : formatValue(Math.abs(r) < 1e-6 ? 0 : r, '', 3);
      text(s, str, 0, 10, 10, 'center', '#0b7285', '600');
    }
    text(s, '+', -32, -10, 12, 'center', '#c92a2a', '700');
  },
  and: (s) => gateBody(s, 'and', false),
  or: (s) => gateBody(s, 'or', false),
  not: (s) => gateBody(s, 'not', true),
  nand: (s) => gateBody(s, 'and', true),
  nor: (s) => gateBody(s, 'or', true),
  xor: (s) => gateBody(s, 'xor', false),
  xnor: (s) => gateBody(s, 'xor', true),
  lin(s) {
    const { g } = s;
    lead(s, 0, 22, 0);
    const high = s.comp.params.high === true;
    g.fillStyle = high ? '#d94841' : '#e6e6df';
    g.beginPath();
    g.roundRect(-30, -15, 52, 30, 6);
    g.fill();
    g.stroke();
    text(s, high ? '1' : '0', -4, 0, 18, 'center', high ? '#fff' : INK, '700');
  },
  lout(s) {
    const { g } = s;
    lead(s, 0, -18, 0);
    const high = s.live && s.volt(0) > 1.5;
    g.fillStyle = high ? '#d94841' : '#e6e6df';
    g.beginPath();
    g.arc(2, 0, 20, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    text(s, high ? '1' : '0', 2, 0, 18, 'center', high ? '#fff' : INK, '700');
  },
  clock(s) {
    const { g } = s;
    lead(s, 0, 22, 0);
    g.fillStyle = '#fff';
    g.beginPath();
    g.roundRect(-30, -15, 52, 30, 6);
    g.fill();
    g.stroke();
    g.save();
    g.translate(-4, 0);
    g.rotate((-s.rot * Math.PI) / 2);
    path(g, [[-16, 6], [-8, 6], [-8, -6], [0, -6], [0, 6], [8, 6], [8, -6], [16, -6]]);
    g.stroke();
    g.restore();
  },
  dff(s) {
    box(s, 44, 36);
    boxPins(s, 44);
  },
  jkff(s) {
    box(s, 44, 52);
    boxPins(s, 44);
  },
  cnt4(s) {
    box(s, 44, 76, 'CNT');
    boxPins(s, 44);
  },
  hex7(s) {
    box(s, 44, 76);
    s.def.pins.forEach((pin, i) => {
      const [x, y] = pinXY(s, i);
      lead(s, i, -44, y);
      text(s, pin.name, -40, y, 9, 'left');
    });
    const chip = s.dev instanceof Chip ? s.dev : null;
    const levels = s.live && chip ? chip.levels : [false, false, false, false];
    const n = levels.reduce((acc, on, i) => acc + (on ? 1 << i : 0), 0);
    drawHexDigit(s.g, 12, 0, n);
  },
};

function bjt(s: SymCtx, isNpn: boolean): void {
  const { g } = s;
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(4, 0, 27, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  lead(s, 0, -7, 0);
  g.lineWidth = 3;
  path(g, [[-7, -15], [-7, 15]]);
  g.stroke();
  g.lineWidth = 2;
  g.strokeStyle = s.lead(1);
  path(g, [[-7, -7], [20, -22], [20, -40]]);
  g.stroke();
  g.strokeStyle = s.lead(2);
  path(g, [[-7, 7], [20, 22], [20, 40]]);
  g.stroke();
  g.strokeStyle = INK;
  g.fillStyle = INK;
  // 射極箭頭：NPN 向外、PNP 向內
  const [bx, by, ex, ey] = isNpn ? [2, 12, 13, 18] : [13, 18, 3, 12.5];
  const a = Math.atan2(ey - by, ex - bx);
  const hx = ex;
  const hy = ey;
  path(g, [[hx, hy], [hx - 9 * Math.cos(a - 0.45), hy - 9 * Math.sin(a - 0.45)], [hx - 9 * Math.cos(a + 0.45), hy - 9 * Math.sin(a + 0.45)]], true);
  g.fill();
  const pins: [string, number, number][] = [
    ['B', -22, -10],
    ['C', 29, -30],
    ['E', 29, 30],
  ];
  for (const [t, x, y] of pins) text(s, t, x, y, 10, 'center', '#5b6672');
}

function mos(s: SymCtx, isN: boolean): void {
  const { g } = s;
  const gateEnd = isN ? -11 : -17;
  lead(s, 0, gateEnd, 0);
  if (!isN) {
    g.beginPath();
    g.arc(-14, 0, 3, 0, Math.PI * 2);
    g.stroke();
  }
  g.lineWidth = 2.4;
  path(g, [[-11, -14], [-11, 14]]);
  g.stroke();
  path(g, [[-5, -16], [-5, -6]]);
  g.stroke();
  path(g, [[-5, -3], [-5, 3]]);
  g.stroke();
  path(g, [[-5, 6], [-5, 16]]);
  g.stroke();
  g.lineWidth = 2;
  g.strokeStyle = s.lead(1);
  path(g, [[-5, -11], [20, -11], [20, -40]]);
  g.stroke();
  g.strokeStyle = s.lead(2);
  path(g, [[-5, 11], [20, 11], [20, 40]]);
  g.stroke();
  g.strokeStyle = INK;
  path(g, [[-5, 0], [20, 0], [20, 11]]);
  g.stroke();
  g.fillStyle = INK;
  const tri: [number, number][] = isN ? [[-4, 0], [4, -4], [4, 4]] : [[8, 0], [0, -4], [0, 4]];
  path(g, tri, true);
  g.fill();
  const pins: [string, number, number][] = [
    ['G', -24, -10],
    ['D', 29, -30],
    ['S', 29, 30],
  ];
  for (const [t, x, y] of pins) text(s, t, x, y, 10, 'center', '#5b6672');
}

const HEX_SEGS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71];

export function drawHexDigit(g: CanvasRenderingContext2D, cx: number, cy: number, n: number, color = '#e03131'): void {
  drawSegments(g, cx, cy, HEX_SEGS[n & 15], color);
}

/** bits：位元 0..6 = a..g。 */
export function drawSegments(g: CanvasRenderingContext2D, cx: number, cy: number, bits: number, color = '#e03131', w = 13, h = 20): void {
  const segs: [number, number, number, number][] = [
    [-w, -h, w, -h],
    [w, -h, w, 0],
    [w, 0, w, h],
    [-w, h, w, h],
    [-w, 0, -w, h],
    [-w, -h, -w, 0],
    [-w, 0, w, 0],
  ];
  g.lineCap = 'round';
  g.lineWidth = 4.5;
  segs.forEach(([x0, y0, x1, y1], i) => {
    g.strokeStyle = bits & (1 << i) ? color : 'rgba(120,120,120,0.18)';
    g.beginPath();
    g.moveTo(cx + x0, cy + y0);
    g.lineTo(cx + x1, cy + y1);
    g.stroke();
  });
  g.lineCap = 'butt';
  g.strokeStyle = INK;
}

/** IC 方塊：畫腳號與腳名。 */
function dipSymbol(s: SymCtx): void {
  const hw = 4 * G;
  const half = s.def.pins[0].dip !== undefined ? s.def.sch!.hh * G : s.def.sch!.hh * G;
  const { g } = s;
  g.fillStyle = '#fff';
  g.beginPath();
  g.rect(-hw, -half, hw * 2, half * 2);
  g.fill();
  g.stroke();
  g.beginPath();
  g.arc(0, -half, 7, 0, Math.PI);
  g.stroke();
  s.def.pins.forEach((pin, i) => {
    const [x, y] = pinXY(s, i);
    lead(s, i, x > 0 ? hw : -hw, y);
    if (pin.dip !== undefined) {
      text(s, String(pin.dip), x > 0 ? hw + 10 : -hw - 10, y - 7, 9, 'center', '#5b6672');
    }
    text(s, pin.name, x > 0 ? hw - 5 : -hw + 5, y, 10, x > 0 ? 'right' : 'left');
  });
  text(s, s.def.name.split(' ')[0], 0, 0, 12, 'center', INK, '700');
  if (s.comp.type === 'seg7' && s.dev && s.live) {
    // 七段顯示器：依各段 LED 亮度顯示
    const parts = (s.dev as unknown as { parts: Led[] }).parts;
    let bits = 0;
    parts.slice(0, 7).forEach((p, i) => {
      if (p.brightness > 0.05) bits |= 1 << i;
    });
    drawSegments(g, 0, -40, bits);
  }
}

export interface DrawSymbolOpts {
  lead: (pin: number) => string;
  volt: (pin: number) => number;
  dev?: Device;
  live: boolean;
}

/** 依元件的位置與旋轉畫出符號（不含代號文字）。 */
export function drawSymbol(g: CanvasRenderingContext2D, comp: Comp, opts: DrawSymbolOpts, x = comp.sch!.x * G, y = comp.sch!.y * G, rot = comp.sch!.rot): void {
  const def = getDef(comp.type);
  g.save();
  g.translate(x, y);
  g.rotate((rot * Math.PI) / 2);
  g.strokeStyle = INK;
  g.fillStyle = INK;
  g.lineWidth = 2;
  g.lineJoin = 'round';
  const s: SymCtx = { g, comp, def, rot, lead: opts.lead, volt: opts.volt, dev: opts.dev, live: opts.live };
  const fn = SYMBOLS[comp.type];
  if (fn) fn(s);
  else dipSymbol(s);
  g.restore();
}

/** 元件庫的小圖示。 */
export function drawIcon(canvas: HTMLCanvasElement, comp: Comp): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 44;
  const h = canvas.clientHeight || 32;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);
  const def = getDef(comp.type);
  const hw = (def.sch?.hw ?? 2) * G + 4;
  const hh = (def.sch?.hh ?? 1) * G + 6;
  const rot = 0;
  const scale = Math.min(w / (hw * 2), h / (hh * 2), 0.62);
  g.translate(w / 2, h / 2);
  g.scale(scale, scale);
  drawSymbol(g, comp, { lead: () => INK, volt: () => 0, live: false }, 0, comp.type === 'gnd' ? -8 : comp.type === 'rail' ? 8 : 0, rot);
}

/** 代號與數值文字的位置（畫在元件外側，不隨元件旋轉）。 */
export function labelAnchor(comp: Comp): { x: number; y: number; align: CanvasTextAlign } {
  const def = getDef(comp.type);
  const place = comp.sch!;
  const sch = def.sch!;
  const vertical = place.rot % 2 === 1;
  const hw = (vertical ? sch.hh : sch.hw) * G;
  const hh = (vertical ? sch.hw : sch.hh) * G;
  const cx = place.x * G;
  const cy = place.y * G;
  if (comp.type === 'gnd') return { x: cx + 14, y: cy + 16, align: 'left' };
  if (comp.type === 'rail') return { x: cx, y: place.rot === 2 ? cy + 26 : cy - 26, align: 'center' };
  // 運算放大器的上下是電源腳，代號放在右上角才不會和電源重疊。
  if (comp.type === 'opamp' && !vertical) return { x: cx + 18, y: cy - 30, align: 'left' };
  if (vertical) return { x: cx + hw + 6, y: cy - 7, align: 'left' };
  return { x: cx, y: cy - hh - 10, align: 'center' };
}
