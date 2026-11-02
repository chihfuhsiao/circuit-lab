// 示波器：顯示探棒的電壓波形與量測值。

import { App, MAX_PROBES, SCOPE_COLORS } from '../app';
import { getDef } from '../circuit/catalog';
import { formatValue } from '../circuit/format';
import { FONT } from '../view/common';
import { clear, h } from './dom';
import { Stage } from './stage';

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

export function buildScope(app: App, stage: Stage): HTMLElement {
  let timeDiv = 0;
  let voltDiv = 0;
  let autoVolt = 1;
  let open = true;

  const canvas = h('canvas', { 'aria-label': '示波器波形' });
  const g = canvas.getContext('2d')!;
  const stats = h('div', { class: 'scope-stats', 'aria-live': 'off' });
  const chips = h('span', { style: 'display:inline-flex;gap:4px;flex-wrap:wrap' });
  const addBtn = h('button', {
    class: 'btn',
    onclick: () => app.setTool(app.tool === 'probe' ? 'select' : 'probe'),
  }, '＋探棒');
  const timeSel = h(
    'select',
    { class: 'select', 'aria-label': '時間刻度', onchange: (e: Event) => (timeDiv = Number((e.target as HTMLSelectElement).value)) },
    TIME_OPTIONS.map(([label, v]) => h('option', { value: v }, label)),
  );
  const voltSel = h(
    'select',
    { class: 'select', 'aria-label': '電壓刻度', onchange: (e: Event) => (voltDiv = Number((e.target as HTMLSelectElement).value)) },
    VOLT_OPTIONS.map(([label, v]) => h('option', { value: v }, label)),
  );
  const body = h('div', { class: 'scope-body' }, h('div', { class: 'scope-canvas-wrap' }, canvas), stats);
  const toggle = h('button', {
    class: 'btn ghost',
    'aria-expanded': 'true',
    onclick: () => {
      open = !open;
      body.style.display = open ? '' : 'none';
      toggle.textContent = open ? '收合' : '展開';
      toggle.setAttribute('aria-expanded', String(open));
    },
  }, '收合');
  const el = h(
    'section',
    { class: 'scope', 'aria-label': '示波器' },
    h('div', { class: 'scope-head' }, h('h3', {}, '示波器'), chips, addBtn, h('span', { class: 'spacer' }), timeSel, voltSel, toggle),
    body,
  );

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
    addBtn.disabled = false;
    addBtn.textContent = app.tool === 'probe' ? '點電路上的節點…' : app.doc.probes.length >= MAX_PROBES ? '＋探棒（換掉最舊的）' : '＋探棒';
  };
  app.on((e) => {
    if (e === 'doc' || e === 'tool' || e === 'view') renderChips();
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
    g.fillStyle = '#0f1a1c';
    g.fillRect(0, 0, w, hh);

    // 格線
    g.strokeStyle = 'rgba(160,190,190,0.18)';
    g.lineWidth = 1;
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
    g.strokeStyle = 'rgba(160,190,190,0.4)';
    g.beginPath();
    g.moveTo(0, hh / 2 + 0.5);
    g.lineTo(w, hh / 2 + 0.5);
    g.stroke();

    const s = app.scope;
    const range = windowRange();
    const probes = app.doc.probes;
    if (!probes.length) {
      label('按「＋探棒」，再點電路上的節點，就能看到波形', w / 2, hh / 2, 'center', '#9fb5b5', 13);
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
      g.strokeStyle = SCOPE_COLORS[k];
      g.lineWidth = 1.6;
      g.beginPath();
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
        if (first) g.moveTo(x, y);
        else g.lineTo(x, y);
        first = false;
      }
      g.stroke();
    }
    label(`${formatValue(range.span / DIV_X, 's')}/格　${formatValue(vdiv, 'V')}/格`, 6, 11, 'left', '#9fb5b5', 11);
  }

  function label(text: string, x: number, y: number, align: CanvasTextAlign, color: string, size: number): void {
    g.font = `${size}px ${FONT}`;
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
        h('b', { style: `color:${SCOPE_COLORS[k]}` }, comp?.ref ?? '—'),
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

  return el;
}
