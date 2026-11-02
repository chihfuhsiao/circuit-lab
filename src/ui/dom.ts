// 小小的 DOM 工具，介面不需要框架。

import { icon } from './icons';

type Attrs = Record<string, unknown> & { class?: string; onclick?: (e: MouseEvent) => void };
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k in el && k !== 'list') {
      (el as unknown as Record<string, unknown>)[k] = v;
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c);
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

export function toast(text: string): void {
  const t = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

export function modal(title: string, body: (Node | string)[], actions: { label: string; primary?: boolean; onclick?: () => void }[] = [{ label: '關閉', primary: true }]): void {
  const close = () => back.remove();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
  const back = h(
    'div',
    { class: 'modal-back', onclick: (e: MouseEvent) => e.target === back && close() },
    h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'tb', 'aria-label': '關閉', onclick: close }, icon('close'))),
      h('div', { class: 'modal-body' }, ...body),
      h(
        'div',
        { class: 'modal-actions' },
        actions.map((a) =>
          h(
            'button',
            {
              class: `btn${a.primary ? ' primary' : ''}`,
              onclick: () => {
                close();
                a.onclick?.();
              },
            },
            a.label,
          ),
        ),
      ),
    ),
  );
  document.body.append(back);
}
