// 左側元件庫。依目前畫面只列出放得上去的元件；麵包板畫面另外列出「待放置」。

import { App } from '../app';
import { CATALOG, CATEGORIES, CompDef, defaultParams, getDef } from '../circuit/catalog';
import { Comp } from '../circuit/types';
import { drawIcon } from '../view/symbols';
import { clear, h } from './dom';
import { icon } from './icons';
import { Stage } from './stage';

export function buildPalette(app: App, stage: Stage): HTMLElement {
  const list = h('div', { class: 'pal-list' });
  const open = new Set<string>(['電源', '被動元件', '半導體', '開關']);
  let query = '';

  const search = h('input', {
    type: 'search',
    class: 'pal-search',
    placeholder: '搜尋元件',
    'aria-label': '搜尋元件',
    oninput: (e: Event) => {
      query = (e.target as HTMLInputElement).value.trim().toLowerCase();
      render();
    },
  });
  const el = h(
    'aside',
    { class: 'palette', 'aria-label': '元件庫' },
    h('div', { class: 'panel-head' }, '元件庫'),
    h('div', { class: 'pal-search-wrap' }, icon('search', 14), search),
    list,
  );

  const drawIcons = () => {
    // canvas 要先進到畫面才有尺寸，圖示最後才畫。
    requestAnimationFrame(() => {
      list.querySelectorAll<HTMLCanvasElement>('canvas[data-type]').forEach((cv) => {
        const type = cv.dataset.type!;
        const comp: Comp = { id: '_', type, ref: '', params: defaultParams(type) };
        drawIcon(cv, comp);
      });
    });
  };

  const render = () => {
    clear(list);
    const view = app.view;
    const tray = app.doc.comps.filter((c) => {
      const def = getDef(c.type);
      return view === 'bb' ? !c.bb && def.bb && c.sch : !c.sch && def.sch && c.bb;
    });
    if (tray.length && !query) {
      list.append(
        h(
          'div',
          { class: 'tray' },
          h('h4', {}, view === 'bb' ? '待放置（來自電路圖）' : '待放置（來自麵包板）'),
          tray.map((c) => h('button', { class: 'tray-item', 'data-tip': getDef(c.type).name, onclick: () => stage.beginPlace(c.type, c.id) }, c.ref)),
        ),
      );
    }
    let shown = 0;
    for (const cat of CATEGORIES) {
      const items = [...CATALOG.values()].filter((d) => d.category === cat && (view === 'sch' ? d.sch : d.bb) && matches(d, query));
      if (!items.length) continue;
      shown += items.length;
      const details = h(
        'details',
        { class: 'pal-group', open: !!query || open.has(cat) },
        h('summary', {}, icon('chevRight', 12), h('span', {}, cat), h('span', { class: 'pal-count' }, String(items.length))),
        items.map((d) => item(d, stage)),
      );
      details.addEventListener('toggle', () => {
        if (query) return;
        if (details.open) open.add(cat);
        else open.delete(cat);
      });
      list.append(details);
    }
    if (!shown) list.append(h('p', { class: 'muted pal-empty' }, '找不到符合的元件'));
    drawIcons();
  };

  let lastKey = '';
  app.on((e) => {
    if (e === 'theme') drawIcons();
    if (e !== 'view' && e !== 'doc') return;
    const key = `${app.view}|${app.doc.comps.map((c) => `${c.id}:${c.sch ? 1 : 0}${c.bb ? 1 : 0}`).join(',')}`;
    if (key !== lastKey) {
      lastKey = key;
      render();
    }
  });
  render();
  return el;
}

function matches(d: CompDef, query: string): boolean {
  if (!query) return true;
  return d.name.toLowerCase().includes(query) || d.type.toLowerCase().includes(query);
}

function item(d: CompDef, stage: Stage): HTMLElement {
  return h(
    'button',
    { class: 'pal-item', 'data-tip': d.desc, onclick: () => stage.beginPlace(d.type) },
    h('span', { class: 'pal-tile' }, h('canvas', { width: 40, height: 26, 'data-type': d.type, 'aria-hidden': 'true' })),
    h('span', { class: 'pal-name' }, d.name),
  );
}
