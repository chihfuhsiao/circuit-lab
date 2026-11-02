// 可拖曳調整的面板分隔線。大小記在這台電腦的瀏覽器裡。

import { h } from './dom';

const KEY = 'circuit-sim:layout';

interface Sizes {
  pal: number;
  side: number;
  scope: number;
}

const DEFAULTS: Sizes = { pal: 212, side: 304, scope: 188 };
const LIMITS: Record<keyof Sizes, [number, number]> = {
  pal: [150, 340],
  side: [240, 460],
  scope: [110, 420],
};

function load(): Sizes {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export class Panels {
  private sizes = load();

  constructor(private root: HTMLElement) {
    for (const k of Object.keys(LIMITS) as (keyof Sizes)[]) this.apply(k);
  }

  private apply(k: keyof Sizes): void {
    const [lo, hi] = LIMITS[k];
    this.sizes[k] = Math.max(lo, Math.min(hi, Number(this.sizes[k]) || DEFAULTS[k]));
    this.root.style.setProperty(`--${k}-size`, `${this.sizes[k]}px`);
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.sizes));
    } catch {
      // 瀏覽器不允許儲存時就略過。
    }
  }

  /** dir：拖曳方向每往正方向 1 像素，面板變大多少（1 或 -1）。 */
  handle(k: keyof Sizes, axis: 'x' | 'y', dir: 1 | -1, cls: string): HTMLElement {
    const el = h('div', {
      class: `split ${axis === 'x' ? 'split-x' : 'split-y'} ${cls}`,
      role: 'separator',
      'aria-orientation': axis === 'x' ? 'vertical' : 'horizontal',
      'data-tip': '拖曳調整大小，點兩下還原',
    });
    let start = 0;
    let base = 0;
    const move = (e: PointerEvent) => {
      this.sizes[k] = base + ((axis === 'x' ? e.clientX : e.clientY) - start) * dir;
      this.apply(k);
    };
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      start = axis === 'x' ? e.clientX : e.clientY;
      base = this.sizes[k];
      el.classList.add('drag');
      el.addEventListener('pointermove', move);
      e.preventDefault();
    });
    const end = () => {
      el.classList.remove('drag');
      el.removeEventListener('pointermove', move);
      this.save();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('dblclick', () => {
      this.sizes[k] = DEFAULTS[k];
      this.apply(k);
      this.save();
    });
    return el;
  }
}
