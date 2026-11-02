// 麵包板對照電路圖：逐項指出哪些腳少接、哪些腳多接。

import { getDef } from './catalog';
import { buildBBTopology, buildSchTopology, computeNets, NetPin } from './topology';
import { CircuitDoc, Comp, pinKey } from './types';

export interface CompareIssue {
  kind: 'missing' | 'extra';
  text: string;
  pins: NetPin[];
}

export interface CompareResult {
  ok: boolean;
  /** 電路圖有、麵包板還沒放的元件。 */
  unplaced: Comp[];
  issues: CompareIssue[];
  /** 無法逐腳比對的元件（例如邏輯閘符號對應 IC）。 */
  skipped: Comp[];
  /** 實際比對的元件數。 */
  compared: number;
}

const SCH_ONLY = new Set(['gnd']);

function pinLabel(doc: CircuitDoc, p: NetPin): string {
  const c = doc.comps.find((x) => x.id === p.compId)!;
  return `${c.ref} 的「${getDef(c.type).pins[p.pin].name}」`;
}

export function compareViews(doc: CircuitDoc): CompareResult {
  const sch = buildSchTopology(doc);
  const bb = buildBBTopology(doc);
  const schNets = computeNets(sch);
  const bbNets = computeNets(bb);

  const unplaced: Comp[] = [];
  const skipped: Comp[] = [];
  const shared = new Set<string>();
  for (const c of doc.comps) {
    if (!c.sch || SCH_ONLY.has(c.type)) continue;
    const def = getDef(c.type);
    if (!def.bb) skipped.push(c);
    else if (!c.bb) unplaced.push(c);
    else shared.add(c.id);
  }

  const relevant = (p: NetPin) => shared.has(p.compId) && !getDef(doc.comps.find((c) => c.id === p.compId)!.type).pins[p.pin].optional;
  const issues: CompareIssue[] = [];

  // 電路圖接在一起，但麵包板上沒接在一起。
  for (const netPins of schNets.pins) {
    const pins = netPins.filter((p) => shared.has(p.compId));
    if (pins.length < 2) continue;
    const groups = new Map<number, NetPin[]>();
    for (const p of pins) {
      const n = bbNets.pinNet.get(pinKey(p.compId, p.pin));
      if (n === undefined) continue;
      if (!groups.has(n)) groups.set(n, []);
      groups.get(n)!.push(p);
    }
    if (groups.size > 1) {
      const parts = [...groups.values()].map((g) => g.map((p) => pinLabel(doc, p)).join('、'));
      issues.push({ kind: 'missing', text: `少接：${parts.join(' 應該和 ')} 相連。`, pins });
    }
  }

  // 麵包板接在一起，但電路圖沒有。
  for (const netPins of bbNets.pins) {
    const pins = netPins.filter((p) => shared.has(p.compId) && relevant(p));
    if (pins.length < 2) continue;
    const groups = new Map<number, NetPin[]>();
    for (const p of pins) {
      const n = schNets.pinNet.get(pinKey(p.compId, p.pin));
      if (n === undefined) continue;
      if (!groups.has(n)) groups.set(n, []);
      groups.get(n)!.push(p);
    }
    if (groups.size > 1) {
      const parts = [...groups.values()].map((g) => g.map((p) => pinLabel(doc, p)).join('、'));
      issues.push({ kind: 'extra', text: `多接：${parts.join(' 和 ')} 不該相連，檢查是否插在同一條導通片上。`, pins });
    }
  }

  return { ok: issues.length === 0 && unplaced.length === 0 && shared.size > 0, unplaced, issues, skipped, compared: shared.size };
}
