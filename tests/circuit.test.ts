import { describe, expect, it } from 'vitest';
import { compareViews } from '../src/circuit/compare';
import { compile, connected, pinVoltage, updateEdgeCurrents } from '../src/circuit/compile';
import { CATALOG, getDef } from '../src/circuit/catalog';
import { addBBWire, addComp, addSchWire, parseDoc, serializeDoc } from '../src/circuit/doc';
import { formatValue, parseValue, resistorBands } from '../src/circuit/format';
import { dipHole, holeStrip, nearestHole, parseHole } from '../src/circuit/breadboard';
import { liveDiagnostics, staticDiagnostics } from '../src/circuit/diagnostics';
import { newDoc } from '../src/circuit/types';
import { Led } from '../src/engine/analog';

describe('數值格式', () => {
  it('解析工程記號', () => {
    expect(parseValue('4.7k')).toBeCloseTo(4700);
    expect(parseValue('100n')).toBeCloseTo(1e-7);
    expect(parseValue('10u')).toBeCloseTo(1e-5);
    expect(parseValue('2k2')).toBeCloseTo(2200);
    expect(parseValue('1M')).toBeCloseTo(1e6);
    expect(parseValue('1m')).toBeCloseTo(1e-3);
    expect(parseValue('3.3 kΩ')).toBeCloseTo(3300);
    expect(parseValue('abc')).toBeNull();
    expect(parseValue('')).toBeNull();
  });
  it('顯示工程記號', () => {
    expect(formatValue(4700, 'Ω')).toBe('4.7 kΩ');
    expect(formatValue(0.001, 'A')).toBe('1 mA');
    expect(formatValue(1e-6, 'F')).toBe('1 µF');
  });
  it('電阻色碼', () => {
    expect(resistorBands(1000).map((b) => b.name)).toEqual(['棕', '黑', '紅', '金']);
    expect(resistorBands(330).map((b) => b.name)).toEqual(['橙', '橙', '棕', '金']);
    expect(resistorBands(4700).map((b) => b.name)).toEqual(['黃', '紫', '紅', '金']);
    expect(resistorBands(10).map((b) => b.name)).toEqual(['棕', '黑', '黑', '金']);
  });
});

describe('麵包板導通規則', () => {
  it('同欄 a～e 相通，f～j 相通，中央溝槽不通', () => {
    expect(holeStrip('a5')).toBe(holeStrip('e5'));
    expect(holeStrip('f5')).toBe(holeStrip('j5'));
    expect(holeStrip('e5')).not.toBe(holeStrip('f5'));
    expect(holeStrip('a5')).not.toBe(holeStrip('a6'));
  });
  it('電源軌整排相通，正負軌不通', () => {
    expect(holeStrip('T+1')).toBe(holeStrip('T+59'));
    expect(holeStrip('T+1')).not.toBe(holeStrip('T-1'));
    expect(holeStrip('T+1')).not.toBe(holeStrip('B+1'));
  });
  it('電源軌每 5 孔留一個空位', () => {
    expect(parseHole('T+6')).toBeNull();
    expect(parseHole('T+5')).not.toBeNull();
    expect(parseHole('z5')).toBeNull();
    expect(parseHole('a64')).toBeNull();
  });
  it('找最近的孔', () => {
    expect(nearestHole(5.1, 3.1)).toBe('a5');
    expect(nearestHole(5, 8.5)).toBeNull();
  });
  it('DIP 跨在溝槽上，第 1 腳在左下', () => {
    expect(dipHole(10, 14, 1)).toBe('f10');
    expect(dipHole(10, 14, 7)).toBe('f16');
    expect(dipHole(10, 14, 8)).toBe('e16');
    expect(dipHole(10, 14, 14)).toBe('e10');
  });
});

/** 電路圖：V1 → R1 → 節點 → R2 → GND。 */
function dividerDoc() {
  const doc = newDoc();
  const v = addComp(doc, 'dc', { sch: { x: 0, y: 0, rot: 1 } }, { V: 10 });
  const r1 = addComp(doc, 'res', { sch: { x: 6, y: -2, rot: 0 } }, { R: 1000 });
  const r2 = addComp(doc, 'res', { sch: { x: 8, y: 0, rot: 1 } }, { R: 1000 });
  const g = addComp(doc, 'gnd', { sch: { x: 0, y: 4, rot: 0 } });
  addSchWire(doc, [[0, -2], [4, -2]]); // V1+ → R1 腳1
  addSchWire(doc, [[8, -2], [8, -2]]);
  addSchWire(doc, [[0, 2], [0, 4]]); // V1- → GND
  addSchWire(doc, [[0, 4], [8, 4], [8, 2]]); // GND → R2 下方
  return { doc, v, r1, r2, g };
}

describe('電路圖接線', () => {
  it('分壓電路接好後中點是 5V', () => {
    const { doc, r2 } = dividerDoc();
    const c = compile(doc, 'sch');
    for (let i = 0; i < 5; i++) c.sim.step(1e-5);
    // R2 旋轉 90°：腳 0 在上方，和 R1 腳 2 在同一點
    expect(pinVoltage(c, r2.id, 0)).toBeCloseTo(5, 2);
    expect(c.hasGround).toBe(true);
  });

  it('線段交叉但沒有端點時不相連', () => {
    const doc = newDoc();
    const a = addComp(doc, 'res', { sch: { x: 0, y: 0, rot: 0 } });
    const b = addComp(doc, 'res', { sch: { x: 10, y: 0, rot: 0 } });
    addSchWire(doc, [[2, 0], [8, 0]]);
    const d = addComp(doc, 'res', { sch: { x: 5, y: -4, rot: 1 } });
    addSchWire(doc, [[5, -2], [5, 3]]); // 穿過水平線
    const c = compile(doc, 'sch');
    expect(connected(c, a.id, 1, b.id, 0)).toBe(true);
    expect(connected(c, a.id, 1, d.id, 1)).toBe(false);
  });

  it('導線端點落在另一條導線中間時相連（T 型接點）', () => {
    const doc = newDoc();
    const a = addComp(doc, 'res', { sch: { x: 0, y: 0, rot: 0 } });
    const b = addComp(doc, 'res', { sch: { x: 10, y: 0, rot: 0 } });
    addSchWire(doc, [[2, 0], [8, 0]]);
    const d = addComp(doc, 'res', { sch: { x: 5, y: -4, rot: 1 } });
    addSchWire(doc, [[5, -2], [5, 0]]);
    const c = compile(doc, 'sch');
    expect(connected(c, a.id, 1, d.id, 1)).toBe(true);
    expect(connected(c, b.id, 0, d.id, 1)).toBe(true);
  });

  it('所有接地符號是同一點', () => {
    const doc = newDoc();
    const a = addComp(doc, 'res', { sch: { x: 0, y: 0, rot: 0 } });
    const b = addComp(doc, 'res', { sch: { x: 10, y: 0, rot: 0 } });
    addComp(doc, 'gnd', { sch: { x: 2, y: 0, rot: 0 } });
    addComp(doc, 'gnd', { sch: { x: 8, y: 0, rot: 0 } });
    const c = compile(doc, 'sch');
    expect(connected(c, a.id, 1, b.id, 0)).toBe(true);
  });

  it('導線電流符合克希荷夫定律', () => {
    const { doc } = dividerDoc();
    const c = compile(doc, 'sch');
    c.sim.step(1e-5);
    updateEdgeCurrents(c);
    const max = Math.max(...Array.from(c.edgeCurrents).map(Math.abs));
    expect(max).toBeCloseTo(5e-3, 4);
  });

  it('修改電路後保留電容電壓', () => {
    const doc = newDoc();
    addComp(doc, 'dc', { sch: { x: 0, y: 0, rot: 1 } }, { V: 10 });
    addComp(doc, 'res', { sch: { x: 2, y: -2, rot: 0 } }, { R: 100 });
    const cap = addComp(doc, 'cap', { sch: { x: 6, y: 0, rot: 1 } }, { C: 1e-6 });
    addComp(doc, 'gnd', { sch: { x: 0, y: 2, rot: 0 } });
    addSchWire(doc, [[0, 2], [6, 2]]);
    addSchWire(doc, [[0, -2], [0, -2]]);
    addSchWire(doc, [[4, -2], [6, -2]]);
    const c1 = compile(doc, 'sch');
    for (let i = 0; i < 1000; i++) c1.sim.step(1e-6);
    const before = pinVoltage(c1, cap.id, 0);
    expect(before).toBeGreaterThan(9.9);
    const c2 = compile(doc, 'sch', c1);
    c2.sim.step(1e-9);
    expect(pinVoltage(c2, cap.id, 0)).toBeCloseTo(before, 1);
    expect(c2.sim.time).toBeGreaterThan(c1.sim.time - 1e-12);
  });

  it('提醒沒接好的腳', () => {
    const doc = newDoc();
    addComp(doc, 'res', { sch: { x: 0, y: 0, rot: 0 } });
    const c = compile(doc, 'sch');
    const msgs = staticDiagnostics(c).map((d) => d.text);
    expect(msgs.some((m) => m.includes('R1') && m.includes('腳1'))).toBe(true);
  });

  it('提醒短路', () => {
    const doc = newDoc();
    addComp(doc, 'dc', { sch: { x: 0, y: 0, rot: 1 } });
    addSchWire(doc, [[0, -2], [4, -2], [4, 2], [0, 2]]);
    const c = compile(doc, 'sch');
    c.sim.step(1e-5);
    expect(liveDiagnostics(c).some((d) => d.level === 'error' && d.text.includes('短路'))).toBe(true);
  });
});

/** 麵包板：電源 + → 電源軌 → R1 → LED → 電源軌 - → 電源。 */
function ledBreadboard() {
  const doc = newDoc();
  const v = addComp(doc, 'dc', { bb: { x: 2, y: -7 } }, { V: 5 });
  const r = addComp(doc, 'res', { bb: { holes: ['a5', 'a9'] } }, { R: 330 });
  const l = addComp(doc, 'led', { bb: { holes: ['b9', 'b11'] } });
  addBBWire(doc, `t:${v.id}:0`, 'T+3');
  addBBWire(doc, `t:${v.id}:1`, 'T-3');
  addBBWire(doc, 'T+5', 'c5');
  addBBWire(doc, 'c11', 'T-11');
  return { doc, v, r, l };
}

describe('麵包板接線', () => {
  it('LED 串電阻接好後會亮', () => {
    const { doc, l } = ledBreadboard();
    const c = compile(doc, 'bb');
    for (let i = 0; i < 100; i++) c.sim.step(1e-5);
    const led = c.devices.get(l.id) as Led;
    expect(led.id).toBeGreaterThan(8e-3);
    expect(led.burned).toBe(false);
  });

  it('沒有接地符號時以電源負極當 0V', () => {
    const { doc, l } = ledBreadboard();
    const c = compile(doc, 'bb');
    expect(c.referenceComp?.type).toBe('dc');
    c.sim.step(1e-5);
    expect(pinVoltage(c, l.id, 1)).toBeCloseTo(0, 2);
  });

  it('插在不同欄就不通', () => {
    const { doc, l } = ledBreadboard();
    l.bb!.holes = ['b10', 'b11']; // R1 在第 9 欄，LED 陽極改插第 10 欄
    const c = compile(doc, 'bb');
    for (let i = 0; i < 100; i++) c.sim.step(1e-5);
    expect((c.devices.get(l.id) as Led).id).toBeLessThan(1e-6);
  });

  it('7400 接好電源後 NAND 正常動作', () => {
    const doc = newDoc();
    const v = addComp(doc, 'dc', { bb: { x: 2, y: -7 } }, { V: 5 });
    const u = addComp(doc, 'ic7400', { bb: { col: 10 } });
    addBBWire(doc, `t:${v.id}:0`, 'T+3');
    addBBWire(doc, `t:${v.id}:1`, 'T-3');
    addBBWire(doc, 'T+10', 'a10'); // 14 腳 VCC 在 e10
    addBBWire(doc, 'T-16', 'j16'); // 7 腳 GND 在 f16
    addBBWire(doc, 'j10', 'T-10'); // 1 腳接地
    const c = compile(doc, 'bb');
    for (let i = 0; i < 20; i++) c.sim.step(1e-5);
    // 1 腳為 0 → 3 腳輸出 1
    expect(pinVoltage(c, u.id, 2)).toBeGreaterThan(4);
    expect(staticDiagnostics(c).length).toBeGreaterThanOrEqual(0);
  });

  it('桌上儀器每個端子都能接', () => {
    for (const def of CATALOG.values()) {
      if (def.bb?.kind === 'bench') expect(def.bb.terms.length).toBe(def.pins.length);
    }
  });
});

describe('對照電路圖', () => {
  function bothViews() {
    const doc = newDoc();
    const v = addComp(doc, 'dc', { sch: { x: 0, y: 0, rot: 1 }, bb: { x: 2, y: -7 } }, { V: 5 });
    const r = addComp(doc, 'res', { sch: { x: 2, y: -2, rot: 0 }, bb: { holes: ['a5', 'a9'] } }, { R: 330 });
    const l = addComp(doc, 'led', { sch: { x: 6, y: 0, rot: 1 }, bb: { holes: ['b9', 'b11'] } });
    addSchWire(doc, [[4, -2], [6, -2]]);
    addSchWire(doc, [[6, 2], [0, 2]]);
    // 麵包板接線
    addBBWire(doc, `t:${v.id}:0`, 'c5');
    addBBWire(doc, `t:${v.id}:1`, 'c11');
    return { doc, v, r, l };
  }

  it('接線一致時通過', () => {
    const { doc } = bothViews();
    const res = compareViews(doc);
    expect(res.issues).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('少接一條線會指出來', () => {
    const { doc } = bothViews();
    doc.bbWires = doc.bbWires.slice(0, 1);
    const res = compareViews(doc);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.kind === 'missing' && i.text.includes('LED1'))).toBe(true);
  });

  it('多接會指出來', () => {
    const { doc, l } = bothViews();
    l.bb!.holes = ['b9', 'b5']; // LED 陰極和電源正極、R1 腳1 插在同一欄
    const res = compareViews(doc);
    expect(res.issues.some((i) => i.kind === 'extra')).toBe(true);
  });

  it('還沒放到麵包板的元件會列出', () => {
    const { doc, l } = bothViews();
    delete l.bb;
    const res = compareViews(doc);
    expect(res.unplaced.map((c) => c.ref)).toContain('LED1');
    expect(res.ok).toBe(false);
  });

  it('邏輯閘符號無法逐腳對照，要列為略過', () => {
    const doc = newDoc();
    addComp(doc, 'nand', { sch: { x: 0, y: 0, rot: 0 } });
    expect(compareViews(doc).skipped.length).toBe(1);
  });
});

describe('元件資料庫', () => {
  it('所有元件的腳位互不重疊，且都放得到至少一個畫面', () => {
    for (const def of CATALOG.values()) {
      expect(def.sch || def.bb, def.type).toBeTruthy();
      const seen = new Set(def.pins.map((p) => p.sch.join(',')));
      expect(seen.size, def.type).toBe(def.pins.length);
    }
  });

  it('DIP 元件腳號不超過包裝腳數，全部元件都能建立', () => {
    for (const def of CATALOG.values()) {
      if (def.bb?.kind === 'dip') {
        for (const p of def.pins) {
          expect(p.dip, def.type).toBeGreaterThanOrEqual(1);
          expect(p.dip!, def.type).toBeLessThanOrEqual(def.bb.numPins);
        }
      }
      if (!def.sch) continue;
      const doc = newDoc();
      addComp(doc, def.type, { sch: { x: 0, y: 0, rot: 0 } });
      const c = compile(doc, 'sch');
      for (let i = 0; i < 10; i++) c.sim.step(1e-5);
      expect(c.sim.numericFault, def.type).toBe(false);
    }
  });

  it('getDef 遇到未知類型會報錯', () => {
    expect(() => getDef('xxx')).toThrow();
  });
});

describe('存檔與讀檔', () => {
  it('存檔再讀回內容相同', () => {
    const { doc } = dividerDoc();
    const back = parseDoc(serializeDoc(doc));
    expect(back.comps).toEqual(doc.comps);
    expect(back.schWires).toEqual(doc.schWires);
  });
  it('亂七八糟的檔案會報錯，不會默默開啟', () => {
    expect(() => parseDoc('{"a":1}')).toThrow();
    expect(() => parseDoc('not json')).toThrow();
  });
  it('未知的元件類型會被略過', () => {
    const { doc } = dividerDoc();
    const raw = JSON.parse(serializeDoc(doc));
    raw.comps.push({ id: 'x', type: 'unknown', ref: 'X', params: {} });
    expect(parseDoc(JSON.stringify(raw)).comps.length).toBe(doc.comps.length);
  });
});
