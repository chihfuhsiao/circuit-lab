// 電路文件模型：元件清單由兩個畫面共用，接線各自獨立（見 docs/DECISIONS.md）。

export type ViewKind = 'sch' | 'bb';
export type ParamValue = number | string | boolean;
export type Point = [number, number];

/** 電路圖位置，單位是格點。rot 為順時針 90° 的次數。 */
export interface SchPlace {
  x: number;
  y: number;
  rot: number;
}

/**
 * 麵包板位置，依元件外型使用不同欄位：
 * - 兩腳元件：holes = [腳0的孔, 腳1的孔]
 * - 直插元件（電晶體、可變電阻）：row、col、rev
 * - DIP：col（第 1 腳所在的欄）
 * - 桌上儀器（電源、電錶）：x、y（單位是孔距）
 */
export interface BBPlace {
  holes?: string[];
  row?: string;
  col?: number;
  rev?: boolean;
  x?: number;
  y?: number;
}

export interface Comp {
  id: string;
  type: string;
  ref: string;
  params: Record<string, ParamValue>;
  sch?: SchPlace;
  bb?: BBPlace;
}

export interface SchWire {
  id: string;
  pts: Point[];
}

/** 麵包板跳線。a、b 是孔位（例如 a12）或儀器端子（t:元件id:腳）。 */
export interface BBWire {
  id: string;
  a: string;
  b: string;
  color: string;
}

export interface Probe {
  compId: string;
  pin: number;
}

export interface CircuitDoc {
  version: 1;
  title: string;
  comps: Comp[];
  schWires: SchWire[];
  bbWires: BBWire[];
  /** 每秒真實時間模擬幾秒。 */
  speed: number;
  probes: Probe[];
  /** 下一個編號，用來產生唯一 id。 */
  nextId: number;
}

export function newDoc(title = '未命名電路'): CircuitDoc {
  return { version: 1, title, comps: [], schWires: [], bbWires: [], speed: 0.1, probes: [], nextId: 1 };
}

export const pinKey = (compId: string, pin: number) => `${compId}:${pin}`;
