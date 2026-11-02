// 畫布與主迴圈：把滑鼠事件轉給目前的編輯器，並每幀推進模擬、重畫。

import { App } from '../app';
import { BreadboardView } from '../view/breadboard';
import { EditorView, PointerInfo, zoomAt } from '../view/common';
import { SchematicView } from '../view/schematic';
import { h } from './dom';

export class Stage {
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly sch: SchematicView;
  readonly bb: BreadboardView;
  private ctx: CanvasRenderingContext2D;
  private last = 0;
  private fitted = { sch: false, bb: false };
  private onFrame: (() => void)[] = [];
  private spaceDown = false;

  constructor(private app: App) {
    this.sch = new SchematicView(app);
    this.bb = new BreadboardView(app);
    this.canvas = h('canvas', { 'aria-label': '電路畫布' });
    this.canvas.tabIndex = 0;
    this.ctx = this.canvas.getContext('2d')!;
    this.el = h('div', { class: 'stage' }, this.canvas);
    this.bindEvents();
    app.on((e) => {
      // 載入新電路時才重新對準；切換畫面要保留原本的縮放位置。
      if (e === 'loaded') {
        this.fitted = { sch: false, bb: false };
        this.fitLater();
      }
    });
    requestAnimationFrame((t) => this.frame(t));
  }

  get view(): EditorView {
    return this.app.view === 'sch' ? this.sch : this.bb;
  }

  addFrameCallback(fn: () => void): void {
    this.onFrame.push(fn);
  }

  fitLater(): void {
    requestAnimationFrame(() => this.fit());
  }

  fit(): void {
    const r = this.canvas.getBoundingClientRect();
    if (r.width > 0) {
      this.view.fit(r.width, r.height);
      this.fitted[this.app.view] = true;
    }
  }

  /** 放置元件。compId 表示放置已存在、但還沒放到這個畫面的元件。 */
  beginPlace(type: string, compId?: string): void {
    (this.view as SchematicView | BreadboardView).beginPlace(type, compId);
    this.canvas.focus();
  }

  private info(e: PointerEvent): PointerInfo {
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const cam = this.view.cam;
    return {
      sx,
      sy,
      wx: (sx - cam.x) / cam.zoom,
      wy: (sy - cam.y) / cam.zoom,
      button: e.button,
      shift: e.shiftKey,
      ctrl: e.ctrlKey || e.metaKey,
      touch: e.pointerType === 'touch',
    };
  }

  private bindEvents(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      c.focus({ preventScroll: true });
      this.view.pointerDown(this.info(e));
      e.preventDefault();
    });
    c.addEventListener('pointermove', (e) => this.view.pointerMove(this.info(e)));
    c.addEventListener('pointerup', (e) => this.view.pointerUp(this.info(e)));
    c.addEventListener('pointerleave', () => this.view.pointerLeave());
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        zoomAt(this.view.cam, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0012));
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      if (e.key === ' ' && !isTyping(e)) {
        this.setSpace(true);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ') this.setSpace(false);
    });
  }

  private setSpace(v: boolean): void {
    this.spaceDown = v;
    this.sch.spaceDown = v;
    this.bb.spaceDown = v;
  }

  private frame(t: number): void {
    const realDt = this.last ? (t - this.last) / 1000 : 0;
    this.last = t;
    this.app.tick(realDt);

    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(r.width * dpr);
    const hh = Math.round(r.height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== hh) {
      this.canvas.width = w;
      this.canvas.height = hh;
    }
    if (r.width > 0 && !this.fitted[this.app.view]) this.fit();
    this.view.draw(this.ctx, r.width, r.height, dpr);
    this.canvas.style.cursor = this.view.cursor();
    for (const fn of this.onFrame) fn();
    requestAnimationFrame((n) => this.frame(n));
  }
}

export function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
