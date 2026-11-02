// 工具提示：滑鼠停在有 data-tip 的元素上時顯示，data-key 是快捷鍵。

import { h } from './dom';

const DELAY = 350;

export function initTips(): void {
  const box = h('div', { class: 'tip', role: 'tooltip' });
  box.hidden = true;
  document.body.append(box);
  let timer: number | undefined;
  let target: HTMLElement | null = null;

  const hide = () => {
    clearTimeout(timer);
    target = null;
    box.hidden = true;
  };

  const show = () => {
    if (!target || !target.isConnected) return hide();
    const key = target.dataset.key;
    box.replaceChildren(target.dataset.tip ?? '', ...(key ? [h('kbd', {}, key)] : []));
    box.hidden = false;
    const r = target.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    let x = r.left + r.width / 2 - b.width / 2;
    let y = r.bottom + 6;
    if (y + b.height > window.innerHeight - 4) y = r.top - b.height - 6;
    x = Math.max(6, Math.min(x, window.innerWidth - b.width - 6));
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
  };

  document.addEventListener('pointerover', (e) => {
    const el = (e.target as Element | null)?.closest?.<HTMLElement>('[data-tip]') ?? null;
    if (el === target) return;
    hide();
    if (!el || e.pointerType === 'touch') return;
    target = el;
    timer = window.setTimeout(show, DELAY);
  });
  document.addEventListener('pointerdown', hide);
  window.addEventListener('blur', hide);
}
