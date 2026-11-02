// 把電路文件編譯成引擎可以執行的 Simulator，並保留畫面需要的對應關係。

import { Device, Simulator } from '../engine/sim';
import { getDef } from './catalog';
import { buildTopology, computeNets, GND_VERTEX, Nets, Topology } from './topology';
import { CircuitDoc, Comp, pinKey, ViewKind } from './types';

export interface TreeStep {
  edge: number;
  child: number;
  parent: number;
  /** edge.a 是 parent 時為 +1。 */
  sign: number;
}

export interface Compiled {
  view: ViewKind;
  topo: Topology;
  nets: Nets;
  sim: Simulator;
  devices: Map<string, Device>;
  /** net 對應的引擎節點。 */
  netNode: number[];
  /** 電路圖上有接地符號。 */
  hasGround: boolean;
  /** 沒有接地符號時，暫時當 0V 的元件。 */
  referenceComp: Comp | null;
  /** 每段導線的電流（由 a 到 b）。 */
  edgeCurrents: Float64Array;
  treeSteps: TreeStep[];
  vertexIndex: Map<string, number>;
  /** 畫電流動畫時的累積位移（每段導線一個）。 */
  edgePhase: Float64Array;
}

/** 編譯。prev 是修改前的結果，用來保留電容電壓、正反器狀態與時間。 */
export function compile(doc: CircuitDoc, view: ViewKind, prev?: Compiled | null): Compiled {
  const topo = buildTopology(doc, view);
  const nets = computeNets(topo);

  // 決定參考點：接地符號優先，否則用第一個電源的負極。
  const gndNet = nets.vertexNet.get(GND_VERTEX);
  let refNet = gndNet ?? -1;
  let referenceComp: Comp | null = null;
  if (refNet < 0) {
    for (const c of topo.comps) {
      if (c.type === 'dc' || c.type === 'ac' || c.type === 'isrc') {
        const n = nets.pinNet.get(pinKey(c.id, 1));
        if (n !== undefined) {
          refNet = n;
          referenceComp = c;
          break;
        }
      }
    }
  }

  const netNode: number[] = [];
  let numNodes = 0;
  nets.pins.forEach((_, i) => {
    netNode[i] = i === refNet ? 0 : ++numNodes;
  });

  const devices = new Map<string, Device>();
  const list: Device[] = [];
  for (const c of topo.comps) {
    const def = getDef(c.type);
    if (!def.build) continue;
    const nodes = def.pins.map((_, i) => {
      const n = nets.pinNet.get(pinKey(c.id, i));
      return n === undefined ? ++numNodes : netNode[n];
    });
    const dev = def.build(c, nodes);
    devices.set(c.id, dev);
    list.push(dev);
  }

  const sim = new Simulator(numNodes, list);
  if (prev) {
    sim.time = prev.sim.time;
    sim.nonConvergedSteps = 0;
    for (const [id, dev] of devices) {
      const old = prev.devices.get(id);
      if (!old || old.constructor !== dev.constructor) continue;
      const st = old.saveState();
      if (st !== undefined) dev.loadState(st);
    }
  }

  const { treeSteps, vertexIndex } = buildSpanningTree(topo);

  return {
    view,
    topo,
    nets,
    sim,
    devices,
    netNode,
    hasGround: gndNet !== undefined,
    referenceComp,
    edgeCurrents: new Float64Array(topo.edges.length),
    treeSteps,
    vertexIndex,
    edgePhase: new Float64Array(topo.edges.length),
  };
}

/** 導線可能成環：只在生成樹上分配電流，其餘導線視為 0。 */
function buildSpanningTree(topo: Topology): { treeSteps: TreeStep[]; vertexIndex: Map<string, number> } {
  const vertexIndex = new Map<string, number>();
  const idx = (v: string) => {
    let i = vertexIndex.get(v);
    if (i === undefined) {
      i = vertexIndex.size;
      vertexIndex.set(v, i);
    }
    return i;
  };
  for (const v of topo.pinVertex.values()) idx(v);
  const adj: { to: number; edge: number; sign: number }[][] = [];
  const push = (i: number, item: { to: number; edge: number; sign: number }) => {
    (adj[i] ??= []).push(item);
  };
  topo.edges.forEach((e, k) => {
    const a = idx(e.a);
    const b = idx(e.b);
    push(a, { to: b, edge: k, sign: 1 });
    push(b, { to: a, edge: k, sign: -1 });
  });
  const seen = new Set<number>();
  const treeSteps: TreeStep[] = [];
  for (let start = 0; start < vertexIndex.size; start++) {
    if (seen.has(start)) continue;
    seen.add(start);
    const queue = [start];
    for (let q = 0; q < queue.length; q++) {
      const u = queue[q];
      for (const { to, edge, sign } of adj[u] ?? []) {
        if (seen.has(to)) continue;
        seen.add(to);
        queue.push(to);
        treeSteps.push({ edge, child: to, parent: u, sign });
      }
    }
  }
  return { treeSteps, vertexIndex };
}

/** 由各腳流入元件的電流，推算每段導線上的電流。 */
export function updateEdgeCurrents(c: Compiled): void {
  const demand = new Float64Array(c.vertexIndex.size);
  for (const comp of c.topo.comps) {
    const dev = c.devices.get(comp.id);
    if (!dev) continue;
    getDef(comp.type).pins.forEach((_, i) => {
      const v = c.topo.pinVertex.get(pinKey(comp.id, i));
      if (v === undefined) return;
      const idx = c.vertexIndex.get(v);
      if (idx !== undefined && i < dev.currents.length) demand[idx] += dev.currents[i];
    });
  }
  c.edgeCurrents.fill(0);
  for (let i = c.treeSteps.length - 1; i >= 0; i--) {
    const st = c.treeSteps[i];
    // 子樹需要的電流由父節點經這段導線送過去。
    c.edgeCurrents[st.edge] = st.sign * demand[st.child];
    demand[st.parent] += demand[st.child];
  }
}

/** 腳的電壓（相對參考點）。 */
export function pinVoltage(c: Compiled, compId: string, pin: number): number {
  const n = c.nets.pinNet.get(pinKey(compId, pin));
  return n === undefined ? 0 : c.sim.v(c.netNode[n]);
}

/** 頂點的電壓。 */
export function vertexVoltage(c: Compiled, vertex: string): number | null {
  const n = c.nets.vertexNet.get(vertex);
  return n === undefined ? null : c.sim.v(c.netNode[n]);
}

/** 流入某腳的電流（A）。 */
export function pinCurrent(c: Compiled, compId: string, pin: number): number {
  return c.devices.get(compId)?.currents[pin] ?? 0;
}

/** 兩隻腳是否接在一起。 */
export function connected(c: Compiled, a: string, pa: number, b: string, pb: number): boolean {
  const na = c.nets.pinNet.get(pinKey(a, pa));
  const nb = c.nets.pinNet.get(pinKey(b, pb));
  return na !== undefined && na === nb;
}
