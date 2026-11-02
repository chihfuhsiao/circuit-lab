// 內建內容要能實際運作：接線完整、數值符合課本、實驗解答通過自動檢查。
import { describe, expect, it } from 'vitest';
import { compile, Compiled, pinVoltage } from '../src/circuit/compile';
import { liveDiagnostics, staticDiagnostics } from '../src/circuit/diagnostics';
import { getDef } from '../src/circuit/catalog';
import { CircuitDoc, Comp } from '../src/circuit/types';
import { Led } from '../src/engine/analog';
import { EXAMPLES } from '../src/content/examples';
import { Check, EXPERIMENTS } from '../src/content/experiments';
import { decodeDoc, encodeDoc } from '../src/ui/file';

const STEPS_PER_SEC = 1000;

function run(c: Compiled, doc: CircuitDoc, realSeconds: number, each?: () => void): void {
  const dt = doc.speed / STEPS_PER_SEC;
  const n = Math.round(realSeconds * STEPS_PER_SEC);
  for (let i = 0; i < n; i++) {
    c.sim.step(dt);
    each?.();
  }
}

const example = (id: string) => EXAMPLES.find((e) => e.id === id)!;
const byRef = (doc: CircuitDoc, ref: string): Comp => doc.comps.find((c) => c.ref === ref)!;

describe('內建範例', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.title}：接線完整，執行不出錯`, () => {
      const doc = ex.build();
      const c = compile(doc, ex.view);
      const warnings = staticDiagnostics(c).filter((d) => d.level === 'warn');
      expect(warnings.map((d) => d.text)).toEqual([]);
      run(c, doc, 2);
      expect(c.sim.numericFault).toBe(false);
      expect(liveDiagnostics(c).filter((d) => d.level === 'error').map((d) => d.text)).toEqual([]);
      expect(c.sim.nonConvergedSteps).toBe(0);
    });
  }

  it('所有元件都有放在範例指定的畫面', () => {
    for (const ex of EXAMPLES) {
      const doc = ex.build();
      for (const comp of doc.comps) {
        if (ex.view === 'bb' && !getDef(comp.type).bb) continue;
        expect(ex.view === 'sch' ? comp.sch : comp.bb, `${ex.id} ${comp.ref}`).toBeTruthy();
      }
    }
  });

  it('串聯分壓：12V 經 1k、2k，中點 8V', () => {
    const doc = example('divider').build();
    const c = compile(doc, 'sch');
    run(c, doc, 0.05);
    expect(pinVoltage(c, byRef(doc, 'R2').id, 0)).toBeCloseTo(8, 2);
  });

  it('惠斯登電橋平衡時電錶讀 0', () => {
    const doc = example('bridge').build();
    const c = compile(doc, 'sch');
    run(c, doc, 0.05);
    const m = byRef(doc, 'M1');
    expect(Math.abs(pinVoltage(c, m.id, 0) - pinVoltage(c, m.id, 1))).toBeLessThan(1e-3);
  });

  it('全波整流：輸出沒有負電壓，峰值少兩個壓降', () => {
    const doc = example('fullwave').build();
    const c = compile(doc, 'sch');
    const r = byRef(doc, 'R1');
    let max = -99;
    let min = 99;
    run(c, doc, 3, () => {
      const v = pinVoltage(c, r.id, 0);
      max = Math.max(max, v);
      min = Math.min(min, v);
    });
    expect(max).toBeGreaterThan(8.3);
    expect(max).toBeLessThan(9);
    expect(min).toBeGreaterThan(-0.2);
  });

  it('齊納穩壓輸出接近 5.1V', () => {
    const doc = example('zener').build();
    const c = compile(doc, 'sch');
    run(c, doc, 0.2);
    const v = pinVoltage(c, byRef(doc, 'RL').id, 0);
    expect(v).toBeGreaterThan(5);
    expect(v).toBeLessThan(5.4);
  });

  it('共射極放大器：偏壓正確且有放大', () => {
    const doc = example('ceamp').build();
    const c = compile(doc, 'sch');
    const q = byRef(doc, 'Q1');
    let max = -99;
    let min = 99;
    run(c, doc, 8, () => {
      if (c.sim.time > 0.03) {
        const v = pinVoltage(c, q.id, 1);
        max = Math.max(max, v);
        min = Math.min(min, v);
      }
    });
    const vb = pinVoltage(c, q.id, 0);
    expect(vb).toBeGreaterThan(1.5);
    expect(vb).toBeLessThan(2.5);
    // 輸入峰峰值 20 mV，增益應該有 100 倍以上
    expect(max - min).toBeGreaterThan(2);
    expect(max).toBeLessThan(12);
  });

  it('反相放大器：輸出振幅約 10 倍', () => {
    const doc = example('inverting').build();
    const c = compile(doc, 'sch');
    const u = byRef(doc, 'U1');
    let max = -99;
    run(c, doc, 2, () => {
      max = Math.max(max, pinVoltage(c, u.id, 2));
    });
    expect(Math.abs(max - 5)).toBeLessThan(0.2);
  });

  it('555 閃爍器真的會閃', () => {
    const doc = example('ne555').build();
    const c = compile(doc, 'sch');
    const led = c.devices.get(byRef(doc, 'LED1').id) as Led;
    let on = false;
    let off = false;
    run(c, doc, 3, () => {
      if (led.id > 0.003) on = true;
      if (led.id < 1e-5 && c.sim.time > 0.2) off = true;
    });
    expect(on).toBe(true);
    expect(off).toBe(true);
    expect(led.burned).toBe(false);
  });

  it('RLC 諧振時電容電壓被放大', () => {
    const doc = example('rlc').build();
    const c = compile(doc, 'sch');
    const cap = byRef(doc, 'C1');
    let max = 0;
    run(c, doc, 5, () => {
      max = Math.max(max, pinVoltage(c, cap.id, 0));
    });
    // Q = (1/R)·√(L/C) = 5，1V 輸入約得 5V
    expect(max).toBeGreaterThan(4);
    expect(max).toBeLessThan(6);
  });

  it('麵包板 LED 範例的 LED 會亮', () => {
    const doc = example('bbled').build();
    const c = compile(doc, 'bb');
    run(c, doc, 0.2);
    expect((c.devices.get(byRef(doc, 'LED1').id) as Led).id).toBeGreaterThan(0.008);
  });

  it('麵包板 7400 範例：輸入接地時 LED 亮，開關斷開時滅', () => {
    const doc = example('bbnand').build();
    const c = compile(doc, 'bb');
    run(c, doc, 0.1);
    expect((c.devices.get(byRef(doc, 'LED1').id) as Led).id).toBeGreaterThan(0.003);
    byRef(doc, 'SW1').params.closed = false;
    const c2 = compile(doc, 'bb', c);
    run(c2, doc, 0.1);
    expect((c2.devices.get(byRef(doc, 'LED1').id) as Led).id).toBeLessThan(1e-4);
  });
});

describe('模擬速度提醒', () => {
  it('頻率對模擬速度太高時提醒，調慢後消失', () => {
    const doc = example('rlc').build();
    doc.speed = 0.1;
    const fast = compile(doc, 'sch');
    run(fast, doc, 0.05);
    expect(liveDiagnostics(fast).some((d) => d.text.includes('模擬速度'))).toBe(true);
    doc.speed = 0.002;
    const slow = compile(doc, 'sch');
    run(slow, doc, 0.05);
    expect(liveDiagnostics(slow).some((d) => d.text.includes('模擬速度'))).toBe(false);
  });

  it('所有內建範例在預設速度下都不會出現這個提醒', () => {
    for (const ex of EXAMPLES) {
      const doc = ex.build();
      const c = compile(doc, ex.view);
      run(c, doc, 0.05);
      expect(liveDiagnostics(c).filter((d) => d.text.includes('模擬速度')).map((d) => `${ex.id}: ${d.text}`)).toEqual([]);
    }
  });
});

describe('分享連結', () => {
  it('編碼再解碼內容相同，連結也夠短', async () => {
    const doc = example('ne555').build();
    const token = await encodeDoc(doc);
    const back = await decodeDoc(token);
    expect(back.comps).toEqual(doc.comps);
    expect(back.schWires).toEqual(doc.schWires);
    expect(token.length).toBeLessThan(3000);
  });
});

describe('引導實驗', () => {
  for (const e of EXPERIMENTS) {
    it(`${e.title}：解答通過標記的檢查步驟`, () => {
      const doc = e.solution();
      const c = compile(doc, e.view);
      const memo: Record<string, unknown> = {};
      const check = new Check(doc, c, memo);
      const finals = e.steps.filter((s) => s.kind === 'circuit' && s.final);
      expect(finals.length).toBeGreaterThan(0);
      for (const step of finals) {
        if (step.kind !== 'circuit') continue;
        let pass = false;
        // 需要累積波形的步驟要多跑一段時間。
        for (let i = 0; i < 40 && !pass; i++) {
          run(c, doc, 0.25);
          pass = step.check(check);
        }
        expect(pass, step.text).toBe(true);
      }
    });

    it(`${e.title}：空白電路不會直接過關`, () => {
      const doc = e.starter();
      const c = compile(doc, e.view);
      const check = new Check(doc, c, {});
      run(c, doc, 0.1);
      const first = e.steps.find((s) => s.kind === 'circuit');
      if (first?.kind === 'circuit') expect(first.check(check)).toBe(false);
    });

    it(`${e.title}：問答的答案編號有效`, () => {
      for (const s of e.steps) {
        if (s.kind === 'quiz') {
          expect(s.answer).toBeLessThan(s.options.length);
          expect(s.explain.length).toBeGreaterThan(0);
        }
      }
    });
  }

  it('LED 實驗第一步：直接接 5V 才算過關', () => {
    const e = EXPERIMENTS.find((x) => x.id === 'led')!;
    const doc = e.solution();
    const c = compile(doc, 'sch');
    run(c, doc, 0.2);
    const first = e.steps[0];
    expect(first.kind === 'circuit' && first.check(new Check(doc, c, {}))).toBe(false);
  });
});
