// 功能表列：點開、滑過切換、方向鍵與 Esc 操作。

import { h } from './dom';
import { icon, IconName } from './icons';

export interface MenuItem {
  label: string;
  icon?: IconName;
  key?: string;
  action: () => void;
  enabled?: () => boolean;
  checked?: () => boolean;
}

export type MenuEntry = MenuItem | 'sep';

export interface MenuDef {
  label: string;
  items: MenuEntry[];
}

export function buildMenuBar(menus: MenuDef[]): HTMLElement {
  const bar = h('nav', { class: 'menubar', role: 'menubar', 'aria-label': '功能表' });
  let openIndex = -1;
  const heads: HTMLButtonElement[] = [];
  const pop = h('div', { class: 'menu', role: 'menu' });
  pop.hidden = true;
  document.body.append(pop);

  const close = () => {
    if (openIndex < 0) return;
    heads[openIndex].classList.remove('on');
    heads[openIndex].setAttribute('aria-expanded', 'false');
    openIndex = -1;
    pop.hidden = true;
  };

  const items = () => [...pop.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];

  const open = (i: number, focusFirst = false) => {
    if (openIndex >= 0) {
      heads[openIndex].classList.remove('on');
      heads[openIndex].setAttribute('aria-expanded', 'false');
    }
    openIndex = i;
    heads[i].classList.add('on');
    heads[i].setAttribute('aria-expanded', 'true');
    pop.replaceChildren(
      ...menus[i].items.map((it) => {
        if (it === 'sep') return h('div', { class: 'menu-sep', role: 'separator' });
        const checked = it.checked?.();
        return h(
          'button',
          {
            class: 'menu-item',
            role: it.checked ? 'menuitemcheckbox' : 'menuitem',
            'aria-checked': it.checked ? String(!!checked) : undefined,
            disabled: it.enabled ? !it.enabled() : false,
            onclick: () => {
              close();
              it.action();
            },
          },
          h('span', { class: 'menu-mark' }, checked ? icon('check', 14) : it.icon ? icon(it.icon, 14) : ''),
          h('span', { class: 'menu-label' }, it.label),
          it.key ? h('kbd', {}, it.key) : '',
        );
      }),
    );
    pop.hidden = false;
    const r = heads[i].getBoundingClientRect();
    pop.style.left = `${r.left}px`;
    pop.style.top = `${r.bottom + 2}px`;
    if (focusFirst) items()[0]?.focus();
  };

  menus.forEach((m, i) => {
    const b = h(
      'button',
      {
        class: 'menu-head',
        role: 'menuitem',
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
        onclick: () => (openIndex === i ? close() : open(i)),
        onpointerenter: () => {
          if (openIndex >= 0 && openIndex !== i) open(i);
        },
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === 'ArrowDown') {
            open(i, true);
            e.preventDefault();
          } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            const next = (i + (e.key === 'ArrowRight' ? 1 : menus.length - 1)) % menus.length;
            heads[next].focus();
            if (openIndex >= 0) open(next);
            e.preventDefault();
          }
        },
      },
      m.label,
    );
    heads.push(b);
    bar.append(b);
  });

  pop.addEventListener('keydown', (e) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') list[(at + 1) % list.length]?.focus();
    else if (e.key === 'ArrowUp') list[(at + list.length - 1) % list.length]?.focus();
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const next = (openIndex + (e.key === 'ArrowRight' ? 1 : menus.length - 1)) % menus.length;
      open(next, true);
    } else if (e.key === 'Escape') {
      const head = heads[openIndex];
      close();
      head?.focus();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    if (openIndex >= 0 && !pop.contains(t) && !bar.contains(t)) close();
  });
  // 焦點還在功能表名稱上時，Esc 也要能關閉。
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || openIndex < 0) return;
      close();
      e.stopPropagation();
    },
    true,
  );
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);
  return bar;
}
