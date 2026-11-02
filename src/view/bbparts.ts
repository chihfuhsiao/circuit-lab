// 元件在麵包板上的實體外觀。座標單位是像素，孔距 = G。
// 麵包板本身是白色的，不隨主題變化，所以這裡的顏色都是固定值。

import { Led, Meter } from '../engine/analog';
import { Composite } from '../engine/digital';
import { Device } from '../engine/sim';
import { dipHole, holePos, rowY } from '../circuit/breadboard';
import { getDef, LED_COLORS } from '../circuit/catalog';
import { formatValue, resistorBands } from '../circuit/format';
import { bbPinTarget } from '../circuit/topology';
import { Comp } from '../circuit/types';
import { alpha, FONT, G, MONO } from './common';
import { drawSegments } from './symbols';

export const BOARD_INK = '#20262e';
export const BOARD_INK_SOFT = '#6a7280';
export const BOARD_SELECT = '#0a86a8';

function holeXY(id: string): [number, number] {
  const p = holePos(id);
  return p ? [p[0] * G, p[1] * G] : [0, 0];
}

function leadLine(g: CanvasRenderingContext2D, a: [number, number], b: [number, number]): void {
  g.lineCap = 'round';
  g.strokeStyle = '#8b939d';
  g.lineWidth = 2.6;
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.65)';
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(a[0], a[1] - 0.5);
  g.lineTo(b[0], b[1] - 0.5);
  g.stroke();
  for (const p of [a, b]) pinDot(g, p);
}

function pinDot(g: CanvasRenderingContext2D, p: [number, number]): void {
  g.fillStyle = '#7d8691';
  g.beginPath();
  g.arc(p[0], p[1], 2.9, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#c7ccd3';
  g.beginPath();
  g.arc(p[0] - 0.5, p[1] - 0.6, 1.2, 0, Math.PI * 2);
  g.fill();
}

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, color = BOARD_INK, size = 10, weight = '600', font = FONT): void {
  g.font = `${weight} ${size}px ${font}`;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, y);
}

/** 圓柱的明暗：上方反光、下方陰影。 */
function cylinder(g: CanvasRenderingContext2D, y0: number, y1: number, dark: string, base: string, light: string): CanvasGradient {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, base);
  gr.addColorStop(0.28, light);
  gr.addColorStop(0.62, base);
  gr.addColorStop(1, dark);
  return gr;
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

function softShadow(g: CanvasRenderingContext2D, draw: () => void): void {
  g.save();
  g.translate(0.8, 1.6);
  g.fillStyle = 'rgba(0,0,0,0.22)';
  draw();
  g.fill();
  g.restore();
}

function drawTwoLead(g: CanvasRenderingContext2D, c: Comp, dev: Device | undefined, live: boolean): void {
  const holes = c.bb?.holes;
  if (!holes) return;
  const a = holeXY(holes[0]);
  const b = holeXY(holes[1]);
  leadLine(g, a, b);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  switch (c.type) {
    case 'res':
      alongLeads(g, a, b, () => {
        const w = Math.min(30, Math.max(14, len - 8));
        // 兩端較粗的「狗骨頭」外形
        const shape = () => {
          g.beginPath();
          g.roundRect(-w / 2, -5.6, w * 0.26, 11.2, 3.6);
          g.roundRect(w / 2 - w * 0.26, -5.6, w * 0.26, 11.2, 3.6);
          g.rect(-w / 2 + w * 0.16, -4.6, w * 0.68, 9.2);
        };
        softShadow(g, shape);
        g.fillStyle = cylinder(g, -5.6, 5.6, '#a98856', '#dcbd8a', '#f3e4c5');
        shape();
        g.fill();
        const bands = resistorBands(Number(c.params.R));
        const xs = [-w * 0.32, -w * 0.14, w * 0.04, w * 0.33];
        bands.forEach((band, i) => {
          g.fillStyle = band.color;
          const hh = i === 0 || i === 3 ? 5.6 : 4.6;
          g.fillRect(xs[i] - 1.5, -hh, 3, hh * 2);
        });
        // 色環也要有圓柱的明暗
        const gloss = g.createLinearGradient(0, -5.6, 0, 5.6);
        gloss.addColorStop(0, 'rgba(255,255,255,0.05)');
        gloss.addColorStop(0.3, 'rgba(255,255,255,0.3)');
        gloss.addColorStop(0.65, 'rgba(255,255,255,0)');
        gloss.addColorStop(1, 'rgba(0,0,0,0.22)');
        g.fillStyle = gloss;
        shape();
        g.fill();
      });
      break;
    case 'ind':
      alongLeads(g, a, b, () => {
        const shape = () => {
          g.beginPath();
          g.roundRect(-13, -5.5, 26, 11, 5);
        };
        softShadow(g, shape);
        g.fillStyle = cylinder(g, -5.5, 5.5, '#2f5f3a', '#4f8f5b', '#86c292');
        shape();
        g.fill();
        g.fillStyle = 'rgba(232,232,224,0.9)';
        for (const x of [-7, -2, 3, 8]) g.fillRect(x - 1, -5.5, 2, 11);
      });
      break;
    case 'cap': {
      if (c.params.polar === true) {
        const r = 12;
        softShadow(g, () => {
          g.beginPath();
          g.arc(mx, my, r, 0, Math.PI * 2);
        });
        const sleeve = g.createRadialGradient(mx - 4, my - 5, 2, mx, my, r);
        sleeve.addColorStop(0, '#3b4a6b');
        sleeve.addColorStop(1, '#1b2436');
        g.fillStyle = sleeve;
        g.beginPath();
        g.arc(mx, my, r, 0, Math.PI * 2);
        g.fill();
        // 負極標記
        const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
        g.fillStyle = '#c9d2e0';
        g.beginPath();
        g.arc(mx, my, r, angle - 0.75, angle + 0.75);
        g.closePath();
        g.fill();
        g.fillStyle = '#26324a';
        g.font = `700 11px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('−', mx + Math.cos(angle) * 7.8, my + Math.sin(angle) * 7.8);
        // 鋁殼頂面
        const top = g.createRadialGradient(mx - 2, my - 2, 0.5, mx, my, 6);
        top.addColorStop(0, '#eef1f5');
        top.addColorStop(1, '#9aa3ad');
        g.fillStyle = top;
        g.beginPath();
        g.arc(mx - Math.cos(angle) * 1.5, my - Math.sin(angle) * 1.5, 5.5, 0, Math.PI * 2);
        g.fill();
      } else {
        softShadow(g, () => {
          g.beginPath();
          g.arc(mx, my, 9, 0, Math.PI * 2);
        });
        const disc = g.createRadialGradient(mx - 3, my - 3, 1, mx, my, 9);
        disc.addColorStop(0, '#f2b26d');
        disc.addColorStop(1, '#c97a2c');
        g.fillStyle = disc;
        g.strokeStyle = '#9c5f22';
        g.lineWidth = 0.8;
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
        const zener = c.type === 'zener';
        const shape = () => {
          g.beginPath();
          g.roundRect(-10, -4.5, 20, 9, 2.5);
        };
        softShadow(g, shape);
        g.fillStyle = zener ? cylinder(g, -4.5, 4.5, '#8f4f19', '#c9742c', '#f0b070') : cylinder(g, -4.5, 4.5, '#0c0c0f', '#1e1e22', '#55555d');
        shape();
        g.fill();
        g.fillStyle = zener ? '#1e1e22' : '#dcdcdc';
        g.fillRect(5, -4.5, 3, 9);
      });
      break;
    case 'led': {
      const color = (LED_COLORS[String(c.params.color)] ?? LED_COLORS.red).color;
      const led = dev instanceof Led ? dev : null;
      const bright = live && led ? led.brightness : 0;
      const burned = !!led?.burned;
      if (bright > 0.01) {
        const grad = g.createRadialGradient(mx, my, 3, mx, my, 38);
        grad.addColorStop(0, alpha(color, Math.min(1, 0.45 + bright * 0.5)));
        grad.addColorStop(1, alpha(color, 0));
        g.fillStyle = grad;
        g.beginPath();
        g.arc(mx, my, 38, 0, Math.PI * 2);
        g.fill();
      }
      softShadow(g, () => {
        g.beginPath();
        g.arc(mx, my, 10.5, 0, Math.PI * 2);
      });
      // 底座
      g.fillStyle = burned ? '#2a2a2a' : alpha(color, 0.55);
      g.beginPath();
      g.arc(mx, my, 10.5, 0, Math.PI * 2);
      g.fill();
      // 圓頂
      const dome = g.createRadialGradient(mx - 3, my - 3, 0.5, mx, my, 9);
      if (burned) {
        dome.addColorStop(0, '#55514c');
        dome.addColorStop(1, '#1d1b19');
      } else if (bright > 0.01) {
        dome.addColorStop(0, '#ffffff');
        dome.addColorStop(0.45, color);
        dome.addColorStop(1, color);
      } else {
        dome.addColorStop(0, alpha(color, 0.65));
        dome.addColorStop(1, alpha(color, 0.9));
      }
      g.fillStyle = dome;
      g.beginPath();
      g.arc(mx, my, 8.8, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 0.8;
      g.beginPath();
      g.arc(mx, my, 10.5, 0, Math.PI * 2);
      g.stroke();
      if (!burned) {
        g.fillStyle = 'rgba(255,255,255,0.6)';
        g.beginPath();
        g.ellipse(mx - 3, my - 3.4, 2.6, 1.8, -0.6, 0, Math.PI * 2);
        g.fill();
      }
      // 長腳（陽極）標記
      label(g, '+', a[0] + (a[0] <= b[0] ? -1 : 1), a[1] - 10, '#c92a2a', 11, '700');
      break;
    }
    case 'lamp': {
      const i = dev?.currents[0] ?? 0;
      const bright = live ? Math.min(1, (i * i * Number(c.params.R)) / Number(c.params.Pfull)) : 0;
      if (bright > 0.01) {
        const grad = g.createRadialGradient(mx, my, 4, mx, my, 38);
        grad.addColorStop(0, `rgba(255,214,70,${0.95 * bright})`);
        grad.addColorStop(1, 'rgba(255,214,70,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(mx, my, 38, 0, Math.PI * 2);
        g.fill();
      }
      const glass = g.createRadialGradient(mx - 4, my - 4, 1, mx, my, 12);
      glass.addColorStop(0, '#ffffff');
      glass.addColorStop(1, bright > 0.01 ? '#ffe28a' : '#d8d8cc');
      g.fillStyle = glass;
      g.strokeStyle = '#8a8a7a';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(mx, my, 12, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.strokeStyle = bright > 0.01 ? '#e8890c' : '#8a8a7a';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(mx - 5, my + 2);
      g.quadraticCurveTo(mx, my - 6, mx + 5, my + 2);
      g.stroke();
      break;
    }
    case 'sw':
      alongLeads(g, a, b, () => {
        const closed = c.params.closed === true;
        const shape = () => {
          g.beginPath();
          g.roundRect(-18, -8, 36, 16, 2.5);
        };
        softShadow(g, shape);
        g.fillStyle = cylinder(g, -8, 8, '#1c4176', '#2b5fa8', '#4d82cc');
        shape();
        g.fill();
        g.fillStyle = '#16345e';
        g.fillRect(-16, -5.5, 32, 11);
        g.fillStyle = cylinder(g, -5, 5, '#b4bdc9', '#dfe6ef', '#ffffff');
        g.fillRect(closed ? 1 : -15, -5, 14, 10);
        label(g, closed ? 'ON' : 'OFF', closed ? -8 : 8, 0.5, '#fff', 7.5);
      }, true);
      break;
    case 'push':
      alongLeads(g, a, b, () => {
        const closed = c.params.closed === true;
        const shape = () => {
          g.beginPath();
          g.roundRect(-10, -10, 20, 20, 2);
        };
        softShadow(g, shape);
        g.fillStyle = cylinder(g, -10, 10, '#141416', '#2c2c30', '#47474d');
        shape();
        g.fill();
        const cap = g.createRadialGradient(-2, -2, 0.5, 0, 0, 6.5);
        cap.addColorStop(0, closed ? '#ff8a80' : '#c4c9cf');
        cap.addColorStop(1, closed ? '#c92a2a' : '#6f757c');
        g.fillStyle = cap;
        g.beginPath();
        g.arc(0, 0, closed ? 5.4 : 6.2, 0, Math.PI * 2);
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
  for (const p of pts) pinDot(g, p);
  if (c.type === 'pot') {
    const shape = () => {
      g.beginPath();
      g.roundRect(minX - 9, y - 26, maxX - minX + 18, 30, 3);
    };
    softShadow(g, shape);
    g.fillStyle = cylinder(g, y - 26, y + 4, '#1c4176', '#2b5fa8', '#4d82cc');
    shape();
    g.fill();
    // 黃銅旋鈕
    const knob = g.createRadialGradient(cx - 3, y - 15, 1, cx, y - 12, 10);
    knob.addColorStop(0, '#fff3c9');
    knob.addColorStop(1, '#b08a3e');
    g.fillStyle = knob;
    g.beginPath();
    g.arc(cx, y - 12, 10, 0, Math.PI * 2);
    g.fill();
    const a = -Math.PI * 1.25 + Number(c.params.pos) * Math.PI * 1.5;
    g.strokeStyle = '#3e3112';
    g.lineWidth = 2.4;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - Math.cos(a) * 3, y - 12 - Math.sin(a) * 3);
    g.lineTo(cx + Math.cos(a) * 8, y - 12 + Math.sin(a) * 8);
    g.stroke();
  } else {
    const shape = () => {
      g.beginPath();
      g.moveTo(minX - 8, y - 4);
      g.lineTo(maxX + 8, y - 4);
      g.lineTo(maxX + 8, y - 12);
      g.quadraticCurveTo(cx, y - 32, minX - 8, y - 12);
      g.closePath();
    };
    softShadow(g, shape);
    const body = g.createLinearGradient(0, y - 28, 0, y - 4);
    body.addColorStop(0, '#4a4a52');
    body.addColorStop(1, '#1d1d21');
    g.fillStyle = body;
    shape();
    g.fill();
    label(g, c.type.toUpperCase().replace('NMOS', 'N-MOS').replace('PMOS', 'P-MOS'), cx, y - 12, '#e9e9e4', 8);
  }
  // 腳名
  def.pins.forEach((pin, i) => {
    if (c.type === 'pot') return;
    label(g, pin.name, pts[i][0], y + 10, BOARD_INK, 9);
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
  // 金屬腳：從本體伸到孔
  for (let k = 1; k <= foot.numPins; k++) {
    const [hx, hy] = holeXY(dipHole(col, foot.numPins, k));
    const up = hy < (y0 + y1) / 2;
    const yIn = up ? y0 : y1;
    const leg = g.createLinearGradient(hx - 3, 0, hx + 3, 0);
    leg.addColorStop(0, '#858d97');
    leg.addColorStop(0.5, '#e4e8ec');
    leg.addColorStop(1, '#858d97');
    g.fillStyle = leg;
    g.fillRect(hx - 3, Math.min(hy - 3, yIn), 6, Math.abs(yIn - hy) + 3);
    g.fillRect(hx - 3, hy - 3, 6, 6);
  }
  const shape = () => {
    g.beginPath();
    g.roundRect(x0, y0, x1 - x0, y1 - y0, 2.5);
  };
  softShadow(g, shape);
  const plastic = g.createLinearGradient(0, y0, 0, y1);
  plastic.addColorStop(0, isSeg ? '#55565c' : '#3e3e45');
  plastic.addColorStop(0.5, isSeg ? '#46474c' : '#2b2b30');
  plastic.addColorStop(1, isSeg ? '#37383c' : '#1e1e22');
  g.fillStyle = plastic;
  shape();
  g.fill();
  // 上表面的倒角
  g.strokeStyle = 'rgba(255,255,255,0.1)';
  g.lineWidth = 1;
  g.beginPath();
  g.roundRect(x0 + 2.5, y0 + 2.5, x1 - x0 - 5, y1 - y0 - 5, 1.5);
  g.stroke();
  const midY = (y0 + y1) / 2;
  if (isSeg) {
    g.fillStyle = '#17181b';
    g.beginPath();
    g.roundRect(x0 + 6, y0 + 6, x1 - x0 - 12, y1 - y0 - 12, 2);
    g.fill();
    let bits = 0;
    if (live && dev instanceof Composite) {
      dev.parts.slice(0, 7).forEach((p, i) => {
        if ((p as Led).brightness > 0.05) bits |= 1 << i;
      });
    }
    const color = (LED_COLORS[String(c.params.color)] ?? LED_COLORS.red).color;
    drawSegments(g, (x0 + x1) / 2, midY, bits, color, 18, 26);
    return;
  }
  // 缺口與第 1 腳標記
  g.fillStyle = '#121215';
  g.beginPath();
  g.arc(x0, midY, 6, -Math.PI / 2, Math.PI / 2);
  g.fill();
  g.fillStyle = '#d7d7d7';
  g.beginPath();
  g.arc(x0 + 7, y1 - 7, 2, 0, Math.PI * 2);
  g.fill();
  label(g, def.name.split(' ')[0], (x0 + x1) / 2, midY + 2, '#e9e9e4', half >= 7 ? 12 : 10, '700');
}

/** 儀器的接線柱。 */
function bindingPost(g: CanvasRenderingContext2D, x: number, y: number, red: boolean): void {
  g.fillStyle = '#c9ced4';
  g.beginPath();
  g.arc(x, y, 8, 0, Math.PI * 2);
  g.fill();
  const cap = g.createRadialGradient(x - 2, y - 2.5, 0.5, x, y, 6.6);
  cap.addColorStop(0, red ? '#ff7b72' : '#5b5d63');
  cap.addColorStop(1, red ? '#b3141b' : '#101114');
  g.fillStyle = cap;
  g.beginPath();
  g.arc(x, y, 6.6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath();
  g.arc(x, y, 1.8, 0, Math.PI * 2);
  g.fill();
}

function drawBench(g: CanvasRenderingContext2D, c: Comp, dev: Device | undefined, live: boolean): void {
  const foot = getDef(c.type).bb!;
  if (foot.kind !== 'bench' || c.bb?.x === undefined) return;
  const x = c.bb.x * G;
  const y = c.bb.y! * G;
  const w = foot.w * G;
  const h = foot.h * G;
  const isMeter = c.type === 'meter';

  // 機殼
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.5)';
  g.shadowBlur = 10;
  g.shadowOffsetY = 4;
  const shell = g.createLinearGradient(0, y, 0, y + h);
  if (isMeter) {
    shell.addColorStop(0, '#ffd84d');
    shell.addColorStop(1, '#e0a914');
  } else if (c.type === 'ac') {
    shell.addColorStop(0, '#46617e');
    shell.addColorStop(1, '#2c4159');
  } else {
    shell.addColorStop(0, '#596370');
    shell.addColorStop(1, '#39414c');
  }
  g.fillStyle = shell;
  g.beginPath();
  g.roundRect(x, y, w, h, 5);
  g.fill();
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,0.22)';
  g.lineWidth = 1;
  g.beginPath();
  g.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 4.5);
  g.stroke();

  const textColor = isMeter ? '#2a2308' : '#eef1f5';
  label(g, c.type === 'dc' ? '電源供應器' : c.type === 'ac' ? '訊號產生器' : '三用電錶', x + w / 2, y + 11, textColor, 10);

  // 顯示幕
  const sx = x + 8;
  const sy = y + 20;
  const sw = w - 16;
  const sh = 26;
  const lcdBg = g.createLinearGradient(0, sy, 0, sy + sh);
  if (isMeter) {
    lcdBg.addColorStop(0, '#a7b49a');
    lcdBg.addColorStop(1, '#c3cfb5');
  } else {
    lcdBg.addColorStop(0, '#060c0a');
    lcdBg.addColorStop(1, '#10201a');
  }
  g.fillStyle = lcdBg;
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.beginPath();
  g.roundRect(sx, sy, sw, sh, 2.5);
  g.fill();
  g.stroke();

  let lcd = '';
  if (c.type === 'dc') lcd = `${Number(c.params.V).toFixed(2)} V`;
  else if (c.type === 'ac') lcd = `${formatValue(Number(c.params.amp), 'V')} ${formatValue(Number(c.params.freq), 'Hz')}`;
  else if (dev instanceof Meter && live) {
    const r = dev.reading;
    const mode = dev.mode;
    const unit = mode === 'ohm' ? 'Ω' : mode === 'dca' || mode === 'aca' ? 'A' : 'V';
    lcd = r === Infinity ? 'OL' : formatValue(r, unit);
  } else lcd = '---';
  label(g, lcd, x + w / 2, sy + 13.5, isMeter ? '#1b2115' : c.type === 'ac' ? '#ffc24d' : '#7cf0a8', c.type === 'ac' ? 10.5 : 13, '700', MONO);

  // 端子
  foot.terms.forEach(([dx, dy], i) => {
    const tx = x + dx * G;
    const ty = y + dy * G;
    bindingPost(g, tx, ty, i === 0);
    const name = c.type === 'dc' ? (i === 0 ? '+' : '−') : isMeter ? (i === 0 ? '紅' : '黑') : i === 0 ? '輸出' : '共同';
    label(g, name, tx, ty - 14, textColor, 10, '700');
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
