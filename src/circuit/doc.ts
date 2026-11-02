// 電路文件的操作：新增元件、編號、存檔與讀檔。

import { CATALOG, defaultParams, getDef } from './catalog';
import { BBPlace, BBWire, CircuitDoc, Comp, newDoc, ParamValue, Point, SchPlace, SchWire } from './types';

export function nextId(doc: CircuitDoc, prefix = 'c'): string {
  return `${prefix}${doc.nextId++}`;
}

/** 配一個不重複的代號，例如 R1、R2。 */
export function nextRef(doc: CircuitDoc, type: string): string {
  const prefix = getDef(type).prefix;
  if (type === 'gnd') return 'GND';
  let i = 1;
  const used = new Set(doc.comps.map((c) => c.ref));
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

export function addComp(
  doc: CircuitDoc,
  type: string,
  place: { sch?: SchPlace; bb?: BBPlace },
  params?: Record<string, ParamValue>,
  ref?: string,
): Comp {
  const comp: Comp = {
    id: nextId(doc),
    type,
    ref: ref ?? nextRef(doc, type),
    params: { ...defaultParams(type), ...params },
    ...place,
  };
  doc.comps.push(comp);
  return comp;
}

export function addSchWire(doc: CircuitDoc, pts: Point[]): SchWire {
  const w: SchWire = { id: nextId(doc, 'w'), pts };
  doc.schWires.push(w);
  return w;
}

const JUMPER_COLORS = ['#d3232a', '#1f6fd6', '#2c9b3f', '#e08a12', '#7a3fb0', '#121212', '#0d9488'];

export function addBBWire(doc: CircuitDoc, a: string, b: string, color?: string): BBWire {
  const w: BBWire = {
    id: nextId(doc, 'j'),
    a,
    b,
    color: color ?? JUMPER_COLORS[doc.bbWires.length % JUMPER_COLORS.length],
  };
  doc.bbWires.push(w);
  return w;
}

export function removeComp(doc: CircuitDoc, id: string): void {
  doc.comps = doc.comps.filter((c) => c.id !== id);
  doc.probes = doc.probes.filter((p) => p.compId !== id);
  doc.bbWires = doc.bbWires.filter((w) => !w.a.startsWith(`t:${id}:`) && !w.b.startsWith(`t:${id}:`));
}

export function serializeDoc(doc: CircuitDoc): string {
  return JSON.stringify(doc);
}

/** 讀檔。內容不對時丟出例外，呼叫端要提示使用者。 */
export function parseDoc(text: string): CircuitDoc {
  const raw = JSON.parse(text);
  if (raw?.version !== 1 || !Array.isArray(raw.comps)) throw new Error('這不是電路檔');
  const doc = newDoc(typeof raw.title === 'string' ? raw.title : '未命名電路');
  doc.speed = typeof raw.speed === 'number' && raw.speed > 0 ? raw.speed : doc.speed;
  doc.schWires = Array.isArray(raw.schWires) ? raw.schWires : [];
  doc.bbWires = Array.isArray(raw.bbWires) ? raw.bbWires : [];
  doc.probes = Array.isArray(raw.probes) ? raw.probes : [];
  doc.nextId = typeof raw.nextId === 'number' ? raw.nextId : 1;
  doc.comps = raw.comps.filter((c: Comp) => CATALOG.has(c.type));
  for (const c of doc.comps) c.params = { ...defaultParams(c.type), ...c.params };
  doc.nextId = Math.max(doc.nextId, doc.comps.length + doc.schWires.length + doc.bbWires.length + 1);
  return doc;
}

export const cloneDoc = (doc: CircuitDoc): CircuitDoc => JSON.parse(JSON.stringify(doc));
