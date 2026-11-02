// 模擬核心：修正節點分析法（MNA）＋牛頓法＋固定步長時間積分。
// 節點編號 0 是參考點（接地），1..numNodes 是其他節點。
// 未知數 x = [節點電壓..., 支路電流...]。

export type Method = 'trap' | 'be';

export abstract class Device {
  readonly nodes: number[];
  /** 需要額外未知電流的數量（例如電壓源）。 */
  readonly numBranches: number = 0;
  branchBase = -1;
  /** 每隻腳流入元件的電流（A），每步結束更新。 */
  currents: number[];
  nonlinear = false;

  constructor(nodes: number[]) {
    this.nodes = nodes;
    this.currents = nodes.map(() => 0);
  }

  /** 組裝方程式。牛頓法每次迭代都會呼叫。 */
  abstract stamp(s: Simulator): void;
  /** 這一步求解完成後更新內部狀態與 currents。 */
  commit(_s: Simulator): void {}
  /** 電路修改重建時，用來保留電容電壓、正反器狀態等。 */
  saveState(): unknown {
    return undefined;
  }
  loadState(_state: unknown): void {}
}

const GMIN = 1e-12;
const VN_TOL = 1e-6;
const REL_TOL = 1e-4;
const MAX_ITER = 60;

export class Simulator {
  readonly numNodes: number;
  readonly devices: Device[];
  readonly size: number;
  /** 目前迭代的解。 */
  x: Float64Array;
  time = 0;
  dt = 1e-5;
  method: Method = 'be';
  /** 目前步驟的第幾次迭代。 */
  iter = 0;
  /** 元件在本次迭代限制了電壓變化，或切換了工作區，因此還不能視為收斂。 */
  limited = false;
  /** 有數位狀態或開關改變：下一步用後向尤拉法，避免梯形法振鈴。 */
  discreteChanged = true;
  /** 上一步牛頓法是否收斂。 */
  converged = true;
  nonConvergedSteps = 0;
  numericFault = false;

  private A: Float64Array;
  private z: Float64Array;
  private xNew: Float64Array;
  private xPrev: Float64Array;
  private lu: Float64Array;
  private factoredA: Float64Array;
  private factoredValid = false;
  private piv: Int32Array;
  private hasNonlinear: boolean;

  constructor(numNodes: number, devices: Device[]) {
    this.numNodes = numNodes;
    this.devices = devices;
    let branches = 0;
    for (const d of devices) {
      d.branchBase = branches;
      branches += d.numBranches;
    }
    const n = numNodes + branches;
    this.size = n;
    this.x = new Float64Array(n);
    this.xNew = new Float64Array(n);
    this.xPrev = new Float64Array(n);
    this.z = new Float64Array(n);
    this.A = new Float64Array(n * n);
    this.lu = new Float64Array(n * n);
    this.factoredA = new Float64Array(n * n);
    this.piv = new Int32Array(n);
    this.hasNonlinear = devices.some((d) => d.nonlinear);
  }

  // ---- 給元件組裝用 ----

  /** 節點電壓（目前迭代）。 */
  v(node: number): number {
    return node === 0 ? 0 : this.x[node - 1];
  }
  /** 支路電流（目前迭代）。 */
  branchCurrent(branch: number): number {
    return this.x[this.numNodes + branch];
  }
  /** 在節點 a、b 間加上電導。 */
  G(a: number, b: number, g: number): void {
    const n = this.size;
    const A = this.A;
    if (a !== 0) A[(a - 1) * n + (a - 1)] += g;
    if (b !== 0) A[(b - 1) * n + (b - 1)] += g;
    if (a !== 0 && b !== 0) {
      A[(a - 1) * n + (b - 1)] -= g;
      A[(b - 1) * n + (a - 1)] -= g;
    }
  }
  /** 電流 i 由節點 a 經元件流到節點 b。 */
  I(a: number, b: number, i: number): void {
    if (a !== 0) this.z[a - 1] -= i;
    if (b !== 0) this.z[b - 1] += i;
  }
  /** 節點列、節點欄。 */
  addNN(row: number, col: number, val: number): void {
    if (row !== 0 && col !== 0) this.A[(row - 1) * this.size + (col - 1)] += val;
  }
  /** 節點列、支路欄。 */
  addNB(row: number, branch: number, val: number): void {
    if (row !== 0) this.A[(row - 1) * this.size + (this.numNodes + branch)] += val;
  }
  /** 支路列、節點欄。 */
  addBN(branch: number, col: number, val: number): void {
    if (col !== 0) this.A[(this.numNodes + branch) * this.size + (col - 1)] += val;
  }
  /** 支路列、支路欄。 */
  addBB(branchRow: number, branchCol: number, val: number): void {
    this.A[(this.numNodes + branchRow) * this.size + (this.numNodes + branchCol)] += val;
  }
  rhsN(row: number, val: number): void {
    if (row !== 0) this.z[row - 1] += val;
  }
  rhsB(branch: number, val: number): void {
    this.z[this.numNodes + branch] += val;
  }

  // ---- 時間步進 ----

  /** 前進一步。回傳牛頓法是否收斂；不收斂時仍繼續，不會卡住畫面。 */
  step(dt: number): boolean {
    this.dt = dt;
    this.time += dt;
    this.method = this.discreteChanged ? 'be' : 'trap';
    this.discreteChanged = false;
    this.xPrev.set(this.x);

    const ok = this.newton();
    this.converged = ok;
    if (!ok) this.nonConvergedSteps++;

    for (let i = 0; i < this.size; i++) {
      if (!Number.isFinite(this.x[i])) {
        // 數值爆掉：退回上一步，這一步不更新元件狀態。
        this.x.set(this.xPrev);
        this.numericFault = true;
        this.factoredValid = false;
        this.discreteChanged = true;
        return false;
      }
    }
    for (const d of this.devices) d.commit(this);
    return ok;
  }

  private newton(): boolean {
    const n = this.size;
    for (this.iter = 0; this.iter < MAX_ITER; this.iter++) {
      this.A.fill(0);
      this.z.fill(0);
      this.limited = false;
      for (let i = 0; i < this.numNodes; i++) this.A[i * n + i] += GMIN;
      for (const d of this.devices) d.stamp(this);

      this.factorIfChanged();
      this.solve(this.z, this.xNew);

      let done = !this.limited;
      for (let i = 0; i < n; i++) {
        const a = this.xNew[i];
        const b = this.x[i];
        if (done && Math.abs(a - b) > REL_TOL * Math.max(Math.abs(a), Math.abs(b)) + VN_TOL) done = false;
      }
      this.x.set(this.xNew);
      if (!this.hasNonlinear) return true;
      if (done && this.iter > 0) return true;
    }
    return false;
  }

  /** A 沒變時沿用上次的 LU 分解：線性電路每步只要回代。 */
  private factorIfChanged(): void {
    const n = this.size;
    const A = this.A;
    if (this.factoredValid) {
      let same = true;
      for (let i = 0; i < A.length; i++) {
        if (A[i] !== this.factoredA[i]) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
    this.factoredA.set(A);
    this.factoredValid = true;
    const lu = this.lu;
    lu.set(A);
    const piv = this.piv;
    for (let k = 0; k < n; k++) {
      let p = k;
      let max = Math.abs(lu[k * n + k]);
      for (let i = k + 1; i < n; i++) {
        const m = Math.abs(lu[i * n + k]);
        if (m > max) {
          max = m;
          p = i;
        }
      }
      piv[k] = p;
      if (p !== k) {
        for (let j = 0; j < n; j++) {
          const t = lu[k * n + j];
          lu[k * n + j] = lu[p * n + j];
          lu[p * n + j] = t;
        }
      }
      if (lu[k * n + k] === 0) lu[k * n + k] = 1e-30;
      const d = lu[k * n + k];
      for (let i = k + 1; i < n; i++) {
        const f = lu[i * n + k] / d;
        lu[i * n + k] = f;
        if (f !== 0) {
          for (let j = k + 1; j < n; j++) lu[i * n + j] -= f * lu[k * n + j];
        }
      }
    }
  }

  private solve(b: Float64Array, out: Float64Array): void {
    const n = this.size;
    const lu = this.lu;
    out.set(b);
    // 分解時整列（含 L 部分）一起交換，所以要先套用全部列交換，再做前向代入。
    for (let k = 0; k < n; k++) {
      const p = this.piv[k];
      if (p !== k) {
        const t = out[k];
        out[k] = out[p];
        out[p] = t;
      }
    }
    for (let k = 0; k < n; k++) {
      for (let i = k + 1; i < n; i++) out[i] -= lu[i * n + k] * out[k];
    }
    for (let i = n - 1; i >= 0; i--) {
      let sum = out[i];
      for (let j = i + 1; j < n; j++) sum -= lu[i * n + j] * out[j];
      out[i] = sum / lu[i * n + i];
    }
  }
}
