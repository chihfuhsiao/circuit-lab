// 示波器：顯示探棒的電壓波形與量測值。

import { App, MAX_PROBES, SCOPE_COLORS } from '../app';
import { getDef } from '../circuit/catalog';
import { formatValue } from '../circuit/format';
import { alpha, FONT, MONO } from '../view/common';
import { clear, h } from './dom';
import { icon } from './icons';
import { Panels } from './split';
import { Stage } from './stage';

export interface ScopeApi {
  el: HTMLElement;
  toggle(): void;
  isOpen(): boolean;
}

const TIME_OPTIONS: [string, number][] = [
  ['自動', 0],
  ['10 µs/格', 1e-5],
  ['100 µs/格', 1e-4],
  ['200 µs/格', 2e-4],
  ['500 µs/格', 5e-4],
  ['1 ms/格', 1e-3],
  ['2 ms/格', 2e-3],
  ['5 ms/格', 5e-3],
  ['10 ms/格', 1e-2],
  ['20 ms/格', 2e-2],
  ['50 ms/格', 5e-2],
  ['100 ms/格', 0.1],
  ['200 ms/格', 0.2],
  ['500 ms/格', 0.5],
  ['1 s/格', 1],
];

const VOLT_OPTIONS: [string, number][] = [
  ['自動', 0],
  ['10 mV/格', 0.01],
  ['100 mV/格', 0.1],
  ['500 mV/格', 0.5],
  ['1 V/格', 1],
  ['2 V/格', 2],
  ['5 V/格', 5],
  ['10 V/格', 10],
];

const DIV_X = 10;
const DIV_Y = 8;

function niceStep(v: number): number {
  const exp = Math.floor(Math.log10(v));
  const f = v / 10 ** exp;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return n * 10 ** exp;
}

export function buildScope(app: App, stage: Stage, panels: Panels): ScopeApi {
  let timeDiv = 0;
  let voltDiv = 0;
  let autoVolt = 1;
  let open = true;

  const canvas = h('canvas', { 'aria-label': '示波器波形' });
  const g = canvas.getContext('2d')!;
  const stats = h('div', { class: 'scope-stats', 'aria-live': 'off' });
  const chips = h('span', { class: 'chips' });
  const addLabel = h('span', {}, '探棒');
  const addBtn = h('button', {
    class: 'tb tb-label sm',
    'data-tip': '點電路上的節點，加到示波器',
    onclick: () => app.setTool(app.tool === 'probe' ? 'select' : 'probe'),
  }, icon('plus', 14), addLabel);
  const timeSel = h(
    'select',
    { class: 'select sm', 'aria-label': '時間刻度', 'data-tip': '時間刻度', onchange: (e: Event) => (timeDiv = Number((e.target as HTMLSelectElement).value)) },
    TIME_OPTIONS.map(([label, v]) => h('option', { value: v }, `T  ${label}`)),
  );
  const voltSel = h(
    'select',
    { class: 'select sm', 'aria-label': '電壓刻度', 'data-tip': '電壓刻度', onchange: (e: Event) => (voltDiv = Number((e.target as HTMLSelectElement).value)) },
    VOLT_OPTIONS.map(([label, v]) => h('option', { value: v }, `V  ${label}`)),
  );
  const body = h('div', { class: 'scope-body' }, h('div', { class: 'scope-canvas-wrap' }, canvas), stats);
  const handle = panels.handle('scope', 'y', -1, 'split-scope');
  const setOpen = (v: boolean) => {
    open = v;
    body.hidden = !open;
    handle.hidden = !open;
    toggleBtn.replaceChildren(icon(open ? 'chevDown' : 'chevUp'));
    toggleBtn.setAttribute('aria-expanded', String(open));
    toggleBtn.dataset.tip = open ? '收合示波器' : '展開示波器';
  };
  const toggleBtn = h('button', {
    class: 'tb sm',
    'aria-label': '收合或展開示波器',
    onclick: () => setOpen(!open),
  });
  const el = h(
    'section',
    { class: 'scope', 'aria-label': '示波器' },
    handle,
    h('div', { class: 'scope-head' }, icon('wave'), h('h3', {}, '示波器'), chips, addBtn, h('span', { class: 'spacer' }), timeSel, voltSel, toggleBtn),
    body,
  );
  setOpen(true);

  const renderChips = () => {
    clear(chips);
    app.doc.probes.forEach((p, i) => {
      const comp = app.doc.comps.find((c) => c.id === p.compId);
      chips.append(
        h(
          'span',
          { class: 'chip' },
          h('i', { style: `background:${SCOPE_COLORS[i]}` }),
          comp ? `${comp.ref}「${getDef(comp.type).pins[p.pin].name}」` : '已刪除',
          h('button', { 'aria-label': '移除探棒', onclick: () => app.removeProbe(i) }, '×'),
        ),
      );
    });
    addBtn.classList.toggle('active', app.tool === 'probe');
    addLabel.textContent = app.tool === 'probe' ? '點電路上的節點…' : app.doc.probes.length >= MAX_PROBES ? '探棒（換掉最舊的）' : '探棒';
  };
  app.on((e) => {
    if (e === 'doc' || e === 'tool' || e === 'view') renderChips();
    if (e === 'loaded' || e === 'view') updateStats();
  });
  renderChips();

  let frameNo = 0;
  stage.addFrameCallback(() => {
    if (!open) return;
    draw();
    if (frameNo++ % 15 === 0) updateStats();
  });

  function windowRange(): { start: number; span: number } | null {
    const s = app.scope;
    if (!s.count) return null;
    const tdiv = timeDiv || niceStep(app.doc.speed / 5);
    const span = tdiv * DIV_X;
    const newest = s.times[s.index(s.count - 1)];
    let start = newest - span;
    // 觸發：找第一個通道的正緣，讓週期波形穩定不跑動。
    if (app.doc.probes.length) {
      const ch = s.channels[0];
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = s.count - 1; i >= 0; i--) {
        const idx = s.index(i);
        if (s.times[idx] < newest - span * 3) break;
        const v = ch[idx];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > 1e-3) {
        const level = (lo + hi) / 2;
        for (let i = s.count - 2; i >= 0; i--) {
          const idx = s.index(i);
          const t = s.times[idx];
          if (t > newest - span) continue;
          if (t < newest - span * 2) break;
          if (ch[idx] < level && ch[s.index(i + 1)] >= level) {
            start = t;
            break;
          }
        }
      }
    }
    return { start, span };
  }

  function draw(): void {
    const r = canvas.getBoundingClientRect();
    if (r.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(r.width * dpr);
    const H = Math.round(r.height * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = r.width;
    const hh = r.height;
    const screen = g.createRadialGradient(w / 2, hh / 2, 0, w / 2, hh / 2, Math.max(w, hh) * 0.65);
    screen.addColorStop(0, '#0f1a1d');
    screen.addColorStop(1, '#080d0f');
    g.fillStyle = screen;
    g.fillRect(0, 0, w, hh);

    // 格線：虛線的分格，中央十字加上刻度，和實體示波器一樣
    g.strokeStyle = 'rgba(150,190,190,0.2)';
    g.lineWidth = 1;
    g.setLineDash([1, 3]);
    g.beginPath();
    for (let i = 1; i < DIV_X; i++) {
      const x = Math.round((i / DIV_X) * w) + 0.5;
      g.moveTo(x, 0);
      g.lineTo(x, hh);
    }
    for (let i = 1; i < DIV_Y; i++) {
      const y = Math.round((i / DIV_Y) * hh) + 0.5;
      g.moveTo(0, y);
      g.lineTo(w, y);
    }
    g.stroke();
    g.setLineDash([]);
    const cx = Math.round(w / 2) + 0.5;
    const cy = Math.round(hh / 2) + 0.5;
    g.strokeStyle = 'rgba(150,190,190,0.42)';
    g.beginPath();
    g.moveTo(0, cy);
    g.lineTo(w, cy);
    g.moveTo(cx, 0);
    g.lineTo(cx, hh);
    for (let i = 1; i < DIV_X * 5; i++) {
      const x = Math.round((i / (DIV_X * 5)) * w) + 0.5;
      g.moveTo(x, cy - 2);
      g.lineTo(x, cy + 3);
    }
    for (let i = 1; i < DIV_Y * 5; i++) {
      const y = Math.round((i / (DIV_Y * 5)) * hh) + 0.5;
      g.moveTo(cx - 2, y);
      g.lineTo(cx + 3, y);
    }
    g.stroke();

    const s = app.scope;
    const range = windowRange();
    const probes = app.doc.probes;
    if (!probes.length) {
      label('按「探棒」，再點電路上的節點，就能看到波形', w / 2, hh / 2 - 12, 'center', '#9fb5b5', 13, FONT);
      return;
    }
    if (!range) return;

    // 自動電壓刻度：所有通道共用，才看得出大小關係。
    let peak = 0;
    for (let i = s.count - 1; i >= 0; i--) {
      const idx = s.index(i);
      const t = s.times[idx];
      if (t < range.start) break;
      if (t > range.start + range.span) continue;
      for (let k = 0; k < probes.length; k++) {
        const a = Math.abs(s.channels[k][idx]);
        if (a > peak) peak = a;
      }
    }
    const target = niceStep(Math.max(peak, 1e-3) / (DIV_Y / 2 - 0.5));
    autoVolt = target;
    const vdiv = voltDiv || autoVolt;
    const yOf = (v: number) => hh / 2 - (v / vdiv) * (hh / DIV_Y);

    for (let k = 0; k < probes.length; k++) {
      const ch = s.channels[k];
      const trace = new Path2D();
      let first = true;
      for (let i = 0; i < s.count; i++) {
        const idx = s.index(i);
        const t = s.times[idx];
        if (t < range.start) continue;
        if (t > range.start + range.span) break;
        const v = ch[idx];
        if (!Number.isFinite(v)) continue;
        const x = ((t - range.start) / range.span) * w;
        const y = yOf(v);
        if (first) trace.moveTo(x, y);
        else trace.lineTo(x, y);
        first = false;
      }
      // 先畫一層較粗的淡線，看起來像螢光幕上的光暈
      g.lineJoin = 'round';
      g.strokeStyle = alpha(SCOPE_COLORS[k], 0.2);
      g.lineWidth = 4;
      g.stroke(trace);
      g.strokeStyle = SCOPE_COLORS[k];
      g.lineWidth = 1.4;
      g.stroke(trace);
    }
    label(`${formatValue(range.span / DIV_X, 's')}/格   ${formatValue(vdiv, 'V')}/格`, 8, 12, 'left', '#9fb5b5', 11, MONO);
  }

  function label(text: string, x: number, y: number, align: CanvasTextAlign, color: string, size: number, font: string): void {
    g.font = `${size}px ${font}`;
    g.fillStyle = color;
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.fillText(text, x, y);
  }

  function updateStats(): void {
    const s = app.scope;
    const probes = app.doc.probes;
    const range = windowRange();
    if (!range || !probes.length) {
      stats.replaceChildren(h('div', { class: 'muted' }, '量測值會顯示在這裡'));
      return;
    }
    const rows = probes.map((p, k) => {
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let sq = 0;
      let n = 0;
      const ch = s.channels[k];
      const samples: { t: number; v: number }[] = [];
      for (let i = 0; i < s.count; i++) {
        const idx = s.index(i);
        const t = s.times[idx];
        if (t < range.start || t > range.start + range.span) continue;
        const v = ch[idx];
        if (!Number.isFinite(v)) continue;
        min = Math.min(min, v);
        max = Math.max(max, v);
        sum += v;
        sq += v * v;
        n++;
        samples.push({ t, v });
      }
      if (!n) return null;
      const avg = sum / n;
      const rms = Math.sqrt(sq / n);
      // 頻率：數平均電壓的正緣穿越。
      let freq = 0;
      if (max - min > 1e-3) {
        const level = (max + min) / 2;
        const crossings: number[] = [];
        for (let i = 1; i < samples.length; i++) {
          if (samples[i - 1].v < level && samples[i].v >= level) crossings.push(samples[i].t);
        }
        if (crossings.length >= 2) freq = (crossings.length - 1) / (crossings[crossings.length - 1] - crossings[0]);
      }
      const comp = app.doc.comps.find((c) => c.id === p.compId);
      return h(
        'div',
        { class: 'row' },
        h('b', {}, h('i', { style: `background:${SCOPE_COLORS[k]}` }), comp?.ref ?? '—'),
        h('span', {}, '峰對峰'),
        h('span', {}, formatValue(max - min, 'V')),
        h('span', {}, '平均'),
        h('span', {}, formatValue(avg, 'V')),
        h('span', {}, '有效值'),
        h('span', {}, formatValue(rms, 'V')),
        freq > 0 ? h('span', {}, '頻率') : '',
        freq > 0 ? h('span', {}, formatValue(freq, 'Hz')) : '',
      );
    });
    stats.replaceChildren(...rows.filter((x): x is HTMLDivElement => x !== null));
  }

  return { el, toggle: () => setOpen(!open), isOpen: () => open };
}
