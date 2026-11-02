// 應用程式狀態：目前電路、模擬迴圈、復原、自動存檔、示波器資料。

import { compareViews } from './circuit/compare';
import { compile, Compiled, updateEdgeCurrents } from './circuit/compile';
import { Diag, liveDiagnostics, staticDiagnostics } from './circuit/diagnostics';
import { cloneDoc, parseDoc, serializeDoc } from './circuit/doc';
import { CircuitDoc, Comp, newDoc, pinKey, ViewKind } from './circuit/types';

/** 每秒真實時間算幾步；步長 = 模擬速度 ÷ 這個數。 */
export const STEPS_PER_SEC = 1000;
const FRAME_BUDGET_MS = 13;
const AUTOSAVE_KEY = 'circuit-sim:autosave';
export const SCOPE_COLORS = ['#e03131', '#1971c2', '#2b8a3e', '#e67700'];
export const MAX_PROBES = 4;

export type AppEvent = 'doc' | 'selection' | 'view' | 'run' | 'slow' | 'tool' | 'loaded';
export type Tool = 'select' | 'wire' | 'probe';

const SCOPE_LEN = 1 << 15;

export class ScopeData {
  times = new Float64Array(SCOPE_LEN);
  channels: Float32Array[] = Array.from({ length: MAX_PROBES }, () => new Float32Array(SCOPE_LEN));
  head = 0;
  count = 0;
  clear(): void {
    this.head = 0;
    this.count = 0;
  }
  push(t: number, values: number[]): void {
    this.times[this.head] = t;
    for (let i = 0; i < values.length; i++) this.channels[i][this.head] = values[i];
    this.head = (this.head + 1) & (SCOPE_LEN - 1);
    if (this.count < SCOPE_LEN) this.count++;
  }
  /** 由舊到新的第 i 筆在環狀緩衝的位置。 */
  index(i: number): number {
    return (this.head - this.count + i + SCOPE_LEN) & (SCOPE_LEN - 1);
  }
}

export class App {
  doc: CircuitDoc;
  view: ViewKind = 'sch';
  compiled!: Compiled;
  running = true;
  selection = new Set<string>();
  showVolts = true;
  tool: Tool = 'select';
  scope = new ScopeData();
  staticDiags: Diag[] = [];
  liveDiags: Diag[] = [];
  vmax = 5;
  /** 這一幀的真實時間（秒），暫停時為 0，用於電流動畫。 */
  frameDt = 0;
  /** 模擬跟不上速度時為 true。 */
  lagging = false;

  private listeners = new Set<(e: AppEvent) => void>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private lastSnapshot = '';
  private savedSnapshot = '';
  private lastCoalesce: string | null = null;
  private lastCoalesceAt = 0;
  private stepCarry = 0;
  private slowClock = 0;
  private autosaveTimer: number | undefined;
  private probeNodes: (number | null)[] = [];

  constructor(doc?: CircuitDoc) {
    this.doc = doc ?? newDoc();
    this.lastSnapshot = serializeDoc(this.doc);
    this.savedSnapshot = this.lastSnapshot;
    this.rebuild(false);
  }

  on(fn: (e: AppEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(e: AppEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  // ---- 編譯 ----

  rebuild(keepState = true): void {
    this.compiled = compile(this.doc, this.view, keepState ? this.compiled : null);
    this.staticDiags = staticDiagnostics(this.compiled);
    this.refreshProbes();
  }

  private refreshProbes(): void {
    const c = this.compiled;
    this.probeNodes = this.doc.probes.map((p) => {
      const n = c.nets.pinNet.get(pinKey(p.compId, p.pin));
      return n === undefined ? null : c.netNode[n];
    });
  }

  /** 使用者完成一次修改：記入復原、重建模擬、存檔。 */
  commit(coalesceKey?: string): void {
    const now = performance.now();
    const snap = serializeDoc(this.doc);
    if (snap !== this.lastSnapshot) {
      const coalesced = coalesceKey && coalesceKey === this.lastCoalesce && now - this.lastCoalesceAt < 1500;
      if (!coalesced) {
        this.undoStack.push(this.lastSnapshot);
        if (this.undoStack.length > 200) this.undoStack.shift();
      }
      this.redoStack = [];
      this.lastSnapshot = snap;
    }
    this.lastCoalesce = coalesceKey ?? null;
    this.lastCoalesceAt = now;
    this.rebuild();
    this.scheduleAutosave();
    this.emit('doc');
  }

  /** 不進復原的修改：切換開關、按按鈕、拖曳途中。 */
  transient(): void {
    this.lastSnapshot = serializeDoc(this.doc);
    this.rebuild();
    this.scheduleAutosave();
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.lastSnapshot);
    this.restore(prev);
  }
  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.lastSnapshot);
    this.restore(next);
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  /** 有未存檔的修改。 */
  get isDirty(): boolean {
    return this.lastSnapshot !== this.savedSnapshot;
  }
  markSaved(): void {
    this.savedSnapshot = serializeDoc(this.doc);
  }

  private restore(snap: string): void {
    this.doc = parseDoc(snap);
    this.lastSnapshot = snap;
    this.pruneSelection();
    this.rebuild();
    this.scheduleAutosave();
    this.emit('doc');
    this.emit('selection');
  }

  private pruneSelection(): void {
    const ids = new Set([...this.doc.comps.map((c) => c.id), ...this.doc.schWires.map((w) => w.id), ...this.doc.bbWires.map((w) => w.id)]);
    for (const id of [...this.selection]) if (!ids.has(id)) this.selection.delete(id);
  }

  /** 開新的電路（範例、讀檔、實驗）：清空復原紀錄與示波器。 */
  loadDoc(doc: CircuitDoc, view?: ViewKind): void {
    this.doc = cloneDoc(doc);
    this.lastSnapshot = serializeDoc(this.doc);
    this.savedSnapshot = this.lastSnapshot;
    this.undoStack = [];
    this.redoStack = [];
    this.selection.clear();
    if (view) this.view = view;
    this.scope.clear();
    this.running = true;
    this.rebuild(false);
    this.scheduleAutosave();
    this.emit('loaded');
    this.emit('view');
    this.emit('doc');
    this.emit('selection');
    this.emit('run');
  }

  /** 回到 t=0：電容放電、LED 換新。 */
  reset(): void {
    this.scope.clear();
    this.rebuild(false);
    this.emit('doc');
  }

  setView(v: ViewKind): void {
    if (v === this.view) return;
    this.view = v;
    this.selection.clear();
    this.scope.clear();
    this.rebuild(true);
    this.emit('view');
    this.emit('selection');
    this.emit('doc');
  }

  setTool(t: Tool): void {
    this.tool = t;
    this.emit('tool');
  }

  setRunning(r: boolean): void {
    this.running = r;
    this.emit('run');
  }

  setSpeed(speed: number): void {
    this.doc.speed = speed;
    this.scope.clear();
    this.commit('speed');
  }

  select(ids: string[], additive = false): void {
    if (!additive) this.selection.clear();
    for (const id of ids) this.selection.add(id);
    this.emit('selection');
  }

  get selectedComp(): Comp | null {
    if (this.selection.size !== 1) return null;
    const id = [...this.selection][0];
    return this.doc.comps.find((c) => c.id === id) ?? null;
  }

  // ---- 示波器探棒 ----

  addProbe(compId: string, pin: number): void {
    const c = this.compiled;
    const net = c.nets.pinNet.get(pinKey(compId, pin));
    // 同一個節點不重複加。
    const dup = this.doc.probes.some((p) => net !== undefined && c.nets.pinNet.get(pinKey(p.compId, p.pin)) === net);
    if (dup) return;
    if (this.doc.probes.length >= MAX_PROBES) this.doc.probes.shift();
    this.doc.probes.push({ compId, pin });
    this.scope.clear();
    this.commit();
  }

  removeProbe(i: number): void {
    this.doc.probes.splice(i, 1);
    this.scope.clear();
    this.commit();
  }

  // ---- 模擬迴圈 ----

  tick(realDt: number): void {
    const dt = Math.min(realDt, 0.05);
    this.frameDt = this.running ? dt : 0;
    if (this.running) this.advance(dt);
    this.slowClock += realDt;
    if (this.slowClock > 0.25) {
      this.slowClock = 0;
      this.liveDiags = liveDiagnostics(this.compiled);
      this.emit('slow');
    }
  }

  private advance(realDt: number): void {
    const c = this.compiled;
    this.stepCarry += realDt * STEPS_PER_SEC;
    const steps = Math.floor(this.stepCarry);
    this.stepCarry -= steps;
    const dt = this.doc.speed / STEPS_PER_SEC;
    const t0 = performance.now();
    const nodes = this.probeNodes;
    const values = new Array<number>(nodes.length);
    let done = 0;
    for (; done < steps; done++) {
      c.sim.step(dt);
      if (nodes.length) {
        for (let k = 0; k < nodes.length; k++) {
          const n = nodes[k];
          values[k] = n === null ? NaN : c.sim.v(n);
        }
        this.scope.push(c.sim.time, values);
      }
      if ((done & 7) === 7 && performance.now() - t0 > FRAME_BUDGET_MS) break;
    }
    this.lagging = done < steps;
    if (done < steps) this.stepCarry = 0;
    updateEdgeCurrents(c);
    let max = 0;
    for (let n = 1; n <= c.sim.numNodes; n++) max = Math.max(max, Math.abs(c.sim.v(n)));
    this.vmax += (Math.max(1, max) - this.vmax) * 0.1;
  }

  /** 單步前進，讓暫停時也能觀察。 */
  stepOnce(): void {
    this.advance(1 / 30);
    this.liveDiags = liveDiagnostics(this.compiled);
    this.emit('slow');
  }

  get diags(): Diag[] {
    return [...this.liveDiags, ...this.staticDiags];
  }

  errorComps(): Set<string> {
    const out = new Set<string>();
    for (const d of this.liveDiags) if (d.level === 'error' && d.compId) out.add(d.compId);
    return out;
  }

  compare() {
    return compareViews(this.doc);
  }

  // ---- 自動存檔 ----

  private scheduleAutosave(): void {
    if (this.autosaveTimer !== undefined) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, serializeDoc(this.doc));
      } catch {
        // 瀏覽器不允許儲存時就略過，不影響使用。
      }
    }, 500);
  }
}

export function loadAutosave(): CircuitDoc | null {
  try {
    const s = localStorage.getItem(AUTOSAVE_KEY);
    return s ? parseDoc(s) : null;
  } catch {
    return null;
  }
}
