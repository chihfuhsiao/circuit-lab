// 引導實驗。電路步驟由模擬結果自動檢查；問答步驟由學生作答。

import { Led, Meter } from '../engine/analog';
import { Chip } from '../engine/digital';
import { Device } from '../engine/sim';
import { compareViews } from '../circuit/compare';
import { Compiled, connected, pinCurrent, pinVoltage } from '../circuit/compile';
import { CircuitDoc, Comp, newDoc, pinKey, ViewKind } from '../circuit/types';
import { CircuitBuilder } from './builder';

/** 自動檢查可用的工具。 */
export class Check {
  constructor(
    readonly doc: CircuitDoc,
    readonly c: Compiled,
    readonly memo: Record<string, any>,
  ) {}

  comps(type: string): Comp[] {
    return this.c.topo.comps.filter((x) => x.type === type);
  }
  one(type: string): Comp | undefined {
    return this.comps(type)[0];
  }
  dev(c: Comp): Device | undefined {
    return this.c.devices.get(c.id);
  }
  conn(a: Comp, pa: number, b: Comp, pb: number): boolean {
    return connected(this.c, a.id, pa, b.id, pb);
  }
  across(c: Comp): number {
    return pinVoltage(this.c, c.id, 0) - pinVoltage(this.c, c.id, 1);
  }
  v(c: Comp, pin: number): number {
    return pinVoltage(this.c, c.id, pin);
  }
  i(c: Comp, pin = 0): number {
    return Math.abs(pinCurrent(this.c, c.id, pin));
  }
  near(value: number, target: number, tol = 0.06): boolean {
    return Math.abs(value - target) <= Math.abs(target) * tol;
  }
  /** 找到符合條件的電錶讀值。 */
  meter(mode: string): Meter | undefined {
    const m = this.comps('meter').find((x) => x.params.mode === mode);
    const d = m && this.dev(m);
    return d instanceof Meter ? d : undefined;
  }
  led(c: Comp): Led | undefined {
    const d = this.dev(c);
    return d instanceof Led ? d : undefined;
  }
  anyBurned(): boolean {
    return this.comps('led').some((l) => this.led(l)?.burned);
  }
  hasProbeOnNetOf(c: Comp, pin: number): boolean {
    const net = this.c.nets.pinNet.get(pinKey(c.id, pin));
    return this.doc.probes.some((p) => this.c.nets.pinNet.get(pinKey(p.compId, p.pin)) === net);
  }
  /** 記錄一段模擬時間內的最小與最大值。 */
  window(key: string, value: number, seconds: number): { min: number; max: number; full: boolean } {
    const t = this.c.sim.time;
    const list: [number, number][] = (this.memo[key] ??= []);
    list.push([t, value]);
    while (list.length && t - list[0][0] > seconds) list.shift();
    const vals = list.map((x) => x[1]);
    const span = list.length ? t - list[0][0] : 0;
    return { min: Math.min(...vals), max: Math.max(...vals), full: span >= seconds * 0.8 };
  }
}

export interface CircuitStep {
  kind: 'circuit';
  text: string;
  hint?: string;
  check: (k: Check) => boolean;
  /** 額外的進度文字。 */
  progress?: (k: Check) => string;
  /** 解答電路應該要能通過這一步（測試用）。 */
  final?: boolean;
}

export interface QuizStep {
  kind: 'quiz';
  text: string;
  options: string[];
  answer: number;
  explain: string;
}

export type Step = CircuitStep | QuizStep;

export interface Experiment {
  id: string;
  title: string;
  course: '基本電學' | '電子學' | '數位邏輯' | '麵包板實作';
  goal: string;
  view: ViewKind;
  starter: () => CircuitDoc;
  steps: Step[];
  /** 完成的電路，可以在實驗面板載入參考。 */
  solution: () => CircuitDoc;
}

const blank = (title: string, speed = 0.1): CircuitDoc => {
  const d = newDoc(title);
  d.speed = speed;
  return d;
};

const circuit = (text: string, check: CircuitStep['check'], hint?: string, extra?: Partial<CircuitStep>): CircuitStep => ({ kind: 'circuit', text, check, hint, ...extra });
const quiz = (text: string, options: string[], answer: number, explain: string): QuizStep => ({ kind: 'quiz', text, options, answer, explain });

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'ohm',
    title: '歐姆定律',
    course: '基本電學',
    goal: '用電流檔量測，驗證 I = V / R。',
    view: 'sch',
    starter: () => blank('實驗：歐姆定律'),
    steps: [
      circuit('從左邊放一個「直流電源」和一個「接地」。點選電源，把電壓改成 10 V。', (k) => {
        const v = k.one('dc');
        return !!v && k.near(Number(v.params.V), 10, 0.001) && !!k.one('gnd');
      }, '點一下元件，右邊的屬性面板就能改數值。'),
      circuit('放一個 1 kΩ「電阻」和一個「三用電錶」，把電錶的檔位切到「直流電流 DCA」。', (k) => {
        return k.comps('res').some((r) => k.near(Number(r.params.R), 1000, 0.001)) && k.comps('meter').some((m) => m.params.mode === 'dca');
      }),
      circuit('接成一個迴路：電源正極 → 電錶紅棒，電錶黑棒 → 電阻 → 電源負極。電流檔要串聯在電路中。', (k) => {
        const m = k.meter('dca');
        return !!m && k.near(m.reading, 0.01);
      }, '從元件的腳拖曳到另一隻腳就能接線。別忘了把電源負極接到接地。', { final: true }),
      quiz('電錶現在讀到多少？', ['1 mA', '10 mA', '100 mA'], 1, 'I = V / R = 10 V ÷ 1 kΩ = 10 mA。'),
      circuit('把電阻改成 2 kΩ，看看電流怎麼變。', (k) => {
        const m = k.meter('dca');
        return !!m && k.near(m.reading, 0.005);
      }),
      quiz('電阻變成兩倍時，電流會？', ['變成兩倍', '不變', '變成一半'], 2, '電壓固定時，電流和電阻成反比。'),
    ],
    solution: () => {
      const b = new CircuitBuilder('實驗：歐姆定律（解答）');
      b.sch('dc', 'V1', 0, 0, { V: 10 }).sch('meter', 'M1', 4, -4, { mode: 'dca' }).sch('res', 'R1', 10, 0, { R: 1000 }, 1).sch('gnd', 'GND', 0, 4);
      b.w('V1.0', [0, -4], 'M1.0').w('M1.1', [10, -4], 'R1.0').w('R1.1', [10, 4], 'GND.0').w('V1.1', 'GND.0');
      return b.done();
    },
  },
  {
    id: 'divider',
    title: '分壓定則',
    course: '基本電學',
    goal: '串聯電阻依比例分配電壓：V₂ = V × R₂ / (R₁ + R₂)。',
    view: 'sch',
    starter: () => blank('實驗：分壓定則'),
    steps: [
      circuit('接一個 12 V 電源，串聯 1 kΩ 和 2 kΩ 兩個電阻，電源負極接地。', (k) => {
        const r = k.comps('res');
        const one = r.find((x) => k.near(Number(x.params.R), 1000, 0.001));
        const two = r.find((x) => k.near(Number(x.params.R), 2000, 0.001));
        return !!one && !!two && k.near(k.i(one), 0.004) && k.near(k.i(two), 0.004);
      }, '串聯時兩個電阻流過相同電流，應該都是 4 mA。把滑鼠移到元件上可以看電流。', { final: true }),
      circuit('放一個三用電錶，切到「直流電壓 DCV」，並聯在 2 kΩ 電阻兩端。', (k) => {
        const m = k.meter('dcv');
        return !!m && k.near(Math.abs(m.reading), 8);
      }, '電壓檔要並聯：紅棒、黑棒分別接電阻的兩隻腳。', { final: true }),
      quiz('用分壓定則算算看，2 kΩ 上的電壓應該是多少？', ['4 V', '8 V', '12 V'], 1, '12 × 2k ÷ (1k + 2k) = 8 V，和電錶讀值相同。'),
      circuit('把 2 kΩ 改成 1 kΩ，讀值應該變成多少？', (k) => {
        const m = k.meter('dcv');
        return !!m && k.near(Math.abs(m.reading), 6);
      }),
      quiz('串聯電路中，哪個電阻分到的電壓比較多？', ['電阻值較大的', '電阻值較小的', '一樣多'], 0, '電流相同，V = IR，電阻越大壓降越大。'),
    ],
    solution: () => {
      const b = new CircuitBuilder('實驗：分壓定則（解答）');
      b.sch('dc', 'V1', 0, 0, { V: 12 }).sch('res', 'R1', 4, -4, { R: 1000 }).sch('res', 'R2', 8, 0, { R: 2000 }, 1).sch('meter', 'M1', 13, 0, { mode: 'dcv' }, 1).sch('gnd', 'GND', 0, 4);
      b.w('V1.0', [0, -4], 'R1.0').w('R1.1', [13, -4], 'M1.0').w([8, -4], 'R2.0').w('M1.1', [13, 4], 'GND.0').w('R2.1', [8, 4]).w('V1.1', 'GND.0');
      return b.done();
    },
  },
  {
    id: 'led',
    title: 'LED 限流電阻',
    course: '基本電學',
    goal: '了解 LED 為什麼一定要串電阻，並算出合適的電阻值。',
    view: 'sch',
    starter: () => blank('實驗：LED 限流電阻'),
    steps: [
      circuit('先故意做錯：把一顆紅色 LED 直接接到 5 V 電源，不要串電阻。注意 LED 的方向，看看會發生什麼事。', (k) => k.anyBurned(), 'LED 的陽極接正極。如果沒有反應，可能是接反了。'),
      quiz('LED 為什麼燒毀了？', ['電壓太低', '沒有電阻限制，電流過大', '電源接反了'], 1, 'LED 導通後兩端電壓幾乎固定，多出來的電壓沒有地方降，電流就會暴增。'),
      circuit('在電源和 LED 之間串一個 330 Ω 電阻，然後按上方的「重設」換一顆新的 LED。', (k) => {
        const l = k.one('led');
        const d = l && k.led(l);
        return !!d && !d.burned && d.id > 0.007 && d.id < 0.011;
      }, '選取導線按 Delete 可以刪除，再重新接線。', { final: true }),
      quiz('LED 順向電壓約 2 V，串 330 Ω 時電流大約是多少？', ['約 2 mA', '約 9 mA', '約 15 mA'], 1, 'I = (5 − 2) ÷ 330 ≈ 9 mA。'),
      circuit('想讓 LED 更亮：調整電阻，讓電流大約是 15 mA。先算算看要多少歐姆。', (k) => {
        const l = k.one('led');
        const d = l && k.led(l);
        return !!d && !d.burned && d.id > 0.013 && d.id < 0.017;
      }, 'R = (5 − 2) ÷ 0.015 = 200 Ω。'),
    ],
    solution: () => {
      const b = new CircuitBuilder('實驗：LED 限流電阻（解答）');
      b.sch('dc', 'V1', 0, 0, { V: 5 }).sch('res', 'R1', 4, -4, { R: 330 }).sch('led', 'LED1', 8, 0, {}, 1).sch('gnd', 'GND', 0, 4);
      b.w('V1.0', [0, -4], 'R1.0').w('R1.1', [8, -4], 'LED1.0').w('LED1.1', [8, 4], 'GND.0').w('V1.1', 'GND.0');
      return b.done();
    },
  },
  {
    id: 'rc',
    title: 'RC 時間常數',
    course: '基本電學',
    goal: '用示波器觀察電容充電，理解 τ = RC。',
    view: 'sch',
    starter: () => blank('實驗：RC 時間常數', 0.1),
    steps: [
      circuit('接一個 5 V 電源、開關（先不要導通）、10 kΩ 電阻、10 µF 電容串聯，電容另一端接地。', (k) => {
        const r = k.comps('res').find((x) => k.near(Number(x.params.R), 10000, 0.001));
        const cap = k.comps('cap').find((x) => k.near(Number(x.params.C), 10e-6, 0.001));
        const sw = k.one('sw');
        return !!r && !!cap && !!sw && (k.conn(r, 0, cap, 0) || k.conn(r, 1, cap, 0));
      }, '電容輸入 10u 就是 10 µF。電容的正極接電阻。', { final: true }),
      circuit('按示波器的「＋探棒」，再點電容的正極，把電容電壓顯示出來。', (k) => {
        const cap = k.one('cap');
        return !!cap && k.hasProbeOnNetOf(cap, 0);
      }, undefined, { final: true }),
      circuit('按「重設」讓電容放電，再點開關使它導通，觀察波形。', (k) => {
        const sw = k.one('sw');
        const cap = k.one('cap');
        return !!sw && !!cap && sw.params.closed === true && k.across(cap) > 4.5;
      }, '電壓會先快後慢地上升，最後接近 5 V。', { final: true }),
      quiz('這個電路的時間常數是多少？', ['0.01 秒', '0.1 秒', '1 秒'], 1, 'τ = RC = 10 kΩ × 10 µF = 0.1 秒。'),
      quiz('經過一個時間常數，電容充到電源電壓的幾 %？', ['約 37%', '約 50%', '約 63%'], 2, 'V = V₀(1 − e⁻¹) ≈ 0.632 V₀，也就是約 3.16 V。'),
      circuit('把電阻改成 20 kΩ，按「重設」後再觀察一次，充電應該變慢。', (k) => {
        return k.comps('res').some((x) => k.near(Number(x.params.R), 20000, 0.001));
      }),
    ],
    solution: () => {
      const b = new CircuitBuilder('實驗：RC 時間常數（解答）', 0.1);
      b.sch('dc', 'V1', 0, 0, { V: 5 }).sch('sw', 'SW1', 3, -4, { closed: true }).sch('res', 'R1', 9, -4, { R: 10000 }).sch('cap', 'C1', 13, 0, { C: 10e-6 }, 1).sch('gnd', 'GND', 0, 4);
      b.w('V1.0', [0, -4], 'SW1.0').w('SW1.1', 'R1.0').w('R1.1', [13, -4], 'C1.0').w('C1.1', [13, 4], 'GND.0').w('V1.1', 'GND.0');
      b.probe('C1.0');
      return b.done();
    },
  },
  {
    id: 'rectifier',
    title: '半波整流與濾波',
    course: '電子學',
    goal: '觀察二極體把交流變成脈動直流，再用電容濾波。',
    view: 'sch',
    starter: () => blank('實驗：半波整流與濾波', 0.02),
    steps: [
      circuit('放一個「訊號產生器」（10 V、60 Hz 正弦波）、一顆二極體、一個 1 kΩ 電阻串聯，電阻另一端接地。訊號產生器的共同腳也要接地。', (k) => {
        const r = k.comps('res').find((x) => k.near(Number(x.params.R), 1000, 0.001));
        const d = k.one('diode');
        const a = k.one('ac');
        if (!r || !d || !a) return false;
        const w = k.window('load', Math.abs(k.across(r)), 0.05);
        return w.full && w.max > 8.5 && w.max < 10;
      }, '輸出的峰值應該比 10 V 少一個二極體壓降。', { final: true }),
      circuit('把示波器探棒放到電阻上端（二極體輸出），再加一支探棒到訊號產生器輸出，比較兩個波形。', (k) => k.doc.probes.length >= 2, undefined, { final: true }),
      quiz('輸出為什麼只剩正半週？', ['負半週二極體逆偏不導通', '電阻擋住了負電壓', '訊號產生器只輸出正電壓'], 0, '二極體只允許順向電流，負半週時逆偏，負載上沒有電流。'),
      circuit('在電阻兩端並聯一個 100 µF 電容（正極接二極體輸出），觀察波形變平。', (k) => {
        const r = k.comps('res').find((x) => k.near(Number(x.params.R), 1000, 0.001));
        const cap = k.comps('cap').find((x) => k.near(Number(x.params.C), 100e-6, 0.001));
        if (!r || !cap) return false;
        const w = k.window('filtered', Math.abs(k.across(r)), 0.1);
        return w.full && w.min > 6;
      }, '電容在電壓峰值時充電，電壓下降時放電給負載。'),
      quiz('電容變大，輸出的漣波會？', ['變大', '變小', '不變'], 1, 'RC 越大放電越慢，電壓下降得越少，漣波越小。'),
    ],
    solution: () => {
      const b = new CircuitBuilder('實驗：半波整流與濾波（解答）', 0.02);
      b.sch('ac', 'VS1', 0, 0, { amp: 10, freq: 60 }).sch('diode', 'D1', 4, -4).sch('res', 'R1', 10, 0, { R: 1000 }, 1).sch('gnd', 'GND', 0, 4);
      b.w('VS1.0', [0, -4], 'D1.0').w('D1.1', [10, -4], 'R1.0').w('R1.1', [10, 4], 'GND.0').w('VS1.1', 'GND.0');
      b.probe('VS1.0').probe('R1.0');
      return b.done();
    },
  },
  {
    id: 'bjt',
    title: '電晶體開關',
    course: '電子學',
    goal: '用基極的小電流控制集極的大電流，驅動 LED。',
    view: 'sch',
    starter: () => blank('實驗：電晶體開關'),
    steps: [
      circuit('接集極迴路：5 V → 330 Ω 電阻 → LED → NPN 的 C 腳；E 腳接地。', (k) => {
        const q = k.one('npn');
        const l = k.one('led');
        const r = k.comps('res').find((x) => k.near(Number(x.params.R), 330, 0.001));
        return !!q && !!l && !!r && k.conn(l, 1, q, 1) && (k.conn(r, 0, l, 0) || k.conn(r, 1, l, 0));
      }, 'LED 的陰極接電晶體的 C 腳。', { final: true }),
      circuit('接基極迴路：5 V → 開關 → 4.7 kΩ 電阻 → NPN 的 B 腳。', (k) => {
        const q = k.one('npn');
        const r = k.comps('res').find((x) => k.near(Number(x.params.R), 4700, 0.001));
        return !!q && !!r && !!k.one('sw') && (k.conn(r, 0, q, 0) || k.conn(r, 1, q, 0));
      }, undefined, { final: true }),
      circuit('點開關，分別試試導通和斷開，確認 LED 會跟著亮滅。', (k) => {
        const l = k.one('led');
        const d = l && k.led(l);
        if (!d) return false;
        if (d.id > 0.005) k.memo.on = true;
        if (d.id < 1e-5) k.memo.off = true;
        return k.memo.on === true && k.memo.off === true;
      }, undefined, { progress: (k) => `已看到：${k.memo.on ? 'LED 亮 ✓' : 'LED 亮 …'}　${k.memo.off ? 'LED 滅 ✓' : 'LED 滅 …'}` }),
      quiz('開關斷開時，電晶體處於什麼狀態？', ['截止', '工作區', '飽和'], 0, '基極沒有電流，集極也沒有電流，電晶體就像斷開的開關。'),
      quiz('基極為什麼要串電阻？', ['讓 LED 更亮', '限制基極電流，保護基射極接面', '提高電晶體的 β'], 1, '基射極是 PN 接面，導通時電壓固定在約 0.7 V，沒有電阻電流會過大。'),
    ],
    solution: () => {
      const b = new CircuitBuilder('實驗：電晶體開關（解答）');
      b.sch('dc', 'V1', 0, 0, { V: 5 }).sch('sw', 'SW1', 3, -6, { closed: true }, 1).sch('res', 'RB', 6, 2, { R: 4700 }).sch('npn', 'Q1', 10, 2).sch('led', 'LED1', 11, -3, {}, 1).sch('res', 'RC', 11, -8, { R: 330 }, 1).sch('gnd', 'GND', 0, 6);
      b.w('V1.0', [0, -10], 'RC.0').w([3, -10], 'SW1.0').w('SW1.1', [3, 2], 'RB.0').w('RB.1', 'Q1.0');
      b.w('RC.1', 'LED1.0').w('LED1.1', 'Q1.1').w('Q1.2', [11, 6], 'GND.0').w('V1.1', 'GND.0');
      return b.done();
    },
  },
  {
    id: 'nand',
    title: 'NAND 閘真值表',
    course: '數位邏輯',
    goal: '親手測出 NAND 閘的真值表，並用它做出 NOT 閘。',
    view: 'sch',
    starter: () => blank('實驗：NAND 閘真值表'),
    steps: [
      circuit('放兩個「邏輯輸入」、一個「NAND 反及閘」、一個「邏輯輸出」，把輸入接到閘的 A、B，輸出接到邏輯輸出。', (k) => {
        const n = k.one('nand');
        const out = k.one('lout');
        const ins = k.comps('lin');
        if (!n || !out || ins.length < 2) return false;
        const a = ins.find((i) => k.conn(i, 0, n, 0));
        const b = ins.find((i) => k.conn(i, 0, n, 1));
        return !!a && !!b && a !== b && k.conn(n, 2, out, 0);
      }, undefined, { final: true }),
      circuit('點邏輯輸入切換 0 和 1，把四種輸入組合都試一遍。', (k) => {
        const n = k.one('nand');
        if (!n) return false;
        const a = k.v(n, 0) > 1.5 ? 1 : 0;
        const b = k.v(n, 1) > 1.5 ? 1 : 0;
        const y = k.v(n, 2) > 1.5 ? 1 : 0;
        const seen: Record<string, number> = (k.memo.seen ??= {});
        seen[`${a}${b}`] = y;
        return Object.keys(seen).length === 4;
      }, undefined, {
        progress: (k) => {
          const seen: Record<string, number> = k.memo.seen ?? {};
          return ['00', '01', '10', '11'].map((c) => `${c[0]} ${c[1]} → ${seen[c] ?? '?'}`).join('　');
        },
      }),
      quiz('什麼時候 NAND 的輸出是 0？', ['任一輸入為 0', '兩個輸入都是 1', '兩個輸入都是 0'], 1, 'NAND 就是 AND 的相反：只有全部為 1 時輸出 0。'),
      quiz('把同一個訊號接到 NAND 的兩個輸入，它會變成什麼閘？', ['AND', 'OR', 'NOT'], 2, '兩輸入相同時，1 NAND 1 = 0、0 NAND 0 = 1，就是反相器。所以 NAND 可以組出所有邏輯閘。'),
    ],
    solution: () => {
      const b = new CircuitBuilder('實驗：NAND 閘真值表（解答）');
      b.sch('lin', 'A', 0, -2).sch('lin', 'B', 0, 2).sch('nand', 'G1', 8, 0).sch('lout', 'Y', 15, 0);
      b.w('A.0', [4, -2], [4, -1], 'G1.0').w('B.0', [4, 2], [4, 1], 'G1.1').w('G1.2', 'Y.0');
      return b.done();
    },
  },
  {
    id: 'bbled',
    title: '麵包板：LED 電路',
    course: '麵包板實作',
    goal: '照著電路圖在麵包板上接線，學會孔的導通規則。',
    view: 'bb',
    starter: () => {
      const b = new CircuitBuilder('實驗：麵包板 LED');
      b.sch('dc', 'V1', 0, 0, { V: 5 }).sch('res', 'R1', 4, -4, { R: 330 }).sch('led', 'LED1', 8, 0, {}, 1).sch('gnd', 'GND', 0, 4);
      b.w('V1.0', [0, -4], 'R1.0').w('R1.1', [8, -4], 'LED1.0').w('LED1.1', [8, 4], 'GND.0').w('V1.1', 'GND.0');
      return b.done();
    },
    steps: [
      circuit('電路圖已經畫好了（可以切到「電路圖」畫面看）。從左邊的「待放置」點 V1，放到麵包板上方。', (k) => !!k.one('dc'), undefined, { final: true }),
      circuit('再把 R1、LED1 插到麵包板。把滑鼠移到孔上，會標出哪些孔互相導通。', (k) => !!k.one('res') && !!k.one('led'), '同一欄的 a～e 相通、f～j 相通；中間的溝槽不通。', { final: true }),
      circuit('照電路圖接線：把元件的腳插在同一欄，或用跳線連接；電源端子拖曳到孔就能接跳線。', (k) => compareViews(k.doc).ok, '上方「對照電路圖」按鈕會指出哪裡少接或多接。', { final: true }),
      circuit('確認 LED 亮起來。', (k) => {
        const l = k.one('led');
        const d = l && k.led(l);
        return !!d && d.id > 0.005;
      }, undefined, { final: true }),
      quiz('兩個元件的腳插在同一欄的 a 和 c，它們有接在一起嗎？', ['有，a～e 內部相通', '沒有，要再接跳線', '要看電源'], 0, '麵包板內部的金屬片讓同一欄的 a～e 相通，不必另外接線。'),
    ],
    solution: () => {
      const b = new CircuitBuilder('實驗：麵包板 LED（解答）');
      b.sch('dc', 'V1', 0, 0, { V: 5 }).sch('res', 'R1', 4, -4, { R: 330 }).sch('led', 'LED1', 8, 0, {}, 1).sch('gnd', 'GND', 0, 4);
      b.w('V1.0', [0, -4], 'R1.0').w('R1.1', [8, -4], 'LED1.0').w('LED1.1', [8, 4], 'GND.0').w('V1.1', 'GND.0');
      b.place('V1', { x: 3, y: -7 }).place('R1', { holes: ['a10', 'a14'] }).place('LED1', { holes: ['c14', 'c16'] });
      b.j('V1.0', 'T+5', '#d3232a').j('V1.1', 'T-8', '#17171a').j('T+10', 'b10', '#d3232a').j('b16', 'T-16', '#17171a');
      return b.done();
    },
  },
  {
    id: 'bbnand',
    title: '麵包板：7400 邏輯 IC',
    course: '麵包板實作',
    goal: '認識 IC 的腳位：要接電源才會動作，輸入空接視為 1。',
    view: 'bb',
    starter: () => blank('實驗：麵包板 7400'),
    steps: [
      circuit('放一個「直流電源」（5 V）到麵包板上方，再放一顆「7400 四 NAND」。IC 要跨在中央溝槽上。', (k) => {
        const v = k.one('dc');
        return !!v && k.near(Number(v.params.V), 5, 0.001) && !!k.one('ic7400');
      }, undefined, { final: true }),
      circuit('接電源：14 腳接 +5 V，7 腳接電源負極。缺口朝左時，1 腳在左下，逆時針編號。', (k) => {
        const u = k.one('ic7400');
        const d = u && k.dev(u);
        return d instanceof Chip && d.powered;
      }, '可以先把電源接到電源軌，再由電源軌接到 IC。', { final: true }),
      circuit('接輸出：3 腳 → 330 Ω 電阻 → LED → 電源負極。兩個輸入（1、2 腳）先空接。', (k) => {
        const u = k.one('ic7400');
        const r = k.comps('res').find((x) => k.near(Number(x.params.R), 330, 0.001));
        const l = k.one('led');
        if (!u || !r || !l) return false;
        const fromOut = k.conn(u, 2, r, 0) || k.conn(u, 2, r, 1);
        const toLed = k.conn(r, 0, l, 0) || k.conn(r, 1, l, 0);
        return fromOut && toLed && k.conn(l, 1, u, 6);
      }, undefined, { final: true }),
      quiz('兩個輸入都空接時 LED 不亮，代表輸出是什麼？為什麼？', ['輸出 1：空接視為 0', '輸出 0：TTL 的空接輸入視為 1', '輸出 0：IC 沒有電源'], 1, 'TTL 輸入內部有上拉，空接就是高電位。實務上不要讓輸入空接，容易受雜訊影響。'),
      circuit('用跳線把 1 腳接到電源負極（輸入變 0），LED 應該會亮。', (k) => {
        const l = k.one('led');
        const d = l && k.led(l);
        return !!d && d.id > 0.003;
      }),
    ],
    solution: () => {
      const b = new CircuitBuilder('實驗：麵包板 7400（解答）');
      b.bb('dc', 'V1', { x: 3, y: -7 }, { V: 5 }).bb('ic7400', 'U1', { col: 15 }).bb('res', 'R1', { holes: ['i17', 'i23'] }, { R: 330 }).bb('led', 'LED1', { holes: ['h23', 'h25'] });
      b.j('V1.0', 'T+5', '#d3232a').j('V1.1', 'T-8', '#17171a').j('T-3', 'B-3', '#17171a');
      b.j('T+15', 'a15', '#d3232a').j('g21', 'B-21', '#17171a').j('j25', 'B-25', '#17171a');
      return b.done();
    },
  },
];
