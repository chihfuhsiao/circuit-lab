// 麵包板編輯器：插元件、拉跳線、看哪些孔相通。

import { App, SCOPE_COLORS } from '../app';
import {
  BB_BOTTOM_ROWS,
  BB_COLS,
  BB_HEIGHT,
  BB_RAILS,
  BB_TOP_ROWS,
  dipHole,
  holePos,
  holeStrip,
  nearestHole,
  parseHole,
  parseTerminal,
  railHasHole,
  rowY,
  stripHoles,
  terminalId,
} from '../circuit/breadboard';
import { getDef } from '../circuit/catalog';
import { pinVoltage, vertexVoltage } from '../circuit/compile';
import { addBBWire, addComp, removeComp } from '../circuit/doc';
import { formatValue } from '../circuit/format';
import { bbPinTarget, bbTargetPos, bbVertex } from '../circuit/topology';
import { BBPlace, BBWire, Comp, Point } from '../circuit/types';
import { BENCH, BENCH_DOT, Camera, DOT_SPACING, dotSpeed, drawSelectBox, drawTooltip, EditorView, ERROR, fitCamera, FONT, G, PointerInfo, voltColor } from './common';
import { BOARD_INK, BOARD_INK_SOFT, BOARD_SELECT, drawPart, partBounds } from './bbparts';
import { measureLines } from './schematic';

type Mode =
  | { kind: 'idle' }
  | { kind: 'place'; type: string; compId?: string; rev: boolean; place: BBPlace | null; valid: boolean }
  | { kind: 'dragPart'; compId: string; orig: BBPlace; startX: number; startY: number; moved: boolean; lead: number | null; pressed: boolean }
  | { kind: 'wire'; from: string; cur: [number, number]; target: string | null; sticky: boolean }
  | { kind: 'dragEnd'; wireId: string; end: 'a' | 'b'; orig: string; cur: [number, number]; target: string | null }
  | { kind: 'pan'; sx: number; sy: number; cx: number; cy: number };

/** 跳線的曲線控制點：往上拱，距離越長拱越高。 */
function jumperControl(a: Point, b: Point): Point {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dist = Math.hypot(dx, dy);
  const lift = Math.min(40, 10 + dist * 0.18);
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - lift];
}

function quadPoint(a: Point, c: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
}

let holesPath: Path2D | null = null;
function getHolesPath(): Path2D {
  if (holesPath) return holesPath;
  const p = new Path2D();
  const add = (x: number, y: number) => p.rect(x * G - 2.6, y * G - 2.6, 5.2, 5.2);
  for (let c = 1; c <= BB_COLS; c++) {
    for (const r of [...BB_TOP_ROWS, ...BB_BOTTOM_ROWS]) add(c, rowY(r));
    if (railHasHole(c)) for (const r of BB_RAILS) add(c, rowY(r));
  }
  holesPath = p;
  return p;
}

export class BreadboardView implements EditorView {
  cam: Camera = { x: 60, y: 200, zoom: 1 };
  private mode: Mode = { kind: 'idle' };
  private mouse: PointerInfo | null = null;
  spaceDown = false;

  constructor(private app: App) {}

  // ---- 占用與命中 ----

  /** 元件占用的所有孔（含 DIP 的空腳）。 */
  private compHoles(c: Comp): string[] {
    const foot = getDef(c.type).bb;
    if (!foot || !c.bb) return [];
    if (foot.kind === 'bench') return [];
    if (foot.kind === 'dip') {
      const out: string[] = [];
      for (let k = 1; k <= foot.numPins; k++) out.push(dipHole(c.bb.col!, foot.numPins, k));
      return out;
    }
    return getDef(c.type).pins.map((_, i) => bbPinTarget(c, i)!);
  }

  private occupied(exceptComp?: string, exceptWire?: string): Set<string> {
    const set = new Set<string>();
    for (const c of this.app.doc.comps) {
      if (c.id === exceptComp) continue;
      for (const h of this.compHoles(c)) set.add(h);
    }
    for (const w of this.app.doc.bbWires) {
      if (w.id === exceptWire) continue;
      if (!parseTerminal(w.a)) set.add(w.a);
      if (!parseTerminal(w.b)) set.add(w.b);
    }
    return set;
  }

  private placementHoles(type: string, place: BBPlace): string[] {
    const fake: Comp = { id: '_', type, ref: '', params: {}, bb: place };
    return this.compHoles(fake);
  }

  private isValid(type: string, place: BBPlace, exceptComp?: string): boolean {
    const holes = this.placementHoles(type, place);
    const occ = this.occupied(exceptComp);
    const seen = new Set<string>();
    for (const h of holes) {
      if (!parseHole(h) || occ.has(h) || seen.has(h)) return false;
      seen.add(h);
    }
    return true;
  }

  private terminalAt(wx: number, wy: number): string | null {
    for (const c of this.app.doc.comps) {
      const foot = getDef(c.type).bb;
      if (foot?.kind !== 'bench' || !c.bb) continue;
      for (let i = 0; i < foot.terms.length; i++) {
        const x = (c.bb.x! + foot.terms[i][0]) * G;
        const y = (c.bb.y! + foot.terms[i][1]) * G;
        if (Math.hypot(x - wx, y - wy) < 10) return terminalId(c.id, i);
      }
    }
    return null;
  }

  private partAt(wx: number, wy: number): Comp | null {
    const comps = this.app.doc.comps;
    for (let i = comps.length - 1; i >= 0; i--) {
      const c = comps[i];
      const b = partBounds(c);
      if (!b) continue;
      if (wx < b.x0 || wx > b.x1 || wy < b.y0 || wy > b.y1) continue;
      // 兩腳元件斜放時，外框太大，改用到連線的距離判斷。
      if (getDef(c.type).bb?.kind === 'twoLead' && c.bb?.holes) {
        const a = holePos(c.bb.holes[0])!;
        const q = holePos(c.bb.holes[1])!;
        const ax = a[0] * G;
        const ay = a[1] * G;
        const bx = q[0] * G;
        const by = q[1] * G;
        const dx = bx - ax;
        const dy = by - ay;
        const len = dx * dx + dy * dy;
        const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((wx - ax) * dx + (wy - ay) * dy) / len));
        if (Math.hypot(wx - (ax + t * dx), wy - (ay + t * dy)) > 13) continue;
      }
      return c;
    }
    return null;
  }

  private wireAt(wx: number, wy: number): BBWire | null {
    const doc = this.app.doc;
    const tol = 5 / this.cam.zoom + 1.5;
    for (let i = doc.bbWires.length - 1; i >= 0; i--) {
      const w = doc.bbWires[i];
      const a = this.px(w.a);
      const b = this.px(w.b);
      if (!a || !b) continue;
      const c = jumperControl(a, b);
      for (let k = 0; k <= 24; k++) {
        const q = quadPoint(a, c, b, k / 24);
        if (Math.hypot(q[0] - wx, q[1] - wy) < tol) return w;
      }
    }
    return null;
  }

  private px(target: string): Point | null {
    const p = bbTargetPos(this.app.doc, target);
    return p ? [p[0] * G, p[1] * G] : null;
  }

  private targetAt(wx: number, wy: number): string | null {
    return this.terminalAt(wx, wy) ?? nearestHole(wx / G, wy / G, 0.55);
  }

  /** 哪個元件的引腳插在這個孔（兩腳元件拖曳腳用）。 */
  private leadAt(wx: number, wy: number): { comp: Comp; lead: number } | null {
    const hole = nearestHole(wx / G, wy / G, 0.5);
    if (!hole) return null;
    for (const c of this.app.doc.comps) {
      if (getDef(c.type).bb?.kind !== 'twoLead' || !c.bb?.holes) continue;
      const i = c.bb.holes.indexOf(hole);
      if (i >= 0) return { comp: c, lead: i };
    }
    return null;
  }

  // ---- 放置 ----

  beginPlace(type: string, compId?: string): void {
    if (!getDef(type).bb) return;
    this.app.setTool('select');
    this.mode = { kind: 'place', type, compId, rev: false, place: null, valid: false };
    if (this.mouse) this.updatePlace(this.mouse);
  }

  private updatePlace(p: PointerInfo): void {
    const m = this.mode;
    if (m.kind !== 'place') return;
    const foot = getDef(m.type).bb!;
    const gx = p.wx / G;
    const gy = p.wy / G;
    let place: BBPlace | null = null;
    switch (foot.kind) {
      case 'twoLead': {
        const hole = nearestHole(gx, gy, 2);
        if (hole) {
          const h = parseHole(hole)!;
          let col = h.col;
          if (col + foot.span > BB_COLS) col = BB_COLS - foot.span;
          const candidate = `${h.row}${col + foot.span}`;
          place = { holes: [`${h.row}${col}`, parseHole(candidate) ? candidate : `${h.row}${col + foot.span - 1}`] };
        }
        break;
      }
      case 'inline': {
        const hole = nearestHole(gx, gy, 2);
        if (hole) {
          const h = parseHole(hole)!;
          if (h.row.length === 1) {
            const len = foot.order.length;
            place = { row: h.row, col: Math.min(h.col, BB_COLS - len + 1), rev: m.rev };
          }
        }
        break;
      }
      case 'dip': {
        const half = foot.numPins / 2;
        const col = Math.max(1, Math.min(BB_COLS - half + 1, Math.round(gx - (half - 1) / 2)));
        place = { col };
        break;
      }
      case 'bench':
        place = { x: Math.round(gx - foot.w / 2), y: Math.round(gy - foot.h / 2) };
        break;
    }
    m.place = place;
    if (!place) {
      m.valid = false;
    } else if (foot.kind === 'bench') {
      // 桌上儀器要放在麵包板外面。
      const y = place.y!;
      m.valid = y + foot.h < -0.5 || y > BB_HEIGHT + 0.5;
    } else {
      m.valid = this.isValid(m.type, place, m.compId);
    }
  }

  cancel(): void {
    this.mode = { kind: 'idle' };
  }

  cursor(): string {
    const m = this.mode;
    if (m.kind === 'pan') return 'grabbing';
    if (m.kind === 'place' || m.kind === 'wire' || m.kind === 'dragEnd') return 'crosshair';
    if (m.kind === 'dragPart') return 'move';
    if (this.app.tool === 'probe') return 'crosshair';
    if (this.spaceDown) return 'grab';
    const p = this.mouse;
    if (p) {
      if (this.terminalAt(p.wx, p.wy)) return 'crosshair';
      if (this.partAt(p.wx, p.wy) || this.wireAt(p.wx, p.wy)) return 'pointer';
      if (nearestHole(p.wx / G, p.wy / G, 0.55)) return 'crosshair';
    }
    return 'default';
  }

  // ---- 指標事件 ----

  pointerDown(p: PointerInfo): void {
    this.mouse = p;
    const app = this.app;
    if (p.button === 1 || p.button === 2 || this.spaceDown) {
      this.mode = { kind: 'pan', sx: p.sx, sy: p.sy, cx: this.cam.x, cy: this.cam.y };
      return;
    }
    const m = this.mode;

    if (m.kind === 'place') {
      this.updatePlace(p);
      if (!m.valid || !m.place) return;
      let comp: Comp;
      if (m.compId) {
        comp = app.doc.comps.find((c) => c.id === m.compId)!;
        comp.bb = m.place;
      } else {
        comp = addComp(app.doc, m.type, { bb: m.place });
      }
      app.select([comp.id]);
      app.commit();
      this.mode = p.shift && !m.compId ? { kind: 'place', type: m.type, rev: m.rev, place: null, valid: false } : { kind: 'idle' };
      return;
    }

    if (m.kind === 'wire' && m.sticky) {
      this.updateWireTarget(p);
      this.finishWire();
      return;
    }

    if (app.tool === 'probe') {
      this.addProbeAt(p);
      return;
    }

    // 已選取跳線的端點可以拖曳
    for (const id of app.selection) {
      const w = app.doc.bbWires.find((x) => x.id === id);
      if (!w) continue;
      for (const end of ['a', 'b'] as const) {
        const pos = this.px(w[end]);
        if (pos && Math.hypot(pos[0] - p.wx, pos[1] - p.wy) < 9) {
          this.mode = { kind: 'dragEnd', wireId: w.id, end, orig: w[end], cur: [p.wx, p.wy], target: w[end] };
          return;
        }
      }
    }

    const term = this.terminalAt(p.wx, p.wy);
    if (term) {
      this.mode = { kind: 'wire', from: term, cur: [p.wx, p.wy], target: null, sticky: false };
      return;
    }

    const lead = this.leadAt(p.wx, p.wy);
    if (lead && app.selection.has(lead.comp.id)) {
      this.mode = { kind: 'dragPart', compId: lead.comp.id, orig: structuredClone(lead.comp.bb!), startX: p.wx, startY: p.wy, moved: false, lead: lead.lead, pressed: false };
      return;
    }

    const part = this.partAt(p.wx, p.wy);
    if (part) {
      if (!app.selection.has(part.id)) app.select([part.id], p.shift);
      let pressed = false;
      if (part.type === 'push') {
        part.params.closed = true;
        app.transient();
        pressed = true;
      }
      this.mode = { kind: 'dragPart', compId: part.id, orig: structuredClone(part.bb!), startX: p.wx, startY: p.wy, moved: false, lead: null, pressed };
      return;
    }

    const wire = this.wireAt(p.wx, p.wy);
    if (wire) {
      app.select([wire.id], p.shift);
      return;
    }

    const hole = nearestHole(p.wx / G, p.wy / G, 0.55);
    if (hole && !this.occupied().has(hole)) {
      this.mode = { kind: 'wire', from: hole, cur: [p.wx, p.wy], target: null, sticky: false };
      return;
    }

    if (!p.shift) app.select([]);
    this.mode = { kind: 'pan', sx: p.sx, sy: p.sy, cx: this.cam.x, cy: this.cam.y };
  }

  private addProbeAt(p: PointerInfo): void {
    const app = this.app;
    const c = app.compiled;
    const target = this.targetAt(p.wx, p.wy);
    const vertex = target ? bbVertex(target) : null;
    const net = vertex ? c.nets.vertexNet.get(vertex) : undefined;
    if (net !== undefined && c.nets.pins[net].length) {
      const pin = c.nets.pins[net][0];
      app.addProbe(pin.compId, pin.pin);
      app.setTool('select');
      return;
    }
    const part = this.partAt(p.wx, p.wy);
    if (part) {
      app.addProbe(part.id, 0);
      app.setTool('select');
    }
  }

  private updateWireTarget(p: PointerInfo): void {
    const m = this.mode;
    if (m.kind !== 'wire' && m.kind !== 'dragEnd') return;
    m.cur = [p.wx, p.wy];
    const t = this.targetAt(p.wx, p.wy);
    const exceptWire = m.kind === 'dragEnd' ? m.wireId : undefined;
    if (!t) m.target = null;
    else if (parseTerminal(t)) m.target = t;
    else m.target = this.occupied(undefined, exceptWire).has(t) ? null : t;
  }

  private finishWire(): void {
    const m = this.mode;
    if (m.kind !== 'wire') return;
    this.mode = { kind: 'idle' };
    if (m.target && m.target !== m.from) {
      const w = addBBWire(this.app.doc, m.from, m.target);
      this.app.select([w.id]);
      this.app.commit();
    }
  }

  pointerMove(p: PointerInfo): void {
    this.mouse = p;
    const m = this.mode;
    const app = this.app;
    switch (m.kind) {
      case 'place':
        this.updatePlace(p);
        break;
      case 'wire':
      case 'dragEnd':
        this.updateWireTarget(p);
        break;
      case 'pan':
        this.cam.x = m.cx + (p.sx - m.sx);
        this.cam.y = m.cy + (p.sy - m.sy);
        break;
      case 'dragPart': {
        const comp = app.doc.comps.find((c) => c.id === m.compId);
        if (!comp) break;
        const dx = Math.round((p.wx - m.startX) / G);
        const dy = Math.round((p.wy - m.startY) / G);
        if (dx === 0 && dy === 0 && !m.moved) break;
        const next = this.movedPlace(comp, m.orig, dx, dy, m.lead, p);
        if (next && this.placeAllowed(comp, next)) {
          comp.bb = next;
          m.moved = true;
          app.rebuild();
        }
        break;
      }
    }
  }

  private placeAllowed(comp: Comp, place: BBPlace): boolean {
    const foot = getDef(comp.type).bb!;
    if (foot.kind === 'bench') return place.y! + foot.h < -0.5 || place.y! > BB_HEIGHT + 0.5;
    return this.isValid(comp.type, place, comp.id);
  }

  /** 拖曳後的新位置。孔位要依列的順序平移，不能直接加座標。 */
  private movedPlace(comp: Comp, orig: BBPlace, dx: number, dy: number, lead: number | null, p: PointerInfo): BBPlace | null {
    const foot = getDef(comp.type).bb!;
    switch (foot.kind) {
      case 'bench':
        return { x: orig.x! + dx, y: orig.y! + dy };
      case 'dip':
        return { col: Math.max(1, Math.min(BB_COLS - foot.numPins / 2 + 1, orig.col! + dx)) };
      case 'inline': {
        const pos = holePos(`${orig.row}${orig.col}`);
        if (!pos) return null;
        const row = nearestRowLetter(pos[1] + dy) ?? orig.row!;
        return { ...orig, row, col: Math.max(1, Math.min(BB_COLS - foot.order.length + 1, orig.col! + dx)) };
      }
      case 'twoLead': {
        const holes = orig.holes!;
        if (lead !== null) {
          const hole = nearestHole(p.wx / G, p.wy / G, 1);
          if (!hole) return null;
          const next = [...holes];
          next[lead] = hole;
          return { holes: next };
        }
        const next = holes.map((h) => shiftHole(h, dx, dy));
        return next.every(Boolean) ? { holes: next as string[] } : null;
      }
    }
  }

  pointerUp(p: PointerInfo): void {
    this.mouse = p;
    const m = this.mode;
    const app = this.app;
    switch (m.kind) {
      case 'wire': {
        this.updateWireTarget(p);
        if (m.sticky) return;
        const startPos = this.px(m.from);
        const dist = startPos ? Math.hypot(startPos[0] - p.wx, startPos[1] - p.wy) : 99;
        if (dist < 8) {
          // 沒有拖曳：改成點一下起點、再點一下終點。
          m.sticky = true;
          return;
        }
        this.finishWire();
        break;
      }
      case 'dragEnd': {
        this.updateWireTarget(p);
        const w = app.doc.bbWires.find((x) => x.id === m.wireId);
        this.mode = { kind: 'idle' };
        if (w && m.target) {
          w[m.end] = m.target;
          app.commit();
        }
        break;
      }
      case 'dragPart': {
        this.mode = { kind: 'idle' };
        const comp = app.doc.comps.find((c) => c.id === m.compId);
        if (m.pressed && comp) {
          comp.params.closed = false;
          app.transient();
        }
        if (m.moved) app.commit();
        else if (comp?.type === 'sw') {
          comp.params.closed = comp.params.closed !== true;
          app.transient();
          app.emit('selection');
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
      if (this.mode.kind !== 'idle') {
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
        this.mode.rev = !this.mode.rev;
        if (this.mouse) this.updatePlace(this.mouse);
        return true;
      }
      const c = app.selectedComp;
      const foot = c && getDef(c.type).bb;
      if (c?.bb && foot?.kind === 'inline') {
        c.bb.rev = !c.bb.rev;
        app.commit();
        return true;
      }
      if (c?.bb?.holes && foot?.kind === 'twoLead') {
        c.bb.holes = [c.bb.holes[1], c.bb.holes[0]];
        app.commit();
        return true;
      }
      return false;
    }
    if (key === 'delete' || key === 'backspace') {
      if (!app.selection.size) return false;
      app.doc.bbWires = app.doc.bbWires.filter((w) => !app.selection.has(w.id));
      for (const c of [...app.doc.comps]) {
        if (!app.selection.has(c.id)) continue;
        // 電路圖上也有的元件，只把它從麵包板拔掉。
        if (c.sch && getDef(c.type).sch) {
          delete c.bb;
          app.doc.bbWires = app.doc.bbWires.filter((w) => !w.a.startsWith(`t:${c.id}:`) && !w.b.startsWith(`t:${c.id}:`));
        } else removeComp(app.doc, c.id);
      }
      app.selection.clear();
      app.commit();
      app.emit('selection');
      return true;
    }
    return false;
  }

  /**
   * 整塊 63 欄放進畫面會太小、不好插孔，所以只對準用到的範圍（至少 34 欄）。
   * 要看右邊可以拖曳空白處或用滾輪縮放。
   */
  fit(w: number, h: number): void {
    const doc = this.app.doc;
    // 上方留空間放電源供應器等桌上儀器。
    let minY = -9;
    let maxY = BB_HEIGHT + 1;
    let minX = 0;
    let maxX = 34;
    const addCol = (col: number) => {
      maxX = Math.max(maxX, Math.min(col + 3, BB_COLS + 1));
    };
    for (const c of doc.comps) {
      const foot = getDef(c.type).bb;
      if (!foot || !c.bb) continue;
      if (foot.kind === 'bench') {
        minY = Math.min(minY, c.bb.y! - 1);
        maxY = Math.max(maxY, c.bb.y! + foot.h + 1);
        minX = Math.min(minX, c.bb.x!);
        maxX = Math.max(maxX, c.bb.x! + foot.w);
      } else {
        for (const hole of this.compHoles(c)) {
          const p = holePos(hole);
          if (p) addCol(p[0]);
        }
      }
    }
    for (const wire of doc.bbWires) {
      for (const t of [wire.a, wire.b]) {
        const p = holePos(t);
        if (p) addCol(p[0]);
      }
    }
    fitCamera(this.cam, minX * G, minY * G, maxX * G, maxY * G, w, h);
  }

  // ---- 繪製 ----

  draw(g: CanvasRenderingContext2D, w: number, h: number, dpr: number): void {
    const app = this.app;
    const cam = this.cam;
    const c = app.compiled;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = BENCH;
    g.fillRect(0, 0, w, h);
    // 工作桌面：淡淡的點陣
    const step = 28 * cam.zoom;
    if (step > 8) {
      const ox = ((cam.x % step) + step) % step;
      const oy = ((cam.y % step) + step) % step;
      g.fillStyle = BENCH_DOT;
      for (let x = ox; x < w; x += step) for (let y = oy; y < h; y += step) g.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
    }
    g.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * cam.x, dpr * cam.y);

    this.drawBoard(g, dpr);
    this.drawStripTint(g);
    // 孔：下緣一圈亮邊，看起來像凹進去
    g.save();
    g.translate(0, 0.7);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.fill(getHolesPath());
    g.restore();
    g.fillStyle = '#2c3037';
    g.fill(getHolesPath());
    this.drawHoverStrip(g);

    const live = c.sim.time > 0;
    const errors = app.errorComps();
    for (const comp of app.doc.comps) {
      const b = partBounds(comp);
      if (!b) continue;
      if (app.selection.has(comp.id) || errors.has(comp.id)) {
        drawSelectBox(g, b.x0 - 4, b.y0 - 4, b.x1 - b.x0 + 8, b.y1 - b.y0 + 8, errors.has(comp.id) ? '#e03131' : BOARD_SELECT);
      }
      drawPart(g, comp, c.devices.get(comp.id), live);
      const kind = getDef(comp.type).bb?.kind;
      if (kind !== 'bench' && comp.ref) {
        const cx = (b.x0 + b.x1) / 2;
        g.font = `600 9.5px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        if (kind === 'dip') {
          // IC 的本體是黑色，代號印在上面要用淺色。
          g.fillStyle = '#c9c9c2';
          g.fillText(comp.ref, cx, (b.y0 + b.y1) / 2 - 12);
        } else {
          // 底下有孔，墊一塊底才讀得清楚。
          const y = b.y0 - 4;
          const tw = g.measureText(comp.ref).width + 6;
          g.fillStyle = 'rgba(250,249,244,0.92)';
          g.beginPath();
          g.roundRect(cx - tw / 2, y - 6.5, tw, 13, 2.5);
          g.fill();
          g.fillStyle = BOARD_INK;
          g.fillText(comp.ref, cx, y + 0.5);
        }
      }
    }

    this.drawWires(g);
    this.drawProbes(g);
    this.drawOverlay(g);

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawHover(g, w, h);
  }

  private drawBoard(g: CanvasRenderingContext2D, dpr: number): void {
    const x0 = 0.1 * G;
    const x1 = (BB_COLS + 0.9) * G;
    const y0 = -1 * G;
    const y1 = (BB_HEIGHT + 1) * G;
    const body = g.createLinearGradient(0, y0, 0, y1);
    body.addColorStop(0, '#fbfaf5');
    body.addColorStop(1, '#f0ede3');
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowBlur = 22 * dpr * this.cam.zoom;
    g.shadowOffsetY = 7 * dpr * this.cam.zoom;
    g.fillStyle = body;
    g.beginPath();
    g.roundRect(x0, y0, x1 - x0, y1 - y0, 7);
    g.fill();
    g.restore();
    g.strokeStyle = '#c6c1b1';
    g.lineWidth = 1;
    g.stroke();
    // 上緣的亮邊
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.beginPath();
    g.roundRect(x0 + 1.5, y0 + 1.5, x1 - x0 - 3, y1 - y0 - 3, 6);
    g.stroke();

    // 中央溝槽
    const gutterY = 8.1 * G;
    const gutterH = 0.8 * G;
    const gutter = g.createLinearGradient(0, gutterY, 0, gutterY + gutterH);
    gutter.addColorStop(0, '#b9b4a4');
    gutter.addColorStop(0.3, '#d6d2c4');
    gutter.addColorStop(1, '#e5e2d7');
    g.fillStyle = gutter;
    g.fillRect(x0 + 1, gutterY, x1 - x0 - 2, gutterH);

    // 電源軌色線
    const railLine = (y: number, color: string) => {
      g.strokeStyle = color;
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(x0 + 10, y * G);
      g.lineTo(x1 - 10, y * G);
      g.stroke();
    };
    railLine(rowY('T+') - 0.55, '#d3232a');
    railLine(rowY('T-') + 0.55, '#1f6fd6');
    railLine(rowY('B+') - 0.55, '#d3232a');
    railLine(rowY('B-') + 0.55, '#1f6fd6');

    // 列與欄的標記
    g.fillStyle = BOARD_INK_SOFT;
    g.font = `9px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const r of [...BB_TOP_ROWS, ...BB_BOTTOM_ROWS]) {
      g.fillText(r, 0.45 * G, rowY(r) * G);
      g.fillText(r, (BB_COLS + 0.55) * G, rowY(r) * G);
    }
    for (let c = 5; c <= BB_COLS; c += 5) {
      g.fillText(String(c), c * G, (rowY('a') - 0.75) * G);
      g.fillText(String(c), c * G, (rowY('j') + 0.75) * G);
    }
    g.fillStyle = '#d3232a';
    g.font = `700 11px ${FONT}`;
    g.fillText('+', 0.45 * G, rowY('T+') * G);
    g.fillText('+', 0.45 * G, rowY('B+') * G);
    g.fillStyle = '#1f6fd6';
    g.fillText('−', 0.45 * G, rowY('T-') * G);
    g.fillText('−', 0.45 * G, rowY('B-') * G);
  }

  /** 有接東西的導通片塗上電壓顏色，讓學生看到孔之間是相通的。 */
  private drawStripTint(g: CanvasRenderingContext2D): void {
    const app = this.app;
    const c = app.compiled;
    if (c.sim.time <= 0) return;
    for (const v of c.vertexIndex.keys()) {
      if (v.startsWith('t:')) continue;
      const volts = vertexVoltage(c, v);
      if (volts === null) continue;
      const color = voltColor(volts, app.vmax);
      g.fillStyle = color;
      g.globalAlpha = 0.2;
      if (BB_RAILS.includes(v)) {
        const y = rowY(v) * G;
        g.fillRect(0.6 * G, y - 6, BB_COLS * G, 12);
      } else {
        const col = Number(v.slice(1));
        const rows = v[0] === 'U' ? BB_TOP_ROWS : BB_BOTTOM_ROWS;
        const y0 = rowY(rows[0]) * G;
        const y1 = rowY(rows[4]) * G;
        g.fillRect(col * G - 6, y0 - 6, 12, y1 - y0 + 12);
      }
      g.globalAlpha = 1;
    }
  }

  private drawHoverStrip(g: CanvasRenderingContext2D): void {
    const p = this.mouse;
    if (!p) return;
    const m = this.mode;
    if (m.kind === 'dragPart' || m.kind === 'pan' || m.kind === 'place') return;
    const hole = nearestHole(p.wx / G, p.wy / G, 0.55);
    if (!hole) return;
    const strip = holeStrip(hole);
    if (!strip) return;
    g.strokeStyle = BOARD_SELECT;
    g.lineWidth = 1.4;
    for (const h of stripHoles(strip)) {
      const pos = holePos(h)!;
      g.beginPath();
      g.arc(pos[0] * G, pos[1] * G, 5.4, 0, Math.PI * 2);
      g.stroke();
    }
    const pos = holePos(hole)!;
    g.fillStyle = BOARD_SELECT;
    g.beginPath();
    g.arc(pos[0] * G, pos[1] * G, 4, 0, Math.PI * 2);
    g.fill();
  }

  private drawJumper(g: CanvasRenderingContext2D, a: Point, b: Point, color: string, width = 3.2): void {
    const c = jumperControl(a, b);
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.22)';
    g.lineWidth = width + 1.6;
    g.beginPath();
    g.moveTo(a[0], a[1] + 1);
    g.quadraticCurveTo(c[0], c[1] + 1, b[0], b[1] + 1);
    g.stroke();
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.quadraticCurveTo(c[0], c[1], b[0], b[1]);
    g.stroke();
    // 絕緣皮的反光
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.lineWidth = width * 0.3;
    g.beginPath();
    g.moveTo(a[0], a[1] - width * 0.22);
    g.quadraticCurveTo(c[0], c[1] - width * 0.22, b[0], b[1] - width * 0.22);
    g.stroke();
    // 插進孔裡的金屬端
    for (const q of [a, b]) {
      g.fillStyle = '#8f98a3';
      g.beginPath();
      g.arc(q[0], q[1], 2.9, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#d7dce2';
      g.beginPath();
      g.arc(q[0] - 0.5, q[1] - 0.6, 1.3, 0, Math.PI * 2);
      g.fill();
    }
  }

  private drawWires(g: CanvasRenderingContext2D): void {
    const app = this.app;
    const c = app.compiled;
    const wireEdge = new Map<string, number>();
    c.topo.edges.forEach((e, i) => wireEdge.set(e.wireId, i));
    const dt = app.frameDt;
    for (const w of app.doc.bbWires) {
      const a = this.px(w.a);
      const b = this.px(w.b);
      if (!a || !b) continue;
      const selected = app.selection.has(w.id);
      if (selected) {
        const ctrl = jumperControl(a, b);
        g.strokeStyle = BOARD_SELECT;
        g.globalAlpha = 0.35;
        g.lineWidth = 8;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(a[0], a[1]);
        g.quadraticCurveTo(ctrl[0], ctrl[1], b[0], b[1]);
        g.stroke();
        g.globalAlpha = 1;
      }
      this.drawJumper(g, a, b, w.color);
      if (selected) {
        g.fillStyle = '#fff';
        g.strokeStyle = BOARD_SELECT;
        g.lineWidth = 2;
        for (const q of [a, b]) {
          g.beginPath();
          g.arc(q[0], q[1], 5, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        }
      }
      // 電流動畫
      const idx = wireEdge.get(w.id);
      if (idx === undefined) continue;
      const speed = dotSpeed(c.edgeCurrents[idx]);
      if (speed === 0) continue;
      c.edgePhase[idx] = (c.edgePhase[idx] + speed * dt) % DOT_SPACING;
      const ctrl = jumperControl(a, b);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.abs(ctrl[1] - (a[1] + b[1]) / 2);
      const count = Math.max(1, Math.floor(len / DOT_SPACING));
      g.fillStyle = '#ffd43b';
      for (let k = 0; k < count; k++) {
        const t = (((k * DOT_SPACING + c.edgePhase[idx]) / (count * DOT_SPACING)) % 1 + 1) % 1;
        const q = quadPoint(a, ctrl, b, t);
        g.beginPath();
        g.arc(q[0], q[1], 1.9, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  private drawProbes(g: CanvasRenderingContext2D): void {
    const app = this.app;
    app.doc.probes.forEach((probe, i) => {
      const comp = app.doc.comps.find((x) => x.id === probe.compId);
      if (!comp?.bb) return;
      const target = bbPinTarget(comp, probe.pin);
      const pos = target ? this.px(target) : null;
      if (!pos) return;
      g.fillStyle = SCOPE_COLORS[i];
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(pos[0], pos[1] - 9, 6, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#fff';
      g.font = `700 8px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(i + 1), pos[0], pos[1] - 8.5);
    });
  }

  private drawOverlay(g: CanvasRenderingContext2D): void {
    const m = this.mode;
    const app = this.app;
    if (m.kind === 'place' && m.place) {
      const comp: Comp = {
        id: '_ghost',
        type: m.type,
        ref: '',
        params: m.compId ? app.doc.comps.find((c) => c.id === m.compId)!.params : Object.fromEntries(getDef(m.type).params.map((p) => [p.key, p.def])),
        bb: m.place,
      };
      g.globalAlpha = 0.7;
      drawPart(g, comp, undefined, false);
      g.globalAlpha = 1;
      const b = partBounds(comp);
      if (b && !m.valid) {
        g.strokeStyle = ERROR;
        g.lineWidth = 2;
        g.setLineDash([5, 4]);
        g.beginPath();
        g.roundRect(b.x0 - 3, b.y0 - 3, b.x1 - b.x0 + 6, b.y1 - b.y0 + 6, 5);
        g.stroke();
        g.setLineDash([]);
      }
    } else if (m.kind === 'wire') {
      const a = this.px(m.from);
      if (a) {
        const end: Point = m.target ? (this.px(m.target) ?? m.cur) : m.cur;
        this.drawJumper(g, a, end, m.target ? '#2b8a3e' : '#868e96');
      }
    } else if (m.kind === 'dragEnd') {
      const w = app.doc.bbWires.find((x) => x.id === m.wireId);
      if (w) {
        const fixed = this.px(m.end === 'a' ? w.b : w.a);
        const end: Point = m.target ? (this.px(m.target) ?? m.cur) : m.cur;
        if (fixed) this.drawJumper(g, fixed, end, m.target ? w.color : '#868e96');
      }
    }
  }

  private drawHover(g: CanvasRenderingContext2D, w: number, h: number): void {
    const p = this.mouse;
    const app = this.app;
    if (!p) return;
    const m = this.mode;
    const lines: string[] = [];
    if (m.kind === 'place') {
      const foot = getDef(m.type).bb!;
      if (foot.kind === 'bench' && !m.valid) lines.push('儀器要放在麵包板外面（上方或下方）');
      else if (!m.valid) lines.push('這裡放不下：孔已被占用或超出範圍');
      else if (foot.kind === 'dip') lines.push('IC 要跨在中央溝槽上');
    } else if (m.kind === 'idle') {
      const c = app.compiled;
      if (app.tool === 'probe') {
        lines.push('點孔或元件，加入示波器探棒');
      } else {
        const term = this.terminalAt(p.wx, p.wy);
        const part = this.partAt(p.wx, p.wy);
        if (term) {
          const t = parseTerminal(term)!;
          const comp = app.doc.comps.find((x) => x.id === t.compId)!;
          lines.push(`${comp.ref}「${getDef(comp.type).pins[t.pin].name}」：${formatValue(pinVoltage(c, comp.id, t.pin), 'V')}`);
          lines.push('拖曳可以接跳線');
        } else if (part) {
          lines.push(...measureLines(app, part));
        } else {
          const hole = nearestHole(p.wx / G, p.wy / G, 0.55);
          if (hole) {
            const strip = holeStrip(hole)!;
            const parsed = parseHole(hole)!;
            let desc: string;
            if (strip.length === 2) desc = `${strip[0] === 'T' ? '上' : '下'}方${strip[1] === '+' ? '正' : '負'}電源軌：整排相通`;
            else desc = `第 ${parsed.col} 欄 ${strip[0] === 'U' ? 'a～e' : 'f～j'} 相通`;
            lines.push(`${hole}　${desc}`);
            const volts = vertexVoltage(c, strip);
            if (volts !== null) lines.push(`電壓 ${formatValue(volts, 'V')}`);
          }
        }
      }
    }
    drawTooltip(g, lines, p.sx, p.sy, w, h);
  }
}

const ORDERED_ROWS = ['T+', 'T-', ...BB_TOP_ROWS, ...BB_BOTTOM_ROWS, 'B+', 'B-'];

function nearestRowLetter(y: number): string | null {
  for (const r of [...BB_TOP_ROWS, ...BB_BOTTOM_ROWS]) if (rowY(r) === y) return r;
  return null;
}

/** 把孔平移 dx 欄、dy 孔距；落在沒有孔的位置回傳 null。 */
function shiftHole(id: string, dx: number, dy: number): string | null {
  const h = parseHole(id);
  if (!h) return null;
  const y = rowY(h.row) + dy;
  const row = ORDERED_ROWS.find((r) => rowY(r) === y);
  if (!row) return null;
  const next = `${row}${h.col + dx}`;
  return parseHole(next) ? next : null;
}
