// 電路圖編輯器：放元件、拉線、選取、移動，以及模擬結果的顯示。

import { App, SCOPE_COLORS } from '../app';
import { compLabel, getDef } from '../circuit/catalog';
import { pinCurrent, pinVoltage, vertexVoltage } from '../circuit/compile';
import { addComp, addSchWire, removeComp } from '../circuit/doc';
import { formatValue } from '../circuit/format';
import { normalizeWire, schPinPos } from '../circuit/topology';
import { Comp, pinKey, Point, SchPlace, SchWire } from '../circuit/types';
import {
  alpha,
  Camera,
  CANVAS_BG,
  DOT_SPACING,
  dotSpeed,
  drawDotsOnLine,
  drawPill,
  drawSelectBox,
  drawTooltip,
  EditorView,
  ERROR,
  fitCamera,
  FONT,
  G,
  GRID_DOT,
  GRID_MAJOR,
  INK,
  INK_SOFT,
  PAPER,
  PointerInfo,
  SELECT,
  voltColor,
} from './common';
import { drawSymbol, labelAnchor } from './symbols';

type Mode =
  | { kind: 'idle' }
  | { kind: 'place'; type: string; compId?: string; rot: number; x: number; y: number }
  | {
      kind: 'drag';
      startX: number;
      startY: number;
      moved: boolean;
      comps: Map<string, SchPlace>;
      wires: Map<string, Point[]>;
      attach: { wireId: string; end: 0 | 1; compId: string; pin: number }[];
      clickId?: string;
      pressed?: string;
    }
  | { kind: 'wire'; pts: Point[]; cur: Point; sticky: boolean; horizFirst: boolean | null }
  | { kind: 'box'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'pan'; sx: number; sy: number; cx: number; cy: number };

/** 移動導線一端，盡量維持原本的走向。 */
function moveWireEnd(pts: Point[], end: 0 | 1, to: Point): Point[] {
  const out = pts.map((p) => [p[0], p[1]] as Point);
  const i = end === 0 ? 0 : out.length - 1;
  const j = end === 0 ? 1 : out.length - 2;
  if (out.length >= 3) {
    const horizontal = out[i][1] === out[j][1];
    if (horizontal) out[j][1] = to[1];
    else out[j][0] = to[0];
  }
  out[i] = [to[0], to[1]];
  return out;
}

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export class SchematicView implements EditorView {
  cam: Camera = { x: 300, y: 240, zoom: 1 };
  private mode: Mode = { kind: 'idle' };
  private mouse: PointerInfo | null = null;
  private compPhase = new Map<string, number>();
  spaceDown = false;

  constructor(private app: App) {}

  // ---- 命中判定 ----

  private snap(wx: number, wy: number): Point {
    return [Math.round(wx / G), Math.round(wy / G)];
  }

  private pinAt(wx: number, wy: number): { comp: Comp; pin: number; pos: Point } | null {
    let best: { comp: Comp; pin: number; pos: Point } | null = null;
    let bestD = 10;
    for (const c of this.app.doc.comps) {
      if (!c.sch) continue;
      const pins = getDef(c.type).pins;
      for (let i = 0; i < pins.length; i++) {
        const pos = schPinPos(c, i);
        const d = Math.hypot(pos[0] * G - wx, pos[1] * G - wy);
        if (d < bestD) {
          bestD = d;
          best = { comp: c, pin: i, pos };
        }
      }
    }
    return best;
  }

  private wireEndAt(wx: number, wy: number): Point | null {
    for (const w of this.app.doc.schWires) {
      for (const p of [w.pts[0], w.pts[w.pts.length - 1]]) {
        if (Math.hypot(p[0] * G - wx, p[1] * G - wy) < 8) return p;
      }
    }
    return null;
  }

  private compAt(wx: number, wy: number): Comp | null {
    const comps = this.app.doc.comps;
    for (let i = comps.length - 1; i >= 0; i--) {
      const c = comps[i];
      if (!c.sch) continue;
      const s = getDef(c.type).sch;
      if (!s) continue;
      const vertical = c.sch.rot % 2 === 1;
      const hw = (vertical ? s.hh : s.hw) * G;
      const hh = (vertical ? s.hw : s.hh) * G;
      const cy = c.sch.y * G + (c.type === 'gnd' ? 12 * (c.sch.rot === 0 ? 1 : 0) : 0);
      if (Math.abs(wx - c.sch.x * G) <= hw && Math.abs(wy - cy) <= hh) return c;
    }
    return null;
  }

  private wireAt(wx: number, wy: number): SchWire | null {
    const tol = 6 / this.cam.zoom + 2;
    for (const w of this.app.doc.schWires) {
      for (let i = 0; i + 1 < w.pts.length; i++) {
        const [a, b] = [w.pts[i], w.pts[i + 1]];
        if (distToSeg(wx, wy, a[0] * G, a[1] * G, b[0] * G, b[1] * G) < tol) return w;
      }
    }
    return null;
  }

  /** 由畫面位置找到可量測的腳（探棒用）。 */
  private probeTarget(wx: number, wy: number): { compId: string; pin: number } | null {
    const pin = this.pinAt(wx, wy);
    if (pin) return { compId: pin.comp.id, pin: pin.pin };
    const w = this.wireAt(wx, wy);
    if (w) {
      const c = this.app.compiled;
      const edge = c.topo.edges.find((e) => e.wireId === w.id);
      if (edge) {
        const net = c.nets.vertexNet.get(edge.a);
        if (net !== undefined && c.nets.pins[net].length) return c.nets.pins[net][0];
      }
    }
    const comp = this.compAt(wx, wy);
    if (comp) return { compId: comp.id, pin: 0 };
    return null;
  }

  // ---- 操作 ----

  beginPlace(type: string, compId?: string): void {
    this.app.setTool('select');
    const m = this.mouse;
    const [x, y] = m ? this.snap(m.wx, m.wy) : [0, 0];
    this.mode = { kind: 'place', type, compId, rot: getDef(type).sch?.rot ?? 0, x, y };
  }

  cancel(): void {
    this.mode = { kind: 'idle' };
  }

  private cursorKind(): string {
    const m = this.mode;
    if (m.kind === 'pan') return 'grabbing';
    if (m.kind === 'place' || m.kind === 'wire') return 'crosshair';
    if (m.kind === 'drag') return 'move';
    if (this.app.tool === 'probe' || this.app.tool === 'wire') return 'crosshair';
    if (this.spaceDown) return 'grab';
    const p = this.mouse;
    if (p) {
      if (this.pinAt(p.wx, p.wy)) return 'crosshair';
      if (this.compAt(p.wx, p.wy)) return 'pointer';
      if (this.wireAt(p.wx, p.wy)) return 'pointer';
    }
    return 'default';
  }
  cursor(): string {
    return this.cursorKind();
  }

  pointerDown(p: PointerInfo): void {
    this.mouse = p;
    const app = this.app;
    if (p.button === 1 || p.button === 2 || this.spaceDown) {
      this.mode = { kind: 'pan', sx: p.sx, sy: p.sy, cx: this.cam.x, cy: this.cam.y };
      return;
    }
    const m = this.mode;

    if (m.kind === 'place') {
      const [x, y] = this.snap(p.wx, p.wy);
      const place = { x, y, rot: m.rot };
      let comp: Comp;
      if (m.compId) {
        comp = app.doc.comps.find((c) => c.id === m.compId)!;
        comp.sch = place;
      } else {
        comp = addComp(app.doc, m.type, { sch: place });
      }
      app.select([comp.id]);
      app.commit();
      // 按住 Shift 可以連續放置。
      this.mode = p.shift && !m.compId ? { kind: 'place', type: m.type, rot: m.rot, x, y } : { kind: 'idle' };
      return;
    }

    if (m.kind === 'wire') {
      // 點選模式：點到腳或導線就結束，點到空白處就加一個轉折。
      const [x, y] = this.snap(p.wx, p.wy);
      m.cur = [x, y];
      const onTarget = this.pinAt(p.wx, p.wy) || this.wireAt(p.wx, p.wy);
      if (onTarget) {
        this.finishWire();
      } else {
        m.pts = this.routed(m);
        m.horizFirst = null;
      }
      return;
    }

    if (app.tool === 'probe') {
      const t = this.probeTarget(p.wx, p.wy);
      if (t) {
        app.addProbe(t.compId, t.pin);
        app.setTool('select');
      }
      return;
    }

    if (app.tool === 'wire') {
      const start = this.snap(p.wx, p.wy);
      this.mode = { kind: 'wire', pts: [start], cur: start, sticky: false, horizFirst: null };
      return;
    }

    const pin = this.pinAt(p.wx, p.wy);
    if (pin) {
      this.mode = { kind: 'wire', pts: [pin.pos], cur: pin.pos, sticky: false, horizFirst: null };
      return;
    }
    const end = this.wireEndAt(p.wx, p.wy);
    if (end) {
      this.mode = { kind: 'wire', pts: [[end[0], end[1]]], cur: [end[0], end[1]], sticky: false, horizFirst: null };
      return;
    }

    const comp = this.compAt(p.wx, p.wy);
    if (comp) {
      if (!app.selection.has(comp.id)) app.select([comp.id], p.shift);
      else if (p.shift) {
        app.selection.delete(comp.id);
        app.emit('selection');
      }
      let pressed: string | undefined;
      if (comp.type === 'push') {
        comp.params.closed = true;
        app.transient();
        pressed = comp.id;
      }
      this.startDrag(p, comp.id, pressed);
      return;
    }

    const wire = this.wireAt(p.wx, p.wy);
    if (wire) {
      if (!app.selection.has(wire.id)) app.select([wire.id], p.shift);
      this.startDrag(p);
      return;
    }

    if (!p.shift) app.select([]);
    if (p.touch) this.mode = { kind: 'pan', sx: p.sx, sy: p.sy, cx: this.cam.x, cy: this.cam.y };
    else this.mode = { kind: 'box', x0: p.wx, y0: p.wy, x1: p.wx, y1: p.wy };
  }

  private startDrag(p: PointerInfo, clickId?: string, pressed?: string): void {
    const app = this.app;
    const comps = new Map<string, SchPlace>();
    const wires = new Map<string, Point[]>();
    const attach: { wireId: string; end: 0 | 1; compId: string; pin: number }[] = [];
    for (const c of app.doc.comps) if (c.sch && app.selection.has(c.id)) comps.set(c.id, { ...c.sch });
    for (const w of app.doc.schWires) {
      const selected = app.selection.has(w.id);
      if (selected) wires.set(w.id, w.pts.map((q) => [q[0], q[1]] as Point));
      if (selected) continue;
      for (const c of app.doc.comps) {
        if (!comps.has(c.id)) continue;
        getDef(c.type).pins.forEach((_, i) => {
          const pos = schPinPos(c, i);
          const first = w.pts[0];
          const last = w.pts[w.pts.length - 1];
          if (first[0] === pos[0] && first[1] === pos[1]) attach.push({ wireId: w.id, end: 0, compId: c.id, pin: i });
          if (last[0] === pos[0] && last[1] === pos[1]) attach.push({ wireId: w.id, end: 1, compId: c.id, pin: i });
        });
      }
      if (attach.some((a) => a.wireId === w.id)) wires.set(w.id, w.pts.map((q) => [q[0], q[1]] as Point));
    }
    const [sx, sy] = this.snap(p.wx, p.wy);
    this.mode = { kind: 'drag', startX: sx, startY: sy, moved: false, comps, wires, attach, clickId, pressed };
  }

  private routed(m: Extract<Mode, { kind: 'wire' }>): Point[] {
    const last = m.pts[m.pts.length - 1];
    const [cx, cy] = m.cur;
    if (last[0] === cx || last[1] === cy) return [...m.pts, [cx, cy]];
    const horiz = m.horizFirst ?? Math.abs(cx - last[0]) >= Math.abs(cy - last[1]);
    const corner: Point = horiz ? [cx, last[1]] : [last[0], cy];
    return [...m.pts, corner, [cx, cy]];
  }

  private finishWire(): void {
    const m = this.mode;
    if (m.kind !== 'wire') return;
    const pts = normalizeWire(this.routed(m));
    this.mode = { kind: 'idle' };
    if (pts.length >= 2) {
      const w = addSchWire(this.app.doc, pts);
      this.app.commit();
      void w;
    }
  }

  pointerMove(p: PointerInfo): void {
    this.mouse = p;
    const m = this.mode;
    const app = this.app;
    switch (m.kind) {
      case 'place': {
        [m.x, m.y] = this.snap(p.wx, p.wy);
        break;
      }
      case 'wire': {
        const cur = this.snap(p.wx, p.wy);
        const last = m.pts[m.pts.length - 1];
        if (m.horizFirst === null && (cur[0] !== last[0] || cur[1] !== last[1])) {
          m.horizFirst = Math.abs(cur[0] - last[0]) >= Math.abs(cur[1] - last[1]);
        }
        m.cur = cur;
        break;
      }
      case 'drag': {
        const [x, y] = this.snap(p.wx, p.wy);
        const dx = x - m.startX;
        const dy = y - m.startY;
        if (!m.moved && dx === 0 && dy === 0) break;
        m.moved = true;
        for (const c of app.doc.comps) {
          const o = m.comps.get(c.id);
          if (o) c.sch = { ...o, x: o.x + dx, y: o.y + dy };
        }
        for (const w of app.doc.schWires) {
          const o = m.wires.get(w.id);
          if (!o) continue;
          if (app.selection.has(w.id)) {
            w.pts = o.map((q) => [q[0] + dx, q[1] + dy] as Point);
          } else {
            let pts = o;
            for (const a of m.attach) {
              if (a.wireId !== w.id) continue;
              const comp = app.doc.comps.find((c) => c.id === a.compId)!;
              pts = moveWireEnd(pts, a.end, schPinPos(comp, a.pin));
            }
            w.pts = normalizeWire(pts);
          }
        }
        app.rebuild();
        break;
      }
      case 'box': {
        m.x1 = p.wx;
        m.y1 = p.wy;
        break;
      }
      case 'pan': {
        this.cam.x = m.cx + (p.sx - m.sx);
        this.cam.y = m.cy + (p.sy - m.sy);
        break;
      }
    }
  }

  pointerUp(p: PointerInfo): void {
    this.mouse = p;
    const m = this.mode;
    const app = this.app;
    switch (m.kind) {
      case 'wire': {
        if (m.sticky) return;
        const cur = this.snap(p.wx, p.wy);
        const start = m.pts[0];
        if (m.pts.length === 1 && cur[0] === start[0] && cur[1] === start[1]) {
          // 沒有拖曳：改成點一下、再點一下的接線方式，平板也好操作。
          m.sticky = true;
          return;
        }
        m.cur = cur;
        this.finishWire();
        break;
      }
      case 'drag': {
        this.mode = { kind: 'idle' };
        if (m.pressed) {
          const comp = app.doc.comps.find((c) => c.id === m.pressed);
          if (comp) comp.params.closed = false;
          app.transient();
        }
        if (m.moved) {
          app.doc.schWires = app.doc.schWires.filter((w) => w.pts.length >= 2);
          app.commit();
        } else if (m.clickId) {
          const comp = app.doc.comps.find((c) => c.id === m.clickId);
          if (comp?.type === 'sw') {
            comp.params.closed = comp.params.closed !== true;
            app.transient();
            app.emit('selection');
          } else if (comp?.type === 'lin') {
            comp.params.high = comp.params.high !== true;
            app.transient();
            app.emit('selection');
          }
        }
        break;
      }
      case 'box': {
        this.mode = { kind: 'idle' };
        const x0 = Math.min(m.x0, m.x1);
        const x1 = Math.max(m.x0, m.x1);
        const y0 = Math.min(m.y0, m.y1);
        const y1 = Math.max(m.y0, m.y1);
        if (x1 - x0 > 4 || y1 - y0 > 4) {
          const ids: string[] = [];
          for (const c of app.doc.comps) {
            if (c.sch && c.sch.x * G >= x0 && c.sch.x * G <= x1 && c.sch.y * G >= y0 && c.sch.y * G <= y1) ids.push(c.id);
          }
          for (const w of app.doc.schWires) {
            if (w.pts.every((q) => q[0] * G >= x0 && q[0] * G <= x1 && q[1] * G >= y0 && q[1] * G <= y1)) ids.push(w.id);
          }
          app.select(ids, p.shift);
        }
        break;
      }
      case 'pan':
        this.mode = { kind: 'idle' };
        break;
    }
  }

  pointerLeave(): void {
    this.mouse = null;
  }

  keyDown(e: KeyboardEvent): boolean {
    const app = this.app;
    const key = e.key.toLowerCase();
    if (key === 'escape') {
      if (this.mode.kind === 'wire' || this.mode.kind === 'place') {
        this.mode = { kind: 'idle' };
        return true;
      }
      if (app.tool !== 'select') {
        app.setTool('select');
        return true;
      }
      app.select([]);
      return true;
    }
    if (key === 'r' && !e.ctrlKey && !e.metaKey) {
      if (this.mode.kind === 'place') {
        this.mode.rot = (this.mode.rot + 1) % 4;
        return true;
      }
      return this.rotateSelection();
    }
    if (key === 'delete' || key === 'backspace') {
      return this.deleteSelection();
    }
    return false;
  }

  private rotateSelection(): boolean {
    const app = this.app;
    const comps = app.doc.comps.filter((c) => c.sch && app.selection.has(c.id));
    if (!comps.length) return false;
    for (const c of comps) {
      const before = getDef(c.type).pins.map((_, i) => schPinPos(c, i));
      c.sch!.rot = (c.sch!.rot + 1) % 4;
      const after = getDef(c.type).pins.map((_, i) => schPinPos(c, i));
      // 接在腳上的導線跟著移動。
      for (const w of app.doc.schWires) {
        before.forEach((pos, i) => {
          const first = w.pts[0];
          const last = w.pts[w.pts.length - 1];
          if (first[0] === pos[0] && first[1] === pos[1]) w.pts = normalizeWire(moveWireEnd(w.pts, 0, after[i]));
          else if (last[0] === pos[0] && last[1] === pos[1]) w.pts = normalizeWire(moveWireEnd(w.pts, 1, after[i]));
        });
      }
    }
    app.commit();
    return true;
  }

  private deleteSelection(): boolean {
    const app = this.app;
    if (!app.selection.size) return false;
    app.doc.schWires = app.doc.schWires.filter((w) => !app.selection.has(w.id));
    for (const c of [...app.doc.comps]) {
      if (!app.selection.has(c.id)) continue;
      // 麵包板上也有的元件，只把它從電路圖拿掉。
      if (c.bb) delete c.sch;
      else removeComp(app.doc, c.id);
    }
    app.selection.clear();
    app.commit();
    app.emit('selection');
    return true;
  }

  fit(w: number, h: number): void {
    const doc = this.app.doc;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const add = (x: number, y: number) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    };
    for (const c of doc.comps) {
      if (!c.sch) continue;
      const s = getDef(c.type).sch;
      if (!s) continue;
      const hw = (c.sch.rot % 2 ? s.hh : s.hw) * G + 20;
      const hh = (c.sch.rot % 2 ? s.hw : s.hh) * G + 24;
      add(c.sch.x * G - hw, c.sch.y * G - hh);
      add(c.sch.x * G + hw, c.sch.y * G + hh);
    }
    for (const wire of doc.schWires) for (const q of wire.pts) add(q[0] * G, q[1] * G);
    if (minX === Infinity) {
      this.cam.x = w / 2;
      this.cam.y = h / 2;
      this.cam.zoom = 1;
      return;
    }
    fitCamera(this.cam, minX, minY, maxX, maxY, w, h);
  }

  // ---- 繪製 ----

  draw(g: CanvasRenderingContext2D, w: number, h: number, dpr: number): void {
    const app = this.app;
    const cam = this.cam;
    const c = app.compiled;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = CANVAS_BG;
    g.fillRect(0, 0, w, h);

    // 格點
    if (cam.zoom > 0.45) {
      g.fillStyle = GRID_DOT;
      const step = G * cam.zoom;
      const ox = ((cam.x % step) + step) % step;
      const oy = ((cam.y % step) + step) % step;
      const r = Math.max(1, 1.2 * cam.zoom);
      for (let x = ox; x < w; x += step) for (let y = oy; y < h; y += step) g.fillRect(x - r / 2, y - r / 2, r, r);
    }
    // 每 5 格一個十字，方便對齊
    if (cam.zoom > 0.3) {
      const step = G * 5 * cam.zoom;
      const ox = ((cam.x % step) + step) % step;
      const oy = ((cam.y % step) + step) % step;
      const arm = 3;
      g.strokeStyle = GRID_MAJOR;
      g.lineWidth = 1;
      g.beginPath();
      for (let x = ox; x < w; x += step) {
        for (let y = oy; y < h; y += step) {
          const px = Math.round(x) + 0.5;
          const py = Math.round(y) + 0.5;
          g.moveTo(px - arm, py);
          g.lineTo(px + arm, py);
          g.moveTo(px, py - arm);
          g.lineTo(px, py + arm);
        }
      }
      g.stroke();
    }

    g.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * cam.x, dpr * cam.y);

    const netColor = (vertex: string) => {
      const v = vertexVoltage(c, vertex);
      return v === null ? INK : voltColor(v, app.vmax);
    };

    // 導線
    g.lineWidth = 2;
    g.lineCap = 'round';
    for (const e of c.topo.edges) {
      if (app.selection.has(e.wireId)) {
        g.strokeStyle = SELECT;
        g.lineWidth = 5;
        g.globalAlpha = 0.3;
        g.beginPath();
        g.moveTo(e.pa[0] * G, e.pa[1] * G);
        g.lineTo(e.pb[0] * G, e.pb[1] * G);
        g.stroke();
        g.globalAlpha = 1;
        g.lineWidth = 2;
      }
      g.strokeStyle = netColor(e.a);
      g.beginPath();
      g.moveTo(e.pa[0] * G, e.pa[1] * G);
      g.lineTo(e.pb[0] * G, e.pb[1] * G);
      g.stroke();
    }

    // 接點：三條以上的線或腳交會處
    const degree = new Map<string, number>();
    for (const e of c.topo.edges) {
      degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
      degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
    }
    for (const v of c.topo.pinVertex.values()) degree.set(v, (degree.get(v) ?? 0) + 1);
    for (const [v, d] of degree) {
      if (d < 3 || v.startsWith('__')) continue;
      const [x, y] = v.split(',').map(Number);
      g.fillStyle = netColor(v);
      g.beginPath();
      g.arc(x * G, y * G, 3.6, 0, Math.PI * 2);
      g.fill();
    }

    // 元件
    const errors = app.errorComps();
    const hoverPin = this.mouse && this.mode.kind !== 'pan' ? this.pinAt(this.mouse.wx, this.mouse.wy) : null;
    for (const comp of app.doc.comps) {
      if (!comp.sch || !getDef(comp.type).sch) continue;
      this.drawComp(g, comp, errors.has(comp.id));
    }

    // 電流動畫
    const dt = app.frameDt;
    for (let i = 0; i < c.topo.edges.length; i++) {
      const e = c.topo.edges[i];
      const speed = dotSpeed(c.edgeCurrents[i]);
      if (speed === 0) continue;
      c.edgePhase[i] = (c.edgePhase[i] + speed * dt) % DOT_SPACING;
      drawDotsOnLine(g, e.pa[0] * G, e.pa[1] * G, e.pb[0] * G, e.pb[1] * G, c.edgePhase[i]);
    }
    for (const comp of app.doc.comps) {
      if (!comp.sch || getDef(comp.type).pins.length !== 2) continue;
      if (comp.type === 'meter' || !c.devices.has(comp.id)) continue;
      const speed = dotSpeed(pinCurrent(c, comp.id, 0));
      if (speed === 0) continue;
      const ph = ((this.compPhase.get(comp.id) ?? 0) + speed * dt) % DOT_SPACING;
      this.compPhase.set(comp.id, ph);
      const a = schPinPos(comp, 0);
      const b = schPinPos(comp, 1);
      drawDotsOnLine(g, a[0] * G, a[1] * G, b[0] * G, b[1] * G, ph);
    }

    // 節點電壓
    if (app.showVolts && (app.running || c.sim.time > 0)) this.drawVoltages(g);

    // 示波器探棒標記
    app.doc.probes.forEach((probe, i) => {
      const comp = app.doc.comps.find((x) => x.id === probe.compId);
      if (!comp?.sch) return;
      const pos = schPinPos(comp, probe.pin);
      g.fillStyle = SCOPE_COLORS[i];
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(pos[0] * G, pos[1] * G, 6, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#fff';
      g.font = `700 8px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(i + 1), pos[0] * G, pos[1] * G + 0.5);
    });

    // 目前游標下的腳
    if (hoverPin && this.mode.kind !== 'drag') {
      g.strokeStyle = SELECT;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(hoverPin.pos[0] * G, hoverPin.pos[1] * G, 6, 0, Math.PI * 2);
      g.stroke();
    }

    this.drawModeOverlay(g);

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!app.doc.comps.some((x) => x.sch) && this.mode.kind === 'idle') this.drawEmptyHint(g, w, h);
    this.drawHover(g, w, h);
  }

  private drawEmptyHint(g: CanvasRenderingContext2D, w: number, h: number): void {
    g.fillStyle = INK_SOFT;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `600 17px ${FONT}`;
    g.fillText('從左邊選一個元件，再點這裡放置', w / 2, h / 2 - 14);
    g.font = `14px ${FONT}`;
    g.fillText('從元件的腳拖曳到另一隻腳就能接線　・　也可以從右邊的「範例」或「實驗」開始', w / 2, h / 2 + 14);
  }

  private drawComp(g: CanvasRenderingContext2D, comp: Comp, isError: boolean): void {
    const app = this.app;
    const c = app.compiled;
    const def = getDef(comp.type);
    const sch = def.sch!;
    const place = comp.sch!;
    const vertical = place.rot % 2 === 1;
    const hw = (vertical ? sch.hh : sch.hw) * G;
    const hh = (vertical ? sch.hw : sch.hh) * G;

    if (app.selection.has(comp.id) || isError) {
      drawSelectBox(g, place.x * G - hw - 5, place.y * G - hh - 5, hw * 2 + 10, hh * 2 + 10, isError ? ERROR : SELECT);
    }

    const live = c.sim.time > 0;
    drawSymbol(g, comp, {
      lead: (pin) => (live ? voltColor(pinVoltage(c, comp.id, pin), app.vmax) : INK),
      volt: (pin) => pinVoltage(c, comp.id, pin),
      dev: c.devices.get(comp.id),
      live,
    });

    // 還沒接線的腳畫成空心圓
    def.pins.forEach((pin, i) => {
      const net = c.nets.pinNet.get(pinKey(comp.id, i));
      if (net === undefined || c.nets.pins[net].length > 1 || comp.type === 'gnd') return;
      const hasEdge = c.topo.edges.some((e) => e.a === c.topo.pinVertex.get(pinKey(comp.id, i)) || e.b === c.topo.pinVertex.get(pinKey(comp.id, i)));
      if (hasEdge) return;
      const pos = schPinPos(comp, i);
      g.fillStyle = PAPER;
      g.strokeStyle = pin.optional ? INK_SOFT : ERROR;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(pos[0] * G, pos[1] * G, 3.4, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    });

    const label = compLabel(comp, (v, u) => formatValue(v, u));
    const a = labelAnchor(comp);
    g.textAlign = a.align;
    g.textBaseline = 'middle';
    if (a.align === 'center' && comp.type !== 'rail') {
      g.font = `600 12px ${FONT}`;
      g.fillStyle = INK;
      const refW = g.measureText(comp.ref).width;
      g.font = `12px ${FONT}`;
      const valW = label ? g.measureText(label).width + 6 : 0;
      const start = a.x - (refW + valW) / 2;
      g.textAlign = 'left';
      g.font = `600 12px ${FONT}`;
      g.fillText(comp.ref, start, a.y);
      if (label) {
        g.font = `12px ${FONT}`;
        g.fillStyle = INK_SOFT;
        g.fillText(label, start + refW + 6, a.y);
      }
    } else if (comp.type === 'rail') {
      g.font = `600 12px ${FONT}`;
      g.fillStyle = INK;
      g.fillText(label, a.x, a.y);
    } else if (comp.type !== 'gnd') {
      g.font = `600 12px ${FONT}`;
      g.fillStyle = INK;
      g.fillText(comp.ref, a.x, a.y);
      if (label) {
        g.font = `12px ${FONT}`;
        g.fillStyle = INK_SOFT;
        g.fillText(label, a.x, a.y + 15);
      }
    }
  }

  private drawVoltages(g: CanvasRenderingContext2D): void {
    const app = this.app;
    const c = app.compiled;
    const best = new Map<number, { len: number; x: number; y: number }>();
    const railComps = new Set(c.topo.comps.filter((x) => x.type === 'rail').map((x) => x.id));
    for (const e of c.topo.edges) {
      const net = c.nets.vertexNet.get(e.a);
      if (net === undefined) continue;
      if (c.netNode[net] === 0) continue;
      // 電源標籤旁邊已經寫了電壓，不必重複。
      if (c.nets.pins[net].some((p) => railComps.has(p.compId))) continue;
      const len = Math.hypot(e.pa[0] - e.pb[0], e.pa[1] - e.pb[1]);
      const cur = best.get(net);
      if (!cur || len > cur.len) best.set(net, { len, x: ((e.pa[0] + e.pb[0]) / 2) * G, y: ((e.pa[1] + e.pb[1]) / 2) * G });
    }
    for (const [net, b] of best) {
      // 太小的值是數值雜訊，顯示 0 才不會讓學生困惑。
      const raw = c.sim.v(c.netNode[net]);
      const v = Math.abs(raw) < 1e-6 ? 0 : raw;
      drawPill(g, formatValue(v, 'V', 3), b.x, b.y - 11, voltColor(v, app.vmax));
    }
  }

  private drawModeOverlay(g: CanvasRenderingContext2D): void {
    const m = this.mode;
    const app = this.app;
    if (m.kind === 'place') {
      const comp: Comp = {
        id: '_ghost',
        type: m.type,
        ref: '',
        params: m.compId ? app.doc.comps.find((c) => c.id === m.compId)!.params : Object.fromEntries(getDef(m.type).params.map((p) => [p.key, p.def])),
        sch: { x: m.x, y: m.y, rot: m.rot },
      };
      g.globalAlpha = 0.65;
      drawSymbol(g, comp, { lead: () => SELECT, volt: () => 0, live: false });
      g.globalAlpha = 1;
    } else if (m.kind === 'wire') {
      const pts = this.routed(m);
      g.strokeStyle = SELECT;
      g.lineWidth = 2;
      g.setLineDash([6, 4]);
      g.beginPath();
      pts.forEach((q, i) => (i ? g.lineTo(q[0] * G, q[1] * G) : g.moveTo(q[0] * G, q[1] * G)));
      g.stroke();
      g.setLineDash([]);
      const end = pts[pts.length - 1];
      g.fillStyle = SELECT;
      g.beginPath();
      g.arc(end[0] * G, end[1] * G, 3.5, 0, Math.PI * 2);
      g.fill();
    } else if (m.kind === 'box') {
      g.strokeStyle = SELECT;
      g.fillStyle = alpha(SELECT, 0.1);
      g.lineWidth = 1;
      g.beginPath();
      g.rect(m.x0, m.y0, m.x1 - m.x0, m.y1 - m.y0);
      g.fill();
      g.stroke();
    }
  }

  private drawHover(g: CanvasRenderingContext2D, w: number, h: number): void {
    const p = this.mouse;
    const app = this.app;
    if (!p || this.mode.kind !== 'idle') return;
    const c = app.compiled;
    const lines: string[] = [];
    const pin = this.pinAt(p.wx, p.wy);
    if (app.tool === 'probe') {
      lines.push('點導線或腳，加入示波器探棒');
    } else if (pin) {
      const name = getDef(pin.comp.type).pins[pin.pin].name;
      lines.push(`${pin.comp.ref}「${name}」：${formatValue(pinVoltage(c, pin.comp.id, pin.pin), 'V')}`);
      lines.push('拖曳可以接線');
    } else {
      const comp = this.compAt(p.wx, p.wy);
      if (comp) {
        lines.push(...measureLines(app, comp));
      } else {
        const wire = this.wireAt(p.wx, p.wy);
        if (wire) {
          const edgeIndex = c.topo.edges.findIndex((e) => e.wireId === wire.id);
          if (edgeIndex >= 0) {
            const v = vertexVoltage(c, c.topo.edges[edgeIndex].a) ?? 0;
            lines.push(`節點電壓：${formatValue(v, 'V')}`);
            lines.push(`導線電流：${formatValue(Math.abs(c.edgeCurrents[edgeIndex]), 'A')}`);
          }
        }
      }
    }
    drawTooltip(g, lines, p.sx, p.sy, w, h);
  }
}

/** 元件的量測值（提示框與屬性面板共用）。 */
export function measureLines(app: App, comp: Comp): string[] {
  const c = app.compiled;
  const def = getDef(comp.type);
  const lines = [`${comp.ref}　${def.name}`];
  if (!c.devices.has(comp.id)) return lines;
  if (def.pins.length === 2) {
    // 太小的值是數值雜訊，顯示 0 才不會讓學生困惑。
    const raw = pinVoltage(c, comp.id, 0) - pinVoltage(c, comp.id, 1);
    const v = Math.abs(raw) < 1e-6 ? 0 : raw;
    const rawI = pinCurrent(c, comp.id, 0);
    const i = Math.abs(rawI) < 1e-9 ? 0 : rawI;
    lines.push(`電壓 ${formatValue(v, 'V')}`);
    lines.push(`電流 ${formatValue(Math.abs(i), 'A')}`);
    if (comp.type === 'res' || comp.type === 'lamp' || comp.type === 'led' || comp.type === 'diode') lines.push(`功率 ${formatValue(Math.abs(v * i), 'W')}`);
  } else {
    def.pins.forEach((pin, i) => {
      if (pin.name === 'NC') return;
      if (def.pins.length > 8 && !['VCC', 'GND'].includes(pin.name) && i > 20) return;
      lines.push(`${pin.name}：${formatValue(pinVoltage(c, comp.id, i), 'V')}`);
    });
  }
  return lines;
}
