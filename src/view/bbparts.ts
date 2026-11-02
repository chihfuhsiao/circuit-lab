// 元件在麵包板上的實體外觀。座標單位是像素，孔距 = G。

import { Led, Meter } from '../engine/analog';
import { Composite } from '../engine/digital';
import { Device } from '../engine/sim';
import { dipHole, holePos, rowY } from '../circuit/breadboard';
import { getDef, LED_COLORS } from '../circuit/catalog';
import { formatValue, resistorBands } from '../circuit/format';
import { bbPinTarget } from '../circuit/topology';
import { Comp } from '../circuit/types';
import { FONT, G, INK } from './common';
import { drawSegments } from './symbols';

const LEAD = '#9aa3ad';

function holeXY(id: string): [number, number] {
  const p = holePos(id);
  return p ? [p[0] * G, p[1] * G] : [0, 0];
}

function leadLine(g: CanvasRenderingContext2D, a: [number, number], b: [number, number]): void {
  g.strokeStyle = LEAD;
  g.lineWidth = 2.4;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.stroke();
  g.fillStyle = '#7d8691';
  for (const p of [a, b]) {
    g.beginPath();
    g.arc(p[0], p[1], 2.8, 0, Math.PI * 2);
    g.fill();
  }
}

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, color = INK, size = 10, weight = '600'): void {
  g.font = `${weight} ${size}px ${FONT}`;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, y);
}

/** 在兩腳連線上畫本體；body 的座標原點在中點、x 軸沿著連線。 */
function alongLeads(g: CanvasRenderingContext2D, a: [number, number], b: [number, number], body: () => void, upright = false): void {
  g.save();
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  let angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  // 本體上有文字時不能上下顛倒。
  if (upright && Math.abs(angle) > Math.PI / 2) angle += Math.PI;
  g.rotate(angle);
  body();
  g.restore();
}

function drawTwoLead(g: CanvasRenderingContext2D, c: Comp, dev: Device | undefined, live: boolean): void {
  const holes = c.bb?.holes;
  if (!holes) return;
  const a = holeXY(holes[0]);
  const b = holeXY(holes[1]);
  leadLine(g, a, b);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  switch (c.type) {
    case 'res':
      alongLeads(g, a, b, () => {
        const w = Math.min(30, Math.max(14, len - 8));
        g.fillStyle = '#d9b77e';
        g.strokeStyle = '#8d7144';
        g.lineWidth = 1;
        g.beginPath();
        g.roundRect(-w / 2, -5.5, w, 11, 4);
        g.fill();
        g.stroke();
        const bands = resistorBands(Number(c.params.R));
        const xs = [-w * 0.32, -w * 0.14, w * 0.04, w * 0.33];
        bands.forEach((band, i) => {
          g.fillStyle = band.color;
          g.fillRect(xs[i] - 1.5, -5.5, 3, 11);
        });
      });
      break;
    case 'ind':
      alongLeads(g, a, b, () => {
        g.fillStyle = '#4f8f5b';
        g.strokeStyle = '#2f5f3a';
        g.lineWidth = 1;
        g.beginPath();
        g.roundRect(-13, -5.5, 26, 11, 5);
        g.fill();
        g.stroke();
        g.fillStyle = '#d7d7cf';
        for (const x of [-7, -2, 3, 8]) g.fillRect(x - 1, -5.5, 2, 11);
      });
      break;
    case 'cap': {
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      if (c.params.polar === true) {
        g.fillStyle = '#26324a';
        g.strokeStyle = '#121826';
        g.lineWidth = 1;
        g.beginPath();
        g.arc(mx, my, 12, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        // 負極標記
        const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
        g.fillStyle = '#c9d2e0';
        g.beginPath();
        g.arc(mx, my, 12, angle - 0.8, angle + 0.8);
        g.closePath();
        g.fill();
        g.fillStyle = '#26324a';
        g.font = `700 11px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('−', mx + Math.cos(angle) * 7.5, my + Math.sin(angle) * 7.5);
      } else {
        g.fillStyle = '#d98b3a';
        g.strokeStyle = '#9c5f22';
        g.lineWidth = 1;
        g.beginPath();
        g.arc(mx, my, 9, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
      break;
    }
    case 'diode':
    case 'zener':
      alongLeads(g, a, b, () => {
        g.fillStyle = c.type === 'zener' ? '#c9742c' : '#1e1e22';
        g.beginPath();
        g.roundRect(-10, -4.5, 20, 9, 2.5);
        g.fill();
        g.fillStyle = c.type === 'zener' ? '#1e1e22' : '#d7d7d7';
        g.fillRect(5, -4.5, 3, 9);
      });
      break;
    case 'led': {
      const color = (LED_COLORS[String(c.params.color)] ?? LED_COLORS.red).color;
      const led = dev instanceof Led ? dev : null;
      const bright = live && led ? led.brightness : 0;
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      if (bright > 0.01) {
        const grad = g.createRadialGradient(mx, my, 3, mx, my, 34);
        grad.addColorStop(0, color);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.globalAlpha = Math.min(1, 0.3 + bright);
        g.fillStyle = grad;
        g.beginPath();
        g.arc(mx, my, 34, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      }
      g.fillStyle = led?.burned ? '#3a3a3a' : color;
      g.globalAlpha = led?.burned || bright > 0.01 ? 1 : 0.65;
      g.beginPath();
      g.arc(mx, my, 9.5, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = 'rgba(0,0,0,0.45)';
      g.lineWidth = 1;
      g.stroke();
      if (!led?.burned) {
        g.fillStyle = 'rgba(255,255,255,0.55)';
        g.beginPath();
        g.arc(mx - 3, my - 3, 2.6, 0, Math.PI * 2);
        g.fill();
      }
      // 長腳（陽極）標記
      label(g, '+', a[0] + (a[0] <= b[0] ? -1 : 1), a[1] - 10, '#c92a2a', 11, '700');
      break;
    }
    case 'lamp': {
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const i = dev?.currents[0] ?? 0;
      const bright = live ? Math.min(1, (i * i * Number(c.params.R)) / Number(c.params.Pfull)) : 0;
      if (bright > 0.01) {
        const grad = g.createRadialGradient(mx, my, 4, mx, my, 34);
        grad.addColorStop(0, `rgba(255,214,70,${0.95 * bright})`);
        grad.addColorStop(1, 'rgba(255,214,70,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(mx, my, 34, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = 'rgba(240,240,225,0.9)';
      g.strokeStyle = '#8a8a7a';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(mx, my, 12, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      break;
    }
    case 'sw':
      alongLeads(g, a, b, () => {
        const closed = c.params.closed === true;
        g.fillStyle = '#2b5fa8';
        g.beginPath();
        g.roundRect(-18, -8, 36, 16, 2);
        g.fill();
        g.fillStyle = '#dfe6ef';
        g.fillRect(closed ? 1 : -15, -5, 14, 10);
        label(g, closed ? 'ON' : 'OFF', closed ? -9 : 9, 0, '#fff', 8);
      }, true);
      break;
    case 'push':
      alongLeads(g, a, b, () => {
        const closed = c.params.closed === true;
        g.fillStyle = '#2c2c30';
        g.beginPath();
        g.roundRect(-10, -10, 20, 20, 2);
        g.fill();
        g.fillStyle = closed ? '#d94841' : '#8a8f96';
        g.beginPath();
        g.arc(0, 0, 6, 0, Math.PI * 2);
        g.fill();
      });
      break;
  }
}

function drawInline(g: CanvasRenderingContext2D, c: Comp): void {
  const def = getDef(c.type);
  const foot = def.bb!;
  if (foot.kind !== 'inline') return;
  const targets = def.pins.map((_, i) => bbPinTarget(c, i)!);
  const pts = targets.map(holeXY);
  const xs = pts.map((p) => p[0]);
  const y = pts[0][1];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const cx = (minX + maxX) / 2;
  g.fillStyle = '#7d8691';
  for (const p of pts) {
    g.beginPath();
    g.arc(p[0], p[1], 2.8, 0, Math.PI * 2);
    g.fill();
  }
  if (c.type === 'pot') {
    g.fillStyle = '#2b5fa8';
    g.beginPath();
    g.roundRect(minX - 9, y - 26, maxX - minX + 18, 30, 3);
    g.fill();
    g.fillStyle = '#e9eef4';
    g.beginPath();
    g.arc(cx, y - 12, 10, 0, Math.PI * 2);
    g.fill();
    const a = -Math.PI * 1.25 + Number(c.params.pos) * Math.PI * 1.5;
    g.strokeStyle = '#2b5fa8';
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(cx, y - 12);
    g.lineTo(cx + Math.cos(a) * 8, y - 12 + Math.sin(a) * 8);
    g.stroke();
  } else {
    g.fillStyle = '#26262b';
    g.beginPath();
    g.moveTo(minX - 8, y - 4);
    g.lineTo(maxX + 8, y - 4);
    g.lineTo(maxX + 8, y - 12);
    g.quadraticCurveTo(cx, y - 32, minX - 8, y - 12);
    g.closePath();
    g.fill();
    label(g, c.type.toUpperCase().replace('NMOS', 'N-MOS').replace('PMOS', 'P-MOS'), cx, y - 12, '#e9e9e4', 8);
  }
  // 腳名
  def.pins.forEach((pin, i) => {
    if (c.type === 'pot') return;
    label(g, pin.name, pts[i][0], y + 10, '#20262e', 9);
  });
}

function drawDip(g: CanvasRenderingContext2D, c: Comp, dev: Device | undefined, live: boolean): void {
  const def = getDef(c.type);
  const foot = def.bb!;
  if (foot.kind !== 'dip' || c.bb?.col === undefined) return;
  const col = c.bb.col;
  const half = foot.numPins / 2;
  const x0 = col * G - 8;
  const x1 = (col + half - 1) * G + 8;
  const isSeg = c.type === 'seg7';
  const y0 = rowY('e') * G + (isSeg ? -44 : 3);
  const y1 = rowY('f') * G + (isSeg ? 44 : -3);
  // 腳
  g.fillStyle = '#b4bbc4';
  for (let k = 1; k <= foot.numPins; k++) {
    const [hx, hy] = holeXY(dipHole(col, foot.numPins, k));
    g.fillRect(hx - 3, hy - 3, 6, 6);
  }
  g.fillStyle = isSeg ? '#46474c' : '#2a2a2f';
  g.strokeStyle = '#111';
  g.lineWidth = 1;
  g.beginPath();
  g.roundRect(x0, y0, x1 - x0, y1 - y0, 3);
  g.fill();
  g.stroke();
  const midY = (y0 + y1) / 2;
  if (isSeg) {
    let bits = 0;
    if (live && dev instanceof Composite) {
      dev.parts.slice(0, 7).forEach((p, i) => {
        if ((p as Led).brightness > 0.05) bits |= 1 << i;
      });
    }
    const color = (LED_COLORS[String(c.params.color)] ?? LED_COLORS.red).color;
    drawSegments(g, (x0 + x1) / 2, midY, bits, color, 18, 26);
    g.strokeStyle = INK;
    return;
  }
  // 缺口與第 1 腳標記
  g.fillStyle = '#16161a';
  g.beginPath();
  g.arc(x0, midY, 6, -Math.PI / 2, Math.PI / 2);
  g.fill();
  g.fillStyle = '#d7d7d7';
  g.beginPath();
  g.arc(x0 + 7, y1 - 7, 2, 0, Math.PI * 2);
  g.fill();
  label(g, def.name.split(' ')[0], (x0 + x1) / 2, midY, '#e9e9e4', half >= 7 ? 12 : 10, '700');
}

function drawBench(g: CanvasRenderingContext2D, c: Comp, dev: Device | undefined, live: boolean): void {
  const foot = getDef(c.type).bb!;
  if (foot.kind !== 'bench' || c.bb?.x === undefined) return;
  const x = c.bb.x * G;
  const y = c.bb.y! * G;
  const w = foot.w * G;
  const h = foot.h * G;
  const panel = c.type === 'meter' ? '#f1c232' : c.type === 'ac' ? '#3f5f7f' : '#59636e';
  g.fillStyle = panel;
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = 1;
  g.beginPath();
  g.roundRect(x, y, w, h, 6);
  g.fill();
  g.stroke();

  const textColor = c.type === 'meter' ? '#20262e' : '#f4f4ef';
  label(g, c.type === 'dc' ? '電源供應器' : c.type === 'ac' ? '訊號產生器' : '三用電錶', x + w / 2, y + 11, textColor, 10);

  // 顯示幕
  g.fillStyle = '#10201a';
  g.beginPath();
  g.roundRect(x + 8, y + 20, w - 16, 26, 3);
  g.fill();
  let lcd = '';
  if (c.type === 'dc') lcd = `${Number(c.params.V).toFixed(2)} V`;
  else if (c.type === 'ac') lcd = `${formatValue(Number(c.params.amp), 'V')} ${formatValue(Number(c.params.freq), 'Hz')}`;
  else if (dev instanceof Meter && live) {
    const r = dev.reading;
    const mode = dev.mode;
    const unit = mode === 'ohm' ? 'Ω' : mode === 'dca' || mode === 'aca' ? 'A' : 'V';
    lcd = r === Infinity ? 'OL' : formatValue(r, unit);
  } else lcd = '---';
  label(g, lcd, x + w / 2, y + 33, '#7cf0a8', c.type === 'ac' ? 11 : 13, '700');

  // 端子
  foot.terms.forEach(([dx, dy], i) => {
    const tx = x + dx * G;
    const ty = y + dy * G;
    g.fillStyle = i === 0 ? '#d3232a' : '#17171a';
    g.strokeStyle = '#fff';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(tx, ty, 6.5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    const name = c.type === 'dc' ? (i === 0 ? '+' : '−') : c.type === 'meter' ? (i === 0 ? '紅' : '黑') : i === 0 ? '輸出' : '共同';
    label(g, name, tx, ty - 13, textColor, 10, '700');
  });
}

export function drawPart(g: CanvasRenderingContext2D, c: Comp, dev: Device | undefined, live: boolean): void {
  const foot = getDef(c.type).bb;
  if (!foot || !c.bb) return;
  switch (foot.kind) {
    case 'twoLead':
      drawTwoLead(g, c, dev, live);
      break;
    case 'inline':
      drawInline(g, c);
      break;
    case 'dip':
      drawDip(g, c, dev, live);
      break;
    case 'bench':
      drawBench(g, c, dev, live);
      break;
  }
}

/** 元件本體的外框（像素），用來點選、畫選取框、放代號。 */
export function partBounds(c: Comp): { x0: number; y0: number; x1: number; y1: number } | null {
  const foot = getDef(c.type).bb;
  if (!foot || !c.bb) return null;
  switch (foot.kind) {
    case 'twoLead': {
      const holes = c.bb.holes;
      if (!holes) return null;
      const a = holeXY(holes[0]);
      const b = holeXY(holes[1]);
      return { x0: Math.min(a[0], b[0]) - 8, y0: Math.min(a[1], b[1]) - 12, x1: Math.max(a[0], b[0]) + 8, y1: Math.max(a[1], b[1]) + 12 };
    }
    case 'inline': {
      const def = getDef(c.type);
      const pts = def.pins.map((_, i) => holeXY(bbPinTarget(c, i)!));
      const xs = pts.map((p) => p[0]);
      const y = pts[0][1];
      return { x0: Math.min(...xs) - 10, y0: y - 30, x1: Math.max(...xs) + 10, y1: y + 14 };
    }
    case 'dip': {
      const col = c.bb.col!;
      const half = foot.numPins / 2;
      const seg = c.type === 'seg7';
      return {
        x0: col * G - 10,
        y0: rowY('e') * G + (seg ? -46 : 0),
        x1: (col + half - 1) * G + 10,
        y1: rowY('f') * G + (seg ? 46 : 0),
      };
    }
    case 'bench': {
      const x = c.bb.x! * G;
      const y = c.bb.y! * G;
      return { x0: x, y0: y, x1: x + foot.w * G, y1: y + foot.h * G };
    }
  }
}
