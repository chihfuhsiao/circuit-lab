// 屬性面板：改元件數值，並顯示即時量測。

import { Meter } from '../engine/analog';
import { App } from '../app';
import { getDef, ParamDef } from '../circuit/catalog';
import { formatInput, formatValue, parseValue, resistorBands } from '../circuit/format';
import { Comp } from '../circuit/types';
import { measureLines } from '../view/schematic';
import { clear, h } from './dom';

export function buildInspector(app: App): HTMLElement {
  const el = h('div', {});
  let readout: HTMLElement | null = null;
  let renderedId: string | null = null;

  const render = () => {
    clear(el);
    readout = null;
    const comp = app.selectedComp;
    renderedId = comp?.id ?? null;
    if (!comp) {
      el.append(emptyState(app));
      return;
    }
    const def = getDef(comp.type);
    el.append(h('h2', {}, `${comp.ref}　${def.name}`), h('div', { class: 'muted' }, def.desc));
    if (comp.type !== 'gnd') {
      el.append(
        h(
          'div',
          { class: 'field' },
          h('label', {}, '代號'),
          h('input', {
            type: 'text',
            value: comp.ref,
            onchange: (e: Event) => {
              const v = (e.target as HTMLInputElement).value.trim();
              if (v) {
                comp.ref = v;
                app.commit();
                render();
              }
            },
          }),
        ),
      );
    }
    for (const p of def.params) {
      if (p.visible && !p.visible(comp.params)) continue;
      el.append(paramField(app, comp, p, render));
    }
    if (comp.type === 'res') el.append(bandsRow(comp));
    readout = h('div', { class: 'readout' });
    el.append(h('h3', {}, '目前量測'), readout);
    updateReadout();
    if (app.view === 'bb') el.append(pinGuide(comp));
    el.append(
      h(
        'p',
        { class: 'muted' },
        app.view === 'sch' ? '按 R 旋轉，Delete 刪除。' : '選取後可拖曳引腳換孔，按 R 調換方向，Delete 拔除。',
      ),
    );
  };

  const updateReadout = () => {
    const comp = app.selectedComp;
    if (!readout || !comp) return;
    const lines = measureLines(app, comp).slice(1);
    const dev = app.compiled.devices.get(comp.id);
    if (dev instanceof Meter) {
      const r = dev.reading;
      const unit = dev.mode === 'ohm' ? 'Ω' : dev.mode === 'dca' || dev.mode === 'aca' ? 'A' : 'V';
      lines.unshift(`讀值 ${r === Infinity ? 'OL（開路）' : formatValue(r, unit, 4)}`);
    }
    const placed = app.compiled.topo.comps.some((c) => c.id === comp.id);
    const empty = placed ? '0V 參考點，沒有其他量測值' : '這個畫面還沒有放這個元件';
    readout.replaceChildren(...(lines.length ? lines.map((l) => h('div', {}, l)) : [h('div', { class: 'muted' }, empty)]));
  };

  app.on((e) => {
    if (e === 'selection') render();
    else if (e === 'slow') {
      if (app.selectedComp?.id !== renderedId) render();
      else if (!renderedId) renderEmptyDiag();
      else updateReadout();
    } else if (e === 'doc' && app.selectedComp?.id !== renderedId) render();
  });

  const renderEmptyDiag = () => {
    if (!app.selectedComp) {
      clear(el);
      el.append(emptyState(app));
    }
  };

  render();
  return el;
}

function emptyState(app: App): HTMLElement {
  const count = app.compiled.topo.comps.length;
  return h(
    'div',
    {},
    h('h2', {}, app.doc.title),
    h('p', { class: 'muted' }, count ? `這個畫面有 ${count} 個元件。點元件可以修改數值；把滑鼠移到元件或導線上可以看電壓、電流。` : '從左邊選元件開始，或到「範例」「實驗」分頁載入電路。'),
    h('h3', {}, '怎麼操作'),
    h(
      'ul',
      { class: 'muted', style: 'padding-left:18px;margin:0' },
      app.view === 'sch'
        ? [
            h('li', {}, '點元件庫，再點畫布放置'),
            h('li', {}, '從元件的腳拖曳出去就是接線'),
            h('li', {}, '黃色小點是電流（由正到負）'),
            h('li', {}, '導線顏色：紅為高電位、灰為 0V、藍為負電位'),
          ]
        : [
            h('li', {}, '滑鼠移到孔上，會標出相通的孔'),
            h('li', {}, '從空的孔或電源端子拖曳，就是接跳線'),
            h('li', {}, 'IC 要跨在中央溝槽上'),
            h('li', {}, '「對照電路圖」會檢查接線是否正確'),
          ],
    ),
  );
}

function paramField(app: App, comp: Comp, p: ParamDef, rerender: () => void): HTMLElement {
  const key = `param:${comp.id}:${p.key}`;
  if (p.kind === 'bool') {
    const input = h('input', {
      type: 'checkbox',
      checked: comp.params[p.key] === true,
      onchange: (e: Event) => {
        comp.params[p.key] = (e.target as HTMLInputElement).checked;
        app.commit();
      },
    });
    return h('div', { class: 'field' }, h('label', { class: 'check' }, input, p.label));
  }
  if (p.kind === 'select') {
    const sel = h(
      'select',
      {
        onchange: (e: Event) => {
          comp.params[p.key] = (e.target as HTMLSelectElement).value;
          app.commit();
          rerender();
        },
      },
      p.options!.map((o) => h('option', { value: o.value, selected: comp.params[p.key] === o.value }, o.label)),
    );
    return h('div', { class: 'field' }, h('label', {}, p.label), sel);
  }
  if (p.kind === 'percent') {
    const value = h('span', {}, `${Math.round(Number(comp.params[p.key]) * 100)}%`);
    const range = h('input', {
      type: 'range',
      min: 0,
      max: 100,
      step: 1,
      value: Math.round(Number(comp.params[p.key]) * 100),
      'aria-label': p.label,
      oninput: (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value) / 100;
        comp.params[p.key] = v;
        value.textContent = `${Math.round(v * 100)}%`;
        app.commit(key);
      },
    });
    return h('div', { class: 'field' }, h('label', {}, p.label, '：', value), range);
  }

  // 數值：可輸入 4.7k 這種寫法，有範圍的另外附拉桿（對數刻度）。
  const num = Number(comp.params[p.key]);
  const input = h('input', {
    type: 'text',
    value: formatInput(num),
    inputMode: 'decimal',
    'aria-label': p.label,
    onchange: (e: Event) => {
      const t = e.target as HTMLInputElement;
      const v = parseValue(t.value);
      if (v === null) {
        t.classList.add('bad');
        return;
      }
      t.classList.remove('bad');
      comp.params[p.key] = v;
      app.commit();
      rerender();
    },
  });
  const nodes: (HTMLElement | string)[] = [h('label', {}, p.label, p.unit ? `（${p.unit}）` : ''), input];
  if (p.min !== undefined && p.max !== undefined && p.min > 0) {
    const lo = Math.log10(p.min);
    const hi = Math.log10(p.max);
    const toSlider = (v: number) => Math.round(((Math.log10(Math.max(v, p.min!)) - lo) / (hi - lo)) * 1000);
    const range = h('input', {
      type: 'range',
      min: 0,
      max: 1000,
      value: toSlider(num),
      'aria-label': `${p.label}拉桿`,
      oninput: (e: Event) => {
        const s = Number((e.target as HTMLInputElement).value) / 1000;
        const raw = 10 ** (lo + s * (hi - lo));
        const v = Number(raw.toPrecision(2));
        comp.params[p.key] = v;
        input.value = formatInput(v);
        app.commit(key);
        const b = input.closest('.tab-body')?.querySelector<HTMLElement>('[data-bands]');
        if (b && comp.type === 'res') b.replaceWith(bandsRow(comp));
      },
    });
    nodes.push(range);
  }
  return h('div', { class: 'field' }, nodes);
}

function bandsRow(comp: Comp): HTMLElement {
  const bands = resistorBands(Number(comp.params.R));
  return h(
    'div',
    { class: 'bands', 'data-bands': '1' },
    h('span', { class: 'stripe', 'aria-hidden': 'true' }, bands.map((b) => h('i', { style: `background:${b.color}` }))),
    `色碼：${bands.map((b) => b.name).join(' ')}`,
  );
}

function pinGuide(comp: Comp): HTMLElement | string {
  const def = getDef(comp.type);
  const pins = def.pins.filter((p) => p.dip !== undefined && p.name !== 'NC');
  if (!pins.length) return '';
  return h(
    'div',
    {},
    h('h3', {}, '腳位'),
    h('div', { class: 'readout', style: 'columns:2' }, pins.map((p) => h('div', {}, `${p.dip}　${p.name}`))),
  );
}
