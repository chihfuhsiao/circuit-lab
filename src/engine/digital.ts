// 數位元件。輸出是「接到 VCC 或 GND 的電阻」，所以能和類比元件混在同一個引擎。
// 輸入在每步結束時讀取，輸出在下一步才改變，因此每個閘有一個步長的傳遞延遲，
// 拴鎖與環形振盪器都能正常運作，也不會讓牛頓法不收斂。

import { Device, Simulator } from './sim';

const R_OH = 50;
const R_OL = 25;
/** TTL 輸入內部上拉：空接的輸入會被視為高電位，和實際 74 系列相同。 */
const R_PULLUP = 20e3;
const R_QUIESCENT = 2e3;
const V_IMPLICIT = 5;
export const V_TH_HIGH = 1.5;
export const V_TH_LOW = 1.1;
const V_MIN_SUPPLY = 3;
const V_MAX_SUPPLY = 7.5;

// 傳遞延遲有 1～2 步的變化。若所有閘同時翻轉，對稱的回授電路（例如 SR 拴鎖剛啟動時）
// 會永遠處於競跑狀態；實際的閘延遲不會完全相同，所以很快就會落入穩定狀態。
let delaySeed = 12345;
function nextDelay(): number {
  delaySeed = (delaySeed * 1103515245 + 12345) & 0x7fffffff;
  return 1 + ((delaySeed >> 16) & 1);
}

export type LogicEval = (inp: boolean[], prev: boolean[], st: any) => boolean[];

export interface ChipDef {
  inputs: number[];
  outputs: number[];
  /** 電源腳在 nodes 的位置；null 表示隱含 5V（電路圖上的邏輯閘）。 */
  vcc: number | null;
  gnd: number | null;
  initState?: () => any;
  evaluate: LogicEval;
}

export class Chip extends Device {
  outs: boolean[];
  levels: boolean[];
  private prev: boolean[];
  state: any;
  powered: boolean;
  burned = false;
  /** 每個輸出還要等幾步才翻轉，0 表示沒有等待中的變化。 */
  private pending: number[];

  constructor(nodes: number[], readonly def: ChipDef) {
    super(nodes);
    this.outs = def.outputs.map(() => false);
    this.pending = def.outputs.map(() => 0);
    this.levels = def.inputs.map(() => true);
    this.prev = this.levels.slice();
    this.state = def.initState ? def.initState() : {};
    this.powered = def.vcc === null;
  }

  stamp(s: Simulator): void {
    const { def, nodes } = this;
    if (def.vcc === null) {
      for (const p of def.inputs) {
        s.G(nodes[p], 0, 1 / R_PULLUP);
        s.I(0, nodes[p], V_IMPLICIT / R_PULLUP);
      }
      def.outputs.forEach((p, k) => {
        if (this.outs[k]) {
          s.G(nodes[p], 0, 1 / R_OH);
          s.I(0, nodes[p], V_IMPLICIT / R_OH);
        } else {
          s.G(nodes[p], 0, 1 / R_OL);
        }
      });
      return;
    }
    const vcc = nodes[def.vcc];
    const gnd = nodes[def.gnd!];
    if (this.burned) return;
    s.G(vcc, gnd, 1 / R_QUIESCENT);
    for (const p of def.inputs) s.G(nodes[p], vcc, 1 / R_PULLUP);
    if (this.powered) {
      def.outputs.forEach((p, k) => {
        if (this.outs[k]) s.G(nodes[p], vcc, 1 / R_OH);
        else s.G(nodes[p], gnd, 1 / R_OL);
      });
    }
  }

  override commit(s: Simulator): void {
    const { def, nodes } = this;
    const vGnd = def.gnd === null ? 0 : s.v(nodes[def.gnd]);
    const vVcc = def.vcc === null ? V_IMPLICIT : s.v(nodes[def.vcc]);
    const supply = vVcc - vGnd;

    if (def.vcc !== null && supply > V_MAX_SUPPLY && !this.burned) {
      this.burned = true;
      s.discreteChanged = true;
    }
    const powered = !this.burned && supply >= V_MIN_SUPPLY;
    if (powered !== this.powered) {
      this.powered = powered;
      s.discreteChanged = true;
    }

    def.inputs.forEach((p, k) => {
      const v = s.v(nodes[p]) - vGnd;
      if (v >= V_TH_HIGH) this.levels[k] = true;
      else if (v <= V_TH_LOW) this.levels[k] = false;
    });

    if (powered) {
      const next = def.evaluate(this.levels, this.prev, this.state);
      for (let k = 0; k < next.length; k++) {
        if (next[k] === this.outs[k]) {
          this.pending[k] = 0;
          continue;
        }
        if (this.pending[k] === 0) this.pending[k] = nextDelay();
        if (--this.pending[k] === 0) {
          this.outs[k] = next[k];
          s.discreteChanged = true;
        }
      }
    }
    for (let k = 0; k < this.levels.length; k++) this.prev[k] = this.levels[k];
    this.updateCurrents(s, vVcc, vGnd);
  }

  private updateCurrents(s: Simulator, vVcc: number, vGnd: number): void {
    const { def, nodes } = this;
    this.currents.fill(0);
    if (this.burned) return;
    let iVcc = 0;
    let iGnd = 0;
    for (const p of def.inputs) {
      const i = (s.v(nodes[p]) - vVcc) / R_PULLUP;
      this.currents[p] = i;
      iVcc -= i;
    }
    if (this.powered) {
      def.outputs.forEach((p, k) => {
        const v = s.v(nodes[p]);
        if (this.outs[k]) {
          const i = (v - vVcc) / R_OH;
          this.currents[p] = i;
          iVcc -= i;
        } else {
          const i = (v - vGnd) / R_OL;
          this.currents[p] = i;
          iGnd -= i;
        }
      });
    }
    if (def.vcc !== null) {
      const q = (vVcc - vGnd) / R_QUIESCENT;
      this.currents[def.vcc] = iVcc + q;
      this.currents[def.gnd!] = iGnd - q;
    }
  }

  override saveState(): unknown {
    return { outs: this.outs.slice(), levels: this.levels.slice(), state: this.state, burned: this.burned };
  }
  override loadState(st: any): void {
    if (st.outs.length === this.outs.length) this.outs = st.outs;
    if (st.levels.length === this.levels.length) {
      this.levels = st.levels;
      this.prev = st.levels.slice();
    }
    this.state = st.state;
    this.burned = st.burned;
  }
}

// ---- 邏輯函式 ----

export type GateKind = 'and' | 'or' | 'not' | 'nand' | 'nor' | 'xor' | 'xnor' | 'buf';

export const gateFn: Record<GateKind, (i: boolean[]) => boolean> = {
  and: (i) => i.every(Boolean),
  or: (i) => i.some(Boolean),
  not: (i) => !i[0],
  buf: (i) => i[0],
  nand: (i) => !i.every(Boolean),
  nor: (i) => !i.some(Boolean),
  xor: (i) => i.filter(Boolean).length % 2 === 1,
  xnor: (i) => i.filter(Boolean).length % 2 === 0,
};

/** 電路圖用的單一邏輯閘：最後一隻腳是輸出，其餘是輸入，隱含 5V。 */
export function gateDevice(kind: GateKind, nodes: number[]): Chip {
  const n = nodes.length - 1;
  return new Chip(nodes, {
    inputs: Array.from({ length: n }, (_, i) => i),
    outputs: [n],
    vcc: null,
    gnd: null,
    evaluate: (inp) => [gateFn[kind](inp)],
  });
}

/** 74 系列四閘 IC。unit = [輸入腳..., 輸出腳]，腳號從 1 起算，nodes 依腳號排列。 */
export function gateChip(kind: GateKind, nodes: number[], units: number[][], vccPin: number, gndPin: number): Chip {
  const inputs: number[] = [];
  const outputs: number[] = [];
  const unitInputs: number[][] = [];
  for (const u of units) {
    const ins = u.slice(0, -1).map((p) => p - 1);
    unitInputs.push(ins.map((p) => inputs.length + ins.indexOf(p)));
    inputs.push(...ins);
    outputs.push(u[u.length - 1] - 1);
  }
  return new Chip(nodes, {
    inputs,
    outputs,
    vcc: vccPin - 1,
    gnd: gndPin - 1,
    evaluate: (inp) => unitInputs.map((idx) => gateFn[kind](idx.map((k) => inp[k]))),
  });
}

/** 正緣 D 型正反器：nodes = [D, CLK, Q, Q̄]。 */
export function dFlipFlop(nodes: number[]): Chip {
  return new Chip(nodes, {
    inputs: [0, 1],
    outputs: [2, 3],
    vcc: null,
    gnd: null,
    initState: () => ({ q: false }),
    evaluate: (inp, prev, st) => {
      if (inp[1] && !prev[1]) st.q = inp[0];
      return [st.q, !st.q];
    },
  });
}

/** 正緣 JK 正反器：nodes = [J, CLK, K, Q, Q̄]。J、K 空接視為 1（每個時脈翻轉）。 */
export function jkFlipFlop(nodes: number[]): Chip {
  return new Chip(nodes, {
    inputs: [0, 1, 2],
    outputs: [3, 4],
    vcc: null,
    gnd: null,
    initState: () => ({ q: false }),
    evaluate: (inp, prev, st) => {
      if (inp[1] && !prev[1]) {
        if (inp[0] && inp[2]) st.q = !st.q;
        else if (inp[0]) st.q = true;
        else if (inp[2]) st.q = false;
      }
      return [st.q, !st.q];
    },
  });
}

/** 4 位元同步計數器：nodes = [CLK, 清除(低態動作), Q0, Q1, Q2, Q3]。 */
export function counter4(nodes: number[]): Chip {
  return new Chip(nodes, {
    inputs: [0, 1],
    outputs: [2, 3, 4, 5],
    vcc: null,
    gnd: null,
    initState: () => ({ n: 0 }),
    evaluate: (inp, prev, st) => {
      if (!inp[1]) st.n = 0;
      else if (inp[0] && !prev[0]) st.n = (st.n + 1) & 15;
      return [0, 1, 2, 3].map((b) => ((st.n >> b) & 1) === 1);
    },
  });
}

/** 邏輯輸入（撥動開關）：nodes = [輸出]。 */
export function logicInput(nodes: number[], high: boolean): Chip {
  const chip = new Chip(nodes, { inputs: [], outputs: [0], vcc: null, gnd: null, evaluate: () => [high] });
  // 第一步就要輸出正確電位，否則下游的拴鎖會在重建電路時被清掉。
  chip.outs[0] = high;
  return chip;
}

/** 十六進位顯示器（內含解碼）：nodes = [D0, D1, D2, D3]。 */
export function hexDisplay(nodes: number[]): Chip {
  return new Chip(nodes, { inputs: [0, 1, 2, 3], outputs: [], vcc: null, gnd: null, evaluate: () => [] });
}

// ---- 其他 74 系列 ----

/** 7474 雙 D 型正反器。nodes 依腳號（1..14）排列。 */
export function chip7474(nodes: number[]): Chip {
  // 輸入順序：1CLR, 1D, 1CLK, 1PRE, 2CLR, 2D, 2CLK, 2PRE
  return new Chip(nodes, {
    inputs: [0, 1, 2, 3, 12, 11, 10, 9],
    outputs: [4, 5, 8, 7],
    vcc: 13,
    gnd: 6,
    initState: () => ({ q: [false, false] }),
    evaluate: (inp, prev, st) => {
      for (const u of [0, 1]) {
        const o = u * 4;
        const clr = inp[o];
        const d = inp[o + 1];
        const clk = inp[o + 2];
        const pre = inp[o + 3];
        if (!clr) st.q[u] = false;
        else if (!pre) st.q[u] = true;
        else if (clk && !prev[o + 2]) st.q[u] = d;
      }
      return [st.q[0], !st.q[0], st.q[1], !st.q[1]];
    },
  });
}

/** 7493 4 位元漣波計數器（負緣觸發）。nodes 依腳號排列：14 CKA、1 CKB、2/3 重設、12 QA、9 QB、8 QC、11 QD、5 VCC、10 GND。 */
export function chip7493(nodes: number[]): Chip {
  return new Chip(nodes, {
    inputs: [13, 0, 1, 2],
    outputs: [11, 8, 7, 10],
    vcc: 4,
    gnd: 9,
    initState: () => ({ a: 0, b: 0 }),
    evaluate: (inp, prev, st) => {
      if (inp[2] && inp[3]) {
        st.a = 0;
        st.b = 0;
      } else {
        if (prev[0] && !inp[0]) st.a ^= 1;
        if (prev[1] && !inp[1]) st.b = (st.b + 1) & 7;
      }
      return [st.a === 1, (st.b & 1) === 1, (st.b & 2) !== 0, (st.b & 4) !== 0];
    },
  });
}

/** 七段碼 abcdefg，1 表示該段亮。10～15 是 7447 資料表上的圖樣。 */
export const SEG_7447 = [
  0b1111110, 0b0110000, 0b1101101, 0b1111001, 0b0110011, 0b1011011, 0b0011111, 0b1110000, 0b1111111, 0b1110011,
  0b0001101, 0b0011001, 0b0100011, 0b1001011, 0b0001111, 0b0000000,
];

/** 7447 BCD 轉七段解碼器（輸出低態動作，配共陽極顯示器）。nodes 依腳號（1..16）排列。 */
export function chip7447(nodes: number[]): Chip {
  // 輸入順序：A(7) B(1) C(2) D(6) LT(3) BI(4) RBI(5)
  return new Chip(nodes, {
    inputs: [6, 0, 1, 5, 2, 3, 4],
    outputs: [12, 11, 10, 9, 8, 14, 13], // a b c d e f g
    vcc: 15,
    gnd: 7,
    evaluate: (inp) => {
      const n = (inp[0] ? 1 : 0) + (inp[1] ? 2 : 0) + (inp[2] ? 4 : 0) + (inp[3] ? 8 : 0);
      let pat = SEG_7447[n];
      if (!inp[5]) pat = 0;
      else if (!inp[4]) pat = 0b1111111;
      return [6, 5, 4, 3, 2, 1, 0].map((b) => ((pat >> b) & 1) === 0);
    },
  });
}

const R_555_OUT = 15;
const R_555_DIS = 10;
const R_555_DIV = 5e3;

/** NE555 計時器。nodes 依腳號排列：1 GND、2 TRIG、3 OUT、4 RESET、5 CTRL、6 THR、7 DIS、8 VCC。 */
export class Timer555 extends Device {
  q = false;
  powered = false;
  burned = false;

  stamp(s: Simulator): void {
    const [gnd, trig, out, rst, ctrl, thr, dis, vcc] = this.nodes;
    if (this.burned) return;
    s.G(vcc, gnd, 1 / 1e4);
    s.G(vcc, ctrl, 1 / R_555_DIV);
    s.G(ctrl, gnd, 1 / (2 * R_555_DIV));
    s.G(rst, vcc, 1e-5);
    s.G(trig, gnd, 1e-8);
    s.G(thr, gnd, 1e-8);
    if (!this.powered) return;
    if (this.q) {
      s.G(out, vcc, 1 / R_555_OUT);
    } else {
      s.G(out, gnd, 1 / R_555_OUT);
      s.G(dis, gnd, 1 / R_555_DIS);
    }
  }

  override commit(s: Simulator): void {
    const [gnd, trig, out, rst, ctrl, thr, dis, vcc] = this.nodes;
    const vG = s.v(gnd);
    const supply = s.v(vcc) - vG;
    if (supply > 18 && !this.burned) {
      this.burned = true;
      s.discreteChanged = true;
    }
    const powered = !this.burned && supply >= 3;
    if (powered !== this.powered) {
      this.powered = powered;
      s.discreteChanged = true;
    }
    let q = this.q;
    if (powered) {
      const vc = s.v(ctrl) - vG;
      if (s.v(rst) - vG < 0.7) q = false;
      else if (s.v(trig) - vG < vc / 2) q = true;
      else if (s.v(thr) - vG > vc) q = false;
    }
    if (q !== this.q) {
      this.q = q;
      s.discreteChanged = true;
    }
    const iOut = powered ? (s.v(out) - (this.q ? s.v(vcc) : vG)) / R_555_OUT : 0;
    const iDis = powered && !this.q ? (s.v(dis) - vG) / R_555_DIS : 0;
    this.currents[2] = iOut;
    this.currents[6] = iDis;
    this.currents[7] = supply / 1e4 + (this.q ? -iOut : 0);
    this.currents[0] = -supply / 1e4 - (this.q ? 0 : iOut) - iDis;
  }
  override saveState(): unknown {
    return { q: this.q, burned: this.burned };
  }
  override loadState(st: any): void {
    this.q = st.q;
    this.burned = st.burned;
  }
}

/** 由多個子元件組成，例如七段顯示器的各段 LED。 */
export class Composite extends Device {
  constructor(nodes: number[], readonly parts: Device[]) {
    super(nodes);
    this.nonlinear = parts.some((p) => p.nonlinear);
  }
  stamp(s: Simulator): void {
    for (const p of this.parts) p.stamp(s);
  }
  override commit(s: Simulator): void {
    this.currents.fill(0);
    for (const p of this.parts) {
      p.commit(s);
      p.nodes.forEach((n, k) => {
        const idx = this.nodes.indexOf(n);
        if (idx >= 0) this.currents[idx] += p.currents[k];
      });
    }
  }
  override saveState(): unknown {
    return this.parts.map((p) => p.saveState());
  }
  override loadState(st: any): void {
    this.parts.forEach((p, i) => p.loadState(st[i]));
  }
}
