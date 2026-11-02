// 由兩種畫面的接線算出「哪些腳接在一起」。畫面不同，但輸出的資料結構相同。

import { BBFoot, getDef } from './catalog';
import { dipHole, holePos, holeStrip, parseTerminal, terminalId } from './breadboard';
import { BBPlace, CircuitDoc, Comp, pinKey, Point, ViewKind } from './types';

/** 一段導線：兩端是圖形頂點。pa、pb 用來畫電流動畫。 */
export interface TopoEdge {
  a: string;
  b: string;
  wireId: string;
  pa: Point;
  pb: Point;
}

export interface Topology {
  view: ViewKind;
  comps: Comp[];
  /** `元件id:腳` → 頂點。 */
  pinVertex: Map<string, string>;
  edges: TopoEdge[];
  /** 不靠導線相連的頂點，例如所有接地、IC 內部相連的腳。 */
  unions: [string, string][];
}

export const GND_VERTEX = '__GND__';

export function rotatePoint(p: Point, rot: number): Point {
  let [x, y] = p;
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) {
    const nx = -y;
    const ny = x;
    x = nx;
    y = ny;
  }
  return [x, y];
}

/** 電路圖上腳的絕對位置（格點）。 */
export function schPinPos(c: Comp, pin: number): Point {
  const def = getDef(c.type);
  const [x, y] = rotatePoint(def.pins[pin].sch, c.sch!.rot);
  return [c.sch!.x + x, c.sch!.y + y];
}

const pt = (p: Point) => `${p[0]},${p[1]}`;

/** 去掉重複點、補斜線的轉角、合併同方向線段。 */
export function normalizeWire(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    if (last && last[0] !== p[0] && last[1] !== p[1]) out.push([p[0], last[1]]);
    out.push([p[0], p[1]]);
  }
  for (let i = out.length - 2; i > 0; i--) {
    const [a, b, c] = [out[i - 1], out[i], out[i + 1]];
    if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) out.splice(i, 1);
  }
  return out;
}

export function buildSchTopology(doc: CircuitDoc): Topology {
  const comps = doc.comps.filter((c) => c.sch);
  const pinVertex = new Map<string, string>();
  const unions: [string, string][] = [];
  const points = new Set<string>();

  for (const c of comps) {
    const def = getDef(c.type);
    def.pins.forEach((_, i) => {
      const v = pt(schPinPos(c, i));
      pinVertex.set(pinKey(c.id, i), v);
      points.add(v);
      if (c.type === 'gnd') unions.push([v, GND_VERTEX]);
    });
    for (const tie of def.ties ?? []) {
      unions.push([pinVertex.get(pinKey(c.id, tie[0]))!, pinVertex.get(pinKey(c.id, tie[1]))!]);
    }
  }
  for (const w of doc.schWires) for (const p of w.pts) points.add(pt(p));

  const pointList = [...points].map((s) => s.split(',').map(Number) as Point);
  const edges: TopoEdge[] = [];
  for (const w of doc.schWires) {
    for (let i = 0; i + 1 < w.pts.length; i++) {
      const [ax, ay] = w.pts[i];
      const [bx, by] = w.pts[i + 1];
      if (ax === bx && ay === by) continue;
      // 只有端點、轉折點或腳落在線段上才算相連；單純交叉不相連。
      const inner = pointList.filter(([x, y]) => {
        if (ax === bx) return x === ax && y > Math.min(ay, by) && y < Math.max(ay, by);
        if (ay === by) return y === ay && x > Math.min(ax, bx) && x < Math.max(ax, bx);
        return false;
      });
      inner.sort((p, q) => Math.hypot(p[0] - ax, p[1] - ay) - Math.hypot(q[0] - ax, q[1] - ay));
      const chain: Point[] = [[ax, ay], ...inner, [bx, by]];
      for (let k = 0; k + 1 < chain.length; k++) {
        edges.push({ a: pt(chain[k]), b: pt(chain[k + 1]), wireId: w.id, pa: chain[k], pb: chain[k + 1] });
      }
    }
  }
  return { view: 'sch', comps, pinVertex, edges, unions };
}

/** 元件每隻腳在麵包板上的孔位或端子。未放置回傳 null。 */
export function bbPinTarget(c: Comp, pin: number): string | null {
  const place = c.bb;
  const foot = getDef(c.type).bb;
  if (!place || !foot) return null;
  return footTarget(c, foot, place, pin);
}

function footTarget(c: Comp, foot: BBFoot, place: BBPlace, pin: number): string | null {
  switch (foot.kind) {
    case 'twoLead':
      return place.holes?.[pin] ?? null;
    case 'inline': {
      const pos = foot.order.indexOf(pin);
      const offset = place.rev ? foot.order.length - 1 - pos : pos;
      return `${place.row}${place.col! + offset}`;
    }
    case 'dip': {
      const dip = getDef(c.type).pins[pin].dip!;
      return dipHole(place.col!, foot.numPins, dip);
    }
    case 'bench':
      return terminalId(c.id, pin);
  }
}

/** 孔位或端子對應的導通頂點。 */
export function bbVertex(target: string): string | null {
  if (parseTerminal(target)) return target;
  return holeStrip(target);
}

/** 孔位或端子的座標（孔距）。 */
export function bbTargetPos(doc: CircuitDoc, target: string): Point | null {
  const t = parseTerminal(target);
  if (t) {
    const c = doc.comps.find((x) => x.id === t.compId);
    const foot = c && getDef(c.type).bb;
    if (!c?.bb || !foot || foot.kind !== 'bench') return null;
    const [dx, dy] = foot.terms[t.pin];
    return [c.bb.x! + dx, c.bb.y! + dy];
  }
  return holePos(target);
}

export function buildBBTopology(doc: CircuitDoc): Topology {
  const comps = doc.comps.filter((c) => c.bb && getDef(c.type).bb);
  const pinVertex = new Map<string, string>();
  const unions: [string, string][] = [];
  for (const c of comps) {
    const def = getDef(c.type);
    def.pins.forEach((_, i) => {
      const target = bbPinTarget(c, i);
      const v = target ? bbVertex(target) : null;
      if (v) pinVertex.set(pinKey(c.id, i), v);
    });
    for (const tie of def.ties ?? []) {
      const a = pinVertex.get(pinKey(c.id, tie[0]));
      const b = pinVertex.get(pinKey(c.id, tie[1]));
      if (a && b) unions.push([a, b]);
    }
  }
  const edges: TopoEdge[] = [];
  for (const w of doc.bbWires) {
    const a = bbVertex(w.a);
    const b = bbVertex(w.b);
    const pa = bbTargetPos(doc, w.a);
    const pb = bbTargetPos(doc, w.b);
    if (a && b && pa && pb) edges.push({ a, b, wireId: w.id, pa, pb });
  }
  return { view: 'bb', comps, pinVertex, edges, unions };
}

export function buildTopology(doc: CircuitDoc, view: ViewKind): Topology {
  return view === 'sch' ? buildSchTopology(doc) : buildBBTopology(doc);
}

export interface NetPin {
  compId: string;
  pin: number;
}

export interface Nets {
  /** 每個 net 包含的腳。 */
  pins: NetPin[][];
  /** 每個 net 包含的頂點。 */
  vertices: string[][];
  vertexNet: Map<string, number>;
  pinNet: Map<string, number>;
}

export function computeNets(topo: Topology): Nets {
  const parent = new Map<string, string>();
  const find = (v: string): string => {
    if (!parent.has(v)) parent.set(v, v);
    let r = v;
    while (parent.get(r)! !== r) r = parent.get(r)!;
    let cur = v;
    while (parent.get(cur)! !== r) {
      const next = parent.get(cur)!;
      parent.set(cur, r);
      cur = next;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const v of topo.pinVertex.values()) find(v);
  for (const e of topo.edges) union(e.a, e.b);
  for (const [a, b] of topo.unions) union(a, b);

  const rootIndex = new Map<string, number>();
  const pins: NetPin[][] = [];
  const vertices: string[][] = [];
  const vertexNet = new Map<string, number>();
  for (const v of parent.keys()) {
    const r = find(v);
    let idx = rootIndex.get(r);
    if (idx === undefined) {
      idx = pins.length;
      rootIndex.set(r, idx);
      pins.push([]);
      vertices.push([]);
    }
    vertices[idx].push(v);
    vertexNet.set(v, idx);
  }
  const pinNet = new Map<string, number>();
  for (const c of topo.comps) {
    getDef(c.type).pins.forEach((_, i) => {
      const v = topo.pinVertex.get(pinKey(c.id, i));
      if (v === undefined) return;
      const idx = vertexNet.get(v)!;
      pins[idx].push({ compId: c.id, pin: i });
      pinNet.set(pinKey(c.id, i), idx);
    });
  }
  return { pins, vertices, vertexNet, pinNet };
}
