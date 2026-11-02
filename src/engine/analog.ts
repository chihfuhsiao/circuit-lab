// 類比元件模型。模型以教學為準：課本算得出的電路要對得上，不追求工程級細節。

import { Device, Simulator } from './sim';

const VT = 0.02585;

/** 電源內阻。讓短路與電源並聯不會造成奇異矩陣，也讓短路電流可以被偵測。 */
export const SOURCE_RS = 1e-3;
/** 開關導通電阻。 */
export const SWITCH_RON = 1e-3;

export class Resistor extends Device {
  constructor(a: number, b: number, public r: number) {
    super([a, b]);
  }
  stamp(s: Simulator): void {
    s.G(this.nodes[0], this.nodes[1], 1 / this.r);
  }
  override commit(s: Simulator): void {
    const i = (s.v(this.nodes[0]) - s.v(this.nodes[1])) / this.r;
    this.currents[0] = i;
    this.currents[1] = -i;
  }
}

/** 開關：開路時用很大的電阻，保持矩陣結構一致。 */
export class Switch extends Resistor {
  constructor(a: number, b: number, public closed: boolean) {
    super(a, b, closed ? SWITCH_RON : 1e12);
  }
}

/** 可變電阻：nodes = [端點A, 端點B, 中間腳]，pos 是中間腳由 A 往 B 的位置（0..1）。 */
export class Potentiometer extends Device {
  private ra: number;
  private rb: number;
  constructor(a: number, b: number, w: number, r: number, pos: number) {
    super([a, b, w]);
    const p = Math.min(0.999, Math.max(0.001, pos));
    this.ra = r * p;
    this.rb = r * (1 - p);
  }
  stamp(s: Simulator): void {
    const [a, b, w] = this.nodes;
    s.G(a, w, 1 / this.ra);
    s.G(w, b, 1 / this.rb);
  }
  override commit(s: Simulator): void {
    const [a, b, w] = this.nodes;
    const ia = (s.v(a) - s.v(w)) / this.ra;
    const ib = (s.v(b) - s.v(w)) / this.rb;
    this.currents[0] = ia;
    this.currents[1] = ib;
    this.currents[2] = -ia - ib;
  }
}

export class Capacitor extends Device {
  private v0: number;
  private i0 = 0;
  private geq = 0;
  private hist = 0;
  constructor(a: number, b: number, public c: number, initialV = 0) {
    super([a, b]);
    this.v0 = initialV;
  }
  get voltage(): number {
    return this.v0;
  }
  stamp(s: Simulator): void {
    const [a, b] = this.nodes;
    if (s.method === 'be') {
      this.geq = this.c / s.dt;
      this.hist = -this.geq * this.v0;
    } else {
      this.geq = (2 * this.c) / s.dt;
      this.hist = -this.geq * this.v0 - this.i0;
    }
    s.G(a, b, this.geq);
    s.I(a, b, this.hist);
  }
  override commit(s: Simulator): void {
    const [a, b] = this.nodes;
    const v = s.v(a) - s.v(b);
    const i = this.geq * v + this.hist;
    this.v0 = v;
    this.i0 = i;
    this.currents[0] = i;
    this.currents[1] = -i;
  }
  override saveState(): unknown {
    return { v0: this.v0, i0: this.i0 };
  }
  override loadState(st: any): void {
    this.v0 = st.v0;
    this.i0 = st.i0;
  }
}

export class Inductor extends Device {
  private i0: number;
  private v0 = 0;
  private geq = 0;
  private hist = 0;
  constructor(a: number, b: number, public l: number, initialI = 0) {
    super([a, b]);
    this.i0 = initialI;
  }
  stamp(s: Simulator): void {
    const [a, b] = this.nodes;
    if (s.method === 'be') {
      this.geq = s.dt / this.l;
      this.hist = this.i0;
    } else {
      this.geq = s.dt / (2 * this.l);
      this.hist = this.i0 + this.geq * this.v0;
    }
    s.G(a, b, this.geq);
    s.I(a, b, this.hist);
  }
  override commit(s: Simulator): void {
    const [a, b] = this.nodes;
    const v = s.v(a) - s.v(b);
    const i = this.geq * v + this.hist;
    this.v0 = v;
    this.i0 = i;
    this.currents[0] = i;
    this.currents[1] = -i;
  }
  override saveState(): unknown {
    return { v0: this.v0, i0: this.i0 };
  }
  override loadState(st: any): void {
    this.v0 = st.v0;
    this.i0 = st.i0;
  }
}

export type Wave = (t: number) => number;

export const waves = {
  dc: (v: number): Wave => () => v,
  sine: (amp: number, freq: number, offset = 0, phaseDeg = 0): Wave => {
    const w = 2 * Math.PI * freq;
    const ph = (phaseDeg * Math.PI) / 180;
    return (t) => offset + amp * Math.sin(w * t + ph);
  },
  square: (amp: number, freq: number, offset = 0, duty = 0.5): Wave => {
    return (t) => {
      const f = t * freq;
      const p = f - Math.floor(f);
      return offset + (p < duty ? amp : -amp);
    };
  },
  triangle: (amp: number, freq: number, offset = 0): Wave => {
    return (t) => {
      const f = t * freq;
      const p = f - Math.floor(f);
      const y = p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
      return offset + amp * y;
    };
  },
};

/** 電壓源：nodes = [正極, 負極]。currents[0] 為流入正極的電流，供電時為負值。 */
export class VoltageSource extends Device {
  override readonly numBranches = 1;
  constructor(a: number, b: number, public wave: Wave, public rs = SOURCE_RS) {
    super([a, b]);
  }
  stamp(s: Simulator): void {
    const [a, b] = this.nodes;
    const k = this.branchBase;
    s.addNB(a, k, 1);
    s.addNB(b, k, -1);
    s.addBN(k, a, 1);
    s.addBN(k, b, -1);
    s.addBB(k, k, -this.rs);
    s.rhsB(k, this.wave(s.time));
  }
  override commit(s: Simulator): void {
    const i = s.branchCurrent(this.branchBase);
    this.currents[0] = i;
    this.currents[1] = -i;
  }
}

/** 電流源：電流由 nodes[0] 經元件流向 nodes[1]。 */
export class CurrentSource extends Device {
  constructor(a: number, b: number, public i: number) {
    super([a, b]);
  }
  stamp(s: Simulator): void {
    s.I(this.nodes[0], this.nodes[1], this.i);
  }
  override commit(): void {
    this.currents[0] = this.i;
    this.currents[1] = -this.i;
  }
}

// ---- PN 接面共用計算 ----

let pnI = 0;
let pnG = 0;

/** 蕭克萊方程式；電流超過 imax 後線性延伸，避免指數爆掉。 */
function pn(v: number, is: number, nvt: number, vmax: number): void {
  if (v > vmax) {
    const e = Math.exp(vmax / nvt);
    pnG = (is * e) / nvt;
    pnI = is * (e - 1) + pnG * (v - vmax);
  } else if (v < -30 * nvt) {
    pnG = 0;
    pnI = -is;
  } else {
    const e = Math.exp(v / nvt);
    pnG = (is * e) / nvt;
    pnI = is * (e - 1);
  }
}

/** SPICE 的 pnjlim：限制牛頓法每次迭代的接面電壓變化。 */
function pnjlim(vnew: number, vold: number, nvt: number, vcrit: number): number {
  if (vnew > vcrit && Math.abs(vnew - vold) > nvt + nvt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / nvt;
      return arg > 0 ? vold + nvt * Math.log(arg) : vcrit;
    }
    return nvt * Math.log(vnew / nvt);
  }
  return vnew;
}

const vmaxFor = (is: number, nvt: number, imax = 20) => nvt * Math.log(imax / is + 1);
const vcritFor = (is: number, nvt: number) => nvt * Math.log(nvt / (Math.SQRT2 * is));
const ZENER_IS = 5e-3;

export interface DiodeParams {
  is: number;
  n: number;
  /** 逆向崩潰電壓（齊納），0 表示沒有。 */
  bv?: number;
}

/** 二極體：nodes = [陽極, 陰極]。 */
export class Diode extends Device {
  override nonlinear = true;
  protected is: number;
  protected nvt: number;
  protected vcrit: number;
  protected vmax: number;
  protected bv: number;
  protected vLast = 0;
  protected g = 0;
  protected ieq = 0;
  /** 流過二極體的順向電流。 */
  id = 0;

  constructor(a: number, c: number, p: DiodeParams) {
    super([a, c]);
    this.is = p.is;
    this.nvt = p.n * VT;
    this.vcrit = vcritFor(this.is, this.nvt);
    this.vmax = vmaxFor(this.is, this.nvt);
    this.bv = p.bv ?? 0;
  }

  protected isOpen(): boolean {
    return false;
  }

  stamp(s: Simulator): void {
    const [a, c] = this.nodes;
    if (this.isOpen()) {
      this.g = 0;
      this.ieq = 0;
      return;
    }
    const raw = s.v(a) - s.v(c);
    let v: number;
    if (this.bv > 0 && raw < -this.bv * 0.5) {
      // 逆向崩潰區：對 -(v+bv) 做同樣的限制。
      const vr = pnjlim(-raw - this.bv, -this.vLast - this.bv, VT, vcritFor(ZENER_IS, VT));
      v = -vr - this.bv;
    } else {
      v = pnjlim(raw, this.vLast, this.nvt, this.vcrit);
    }
    if (Math.abs(v - raw) > 1e-9) s.limited = true;
    this.vLast = v;

    pn(v, this.is, this.nvt, this.vmax);
    let i = pnI;
    let g = pnG;
    if (this.bv > 0) {
      // 崩潰電流在 v = -bv 時等於 ZENER_IS，所以 bv 就是一般工作電流下的齊納電壓。
      pn(-v - this.bv, ZENER_IS, VT, vmaxFor(ZENER_IS, VT));
      i -= pnI + ZENER_IS;
      g += pnG;
    }
    g += 1e-12;
    this.g = g;
    this.ieq = i - g * v;
    s.G(a, c, g);
    s.I(a, c, this.ieq);
  }

  override commit(s: Simulator): void {
    const [a, c] = this.nodes;
    this.id = this.g * (s.v(a) - s.v(c)) + this.ieq;
    this.currents[0] = this.id;
    this.currents[1] = -this.id;
  }
}

/** LED：由指定電流下的順向電壓反推飽和電流。電流過大持續一段時間會燒毀。 */
export class Led extends Diode {
  burned = false;
  private overSteps = 0;

  constructor(a: number, c: number, vf: number, public imax = 0.03) {
    const n = 2;
    super(a, c, { is: 0.01 / Math.exp(vf / (n * VT)), n });
  }
  protected override isOpen(): boolean {
    return this.burned;
  }
  /** 亮度 0..1（20 mA 視為全亮）。 */
  get brightness(): number {
    return this.burned ? 0 : Math.min(1, Math.max(0, this.id / 0.02));
  }
  override commit(s: Simulator): void {
    super.commit(s);
    if (this.burned) return;
    if (this.id > this.imax) {
      this.overSteps++;
      if (this.overSteps >= 20) {
        this.burned = true;
        s.discreteChanged = true;
      }
    } else {
      this.overSteps = 0;
    }
  }
  override saveState(): unknown {
    return { burned: this.burned };
  }
  override loadState(st: any): void {
    this.burned = st.burned;
  }
}

/** 雙極性電晶體（Ebers-Moll）：nodes = [B, C, E]。 */
export class BJT extends Device {
  override nonlinear = true;
  private vcrit: number;
  private vmax: number;
  private vbeL = 0;
  private vbcL = 0;
  // 線性化結果，commit 時用來算端電流。
  private jc = [0, 0, 0];
  private jb = [0, 0, 0];

  constructor(
    b: number,
    c: number,
    e: number,
    private p: 1 | -1,
    private bf = 100,
    private br = 2,
    private is = 1e-14,
  ) {
    super([b, c, e]);
    this.vcrit = vcritFor(is, VT);
    this.vmax = vmaxFor(is, VT);
  }

  stamp(s: Simulator): void {
    const [b, c, e] = this.nodes;
    const { p, bf, br, is, vcrit, vmax } = this;
    const vb = s.v(b);
    const vbeRaw = p * (vb - s.v(e));
    const vbcRaw = p * (vb - s.v(c));
    const vbe = pnjlim(vbeRaw, this.vbeL, VT, vcrit);
    const vbc = pnjlim(vbcRaw, this.vbcL, VT, vcrit);
    if (Math.abs(vbe - vbeRaw) > 1e-9 || Math.abs(vbc - vbcRaw) > 1e-9) s.limited = true;
    this.vbeL = vbe;
    this.vbcL = vbc;

    pn(vbe, is, VT, vmax);
    const iF = pnI;
    const gF = pnG + 1e-12;
    pn(vbc, is, VT, vmax);
    const iR = pnI;
    const gR = pnG + 1e-12;

    const ic = iF - iR * (1 + 1 / br);
    const ib = iF / bf + iR / br;
    // 對 vbe、vbc 的偏導數。
    const cBe = gF;
    const cBc = -gR * (1 + 1 / br);
    const bBe = gF / bf;
    const bBc = gR / br;
    // 流入腳的電流 = 偏導×(實際電壓差) + 等效電流。
    const eqC = p * (ic - cBe * vbe - cBc * vbc);
    const eqB = p * (ib - bBe * vbe - bBc * vbc);
    this.jc = [cBe, cBc, eqC];
    this.jb = [bBe, bBc, eqB];

    s.addNN(c, b, cBe + cBc);
    s.addNN(c, e, -cBe);
    s.addNN(c, c, -cBc);
    s.rhsN(c, -eqC);

    s.addNN(b, b, bBe + bBc);
    s.addNN(b, e, -bBe);
    s.addNN(b, c, -bBc);
    s.rhsN(b, -eqB);

    s.addNN(e, b, -(cBe + cBc + bBe + bBc));
    s.addNN(e, e, cBe + bBe);
    s.addNN(e, c, cBc + bBc);
    s.rhsN(e, eqC + eqB);
  }

  override commit(s: Simulator): void {
    const [b, c, e] = this.nodes;
    const vbe = s.v(b) - s.v(e);
    const vbc = s.v(b) - s.v(c);
    const ic = this.jc[0] * vbe + this.jc[1] * vbc + this.jc[2];
    const ib = this.jb[0] * vbe + this.jb[1] * vbc + this.jb[2];
    this.currents[0] = ib;
    this.currents[1] = ic;
    this.currents[2] = -ic - ib;
  }
}

/** MOSFET（一階平方律）：nodes = [G, D, S]。 */
export class Mosfet extends Device {
  override nonlinear = true;
  private vgsL = 0;
  private vdsL = 0;
  private gm = 0;
  private gds = 0;
  private ieq = 0;
  private swapped = false;

  constructor(
    g: number,
    d: number,
    src: number,
    private p: 1 | -1,
    private vth = 2,
    private k = 0.1,
    private lambda = 0.01,
  ) {
    super([g, d, src]);
  }

  stamp(s: Simulator): void {
    const [g, d0, s0] = this.nodes;
    const { p, vth, k, lambda } = this;
    let vgs = p * (s.v(g) - s.v(s0));
    let vds = p * (s.v(d0) - s.v(s0));

    const limit = (v: number, last: number, max: number) =>
      Math.abs(v - last) > max ? last + Math.sign(v - last) * max : v;
    const vgs2 = limit(vgs, this.vgsL, 1);
    const vds2 = limit(vds, this.vdsL, 2);
    if (vgs2 !== vgs || vds2 !== vds) s.limited = true;
    vgs = vgs2;
    vds = vds2;
    this.vgsL = vgs;
    this.vdsL = vds;

    // vds < 0 時汲極、源極互換。
    const swapped = vds < 0;
    this.swapped = swapped;
    const vgsE = swapped ? vgs - vds : vgs;
    const vdsE = swapped ? -vds : vds;
    const vov = vgsE - vth;

    let id = 0;
    let gm = 0;
    let gds = 1e-9;
    if (vov > 0) {
      const cl = 1 + lambda * vdsE;
      if (vdsE < vov) {
        const f = vov * vdsE - (vdsE * vdsE) / 2;
        id = k * f * cl;
        gm = k * vdsE * cl;
        gds += k * (vov - vdsE) * cl + k * f * lambda;
      } else {
        id = (k / 2) * vov * vov * cl;
        gm = k * vov * cl;
        gds += (k / 2) * vov * vov * lambda;
      }
    }
    const dN = swapped ? s0 : d0;
    const sN = swapped ? d0 : s0;
    this.gm = gm;
    this.gds = gds;
    this.ieq = p * (id - gm * vgsE - gds * vdsE);

    s.addNN(dN, g, gm);
    s.addNN(dN, sN, -gm - gds);
    s.addNN(dN, dN, gds);
    s.rhsN(dN, -this.ieq);
    s.addNN(sN, g, -gm);
    s.addNN(sN, sN, gm + gds);
    s.addNN(sN, dN, -gds);
    s.rhsN(sN, this.ieq);
  }

  override commit(s: Simulator): void {
    const [g, d0, s0] = this.nodes;
    const dN = this.swapped ? s0 : d0;
    const sN = this.swapped ? d0 : s0;
    const i = this.gm * (s.v(g) - s.v(sN)) + this.gds * (s.v(dN) - s.v(sN)) + this.ieq;
    const id = this.swapped ? -i : i;
    this.currents[0] = 0;
    this.currents[1] = id;
    this.currents[2] = -id;
  }
}

const OPAMP_GAIN = 1e5;
const OPAMP_ROUT = 75;
const OPAMP_MARGIN = 1.5;
type Region = 0 | 1 | 2; // 0 線性、1 正飽和、2 負飽和

/**
 * 運算放大器：nodes = [反相輸入, 非反相輸入, 輸出, V+, V-]。
 * 用分段線性模型：線性區或飽和在電源軌。沒有接電源時輸出懸空。
 */
export class OpAmp extends Device {
  override nonlinear = true;
  private region: Region = 1;
  private visited = 0;
  private powered = false;

  stamp(s: Simulator): void {
    const [inN, inP, out, vp, vn] = this.nodes;
    const supply = s.v(vp) - s.v(vn);
    s.G(inP, inN, 5e-7);
    s.G(vp, vn, 7e-5);
    const wasPowered = this.powered;
    this.powered = supply > 2 * OPAMP_MARGIN;
    if (!this.powered) return;

    const hi = s.v(vp) - OPAMP_MARGIN;
    const lo = s.v(vn) + OPAMP_MARGIN;
    const mid = (s.v(vp) + s.v(vn)) / 2;
    const vt = OPAMP_GAIN * (s.v(inP) - s.v(inN)) + mid;

    // 剛通電時先維持原工作區一次：輸出若直接落在線性區，正回授電路會停在不穩定平衡點，不會振盪。
    if (s.iter === 0 || !wasPowered) {
      this.visited = 1 << this.region;
    } else {
      // 飽和要先回到線性區；若正回授造成線性區與飽和來回跳，就翻到另一軌。
      let next: Region = this.region;
      if (this.region === 0) {
        if (vt > hi + 1e-3) next = 1;
        else if (vt < lo - 1e-3) next = 2;
      } else if (this.region === 1) {
        if (vt < hi - 1e-3) next = 0;
      } else if (vt > lo + 1e-3) {
        next = 0;
      }
      if (next !== this.region) {
        if (next !== 0 && this.visited & (1 << next) && this.visited & 1) {
          next = next === 1 ? 2 : 1;
        }
        if (!(this.visited & (1 << next))) {
          this.visited |= 1 << next;
          this.region = next;
          s.limited = true;
        } else if (next !== 0 && next !== this.region) {
          this.region = next;
          s.limited = true;
        }
      }
    }

    const g = 1 / OPAMP_ROUT;
    s.addNN(out, out, g);
    if (this.region === 0) {
      const ag = OPAMP_GAIN * g;
      s.addNN(out, inP, -ag);
      s.addNN(out, inN, ag);
      s.addNN(out, vp, -0.5 * g);
      s.addNN(out, vn, -0.5 * g);
    } else if (this.region === 1) {
      s.addNN(out, vp, -g);
      s.rhsN(out, -OPAMP_MARGIN * g);
    } else {
      s.addNN(out, vn, -g);
      s.rhsN(out, OPAMP_MARGIN * g);
    }
  }

  get isPowered(): boolean {
    return this.powered;
  }

  override commit(s: Simulator): void {
    const [inN, inP, out, vp, vn] = this.nodes;
    const iIn = (s.v(inP) - s.v(inN)) * 5e-7;
    this.currents[0] = -iIn;
    this.currents[1] = iIn;
    if (this.powered) {
      const target =
        this.region === 0
          ? OPAMP_GAIN * (s.v(inP) - s.v(inN)) + (s.v(vp) + s.v(vn)) / 2
          : this.region === 1
            ? s.v(vp) - OPAMP_MARGIN
            : s.v(vn) + OPAMP_MARGIN;
      this.currents[2] = (s.v(out) - target) / OPAMP_ROUT;
    } else {
      this.currents[2] = 0;
    }
    const iq = (s.v(vp) - s.v(vn)) * 7e-5;
    this.currents[3] = iq;
    this.currents[4] = -iq;
  }
  override saveState(): unknown {
    return { region: this.region };
  }
  override loadState(st: any): void {
    this.region = st.region;
  }
}

export type MeterMode = 'dcv' | 'acv' | 'dca' | 'aca' | 'ohm';

/** 三用電錶：nodes = [紅棒, 黑棒]。電壓檔高阻抗、電流檔低阻抗、歐姆檔注入測試電流。 */
export class Meter extends Device {
  private avg = 0;
  private sq = 0;
  private started = false;
  private static TEST_CURRENT = 1e-3;

  constructor(a: number, b: number, public mode: MeterMode) {
    super([a, b]);
  }

  private get conductance(): number {
    if (this.mode === 'dca' || this.mode === 'aca') return 1e3;
    if (this.mode === 'ohm') return 1e-9;
    return 1e-7;
  }

  stamp(s: Simulator): void {
    const [a, b] = this.nodes;
    s.G(a, b, this.conductance);
    if (this.mode === 'ohm') s.I(b, a, Meter.TEST_CURRENT);
  }

  override commit(s: Simulator): void {
    const [a, b] = this.nodes;
    const v = s.v(a) - s.v(b);
    const i = v * this.conductance;
    this.currents[0] = i;
    this.currents[1] = -i;
    const q = this.mode === 'dca' || this.mode === 'aca' ? i : v;
    if (!this.started) {
      this.avg = q;
      this.sq = q * q;
      this.started = true;
    }
    this.avg += (q - this.avg) / 20;
    this.sq += (q * q - this.sq) / 1500;
  }

  /** 目前讀值。歐姆檔回傳 Ω，開路回傳 Infinity。 */
  get reading(): number {
    switch (this.mode) {
      case 'dcv':
      case 'dca':
        return this.avg;
      case 'acv':
      case 'aca':
        return Math.sqrt(this.sq);
      case 'ohm': {
        const r = this.avg / Meter.TEST_CURRENT;
        return r > 2e7 || r < 0 ? Infinity : r;
      }
    }
  }
}
