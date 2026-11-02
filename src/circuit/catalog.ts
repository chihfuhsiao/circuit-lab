// 元件資料庫：名稱、腳位、參數、麵包板外型，以及如何建立引擎元件。
// 元件的外觀畫法在 src/view/，這裡不碰畫面，才能在測試中單獨使用。

import { Device } from '../engine/sim';
import {
  BJT,
  Capacitor,
  CurrentSource,
  Diode,
  Inductor,
  Led,
  Meter,
  MeterMode,
  Mosfet,
  OpAmp,
  Potentiometer,
  Resistor,
  Switch,
  VoltageSource,
  waves,
} from '../engine/analog';
import {
  chip7447,
  chip7474,
  chip7493,
  Composite,
  counter4,
  dFlipFlop,
  gateChip,
  gateDevice,
  GateKind,
  hexDisplay,
  jkFlipFlop,
  logicInput,
  Timer555,
} from '../engine/digital';
import { Comp, ParamValue, Point } from './types';

export type Category = '電源' | '被動元件' | '半導體' | '開關' | '儀表' | '邏輯閘' | '數位電路' | '積體電路';
export const CATEGORIES: Category[] = ['電源', '被動元件', '半導體', '開關', '儀表', '邏輯閘', '數位電路', '積體電路'];

export interface PinDef {
  name: string;
  /** 電路圖上的位置（格點，未旋轉）。 */
  sch: Point;
  /** DIP 腳號。 */
  dip?: number;
  /** 空接屬正常用法，不提醒。 */
  optional?: boolean;
}

export interface ParamDef {
  key: string;
  label: string;
  unit?: string;
  def: ParamValue;
  kind: 'number' | 'select' | 'bool' | 'percent';
  options?: { value: string; label: string }[];
  /** 拉桿範圍（對數刻度）。 */
  min?: number;
  max?: number;
  /** 只在這個條件成立時顯示。 */
  visible?: (p: Record<string, ParamValue>) => boolean;
}

export type BBFoot =
  | { kind: 'twoLead'; span: number }
  | { kind: 'inline'; order: number[] }
  | { kind: 'dip'; numPins: number }
  | { kind: 'bench'; w: number; h: number; terms: Point[] };

export interface CompDef {
  type: string;
  name: string;
  prefix: string;
  category: Category;
  desc: string;
  pins: PinDef[];
  params: ParamDef[];
  /** 電路圖上的碰撞框半寬／半高（格點）；沒有表示不能放在電路圖。 */
  sch?: { hw: number; hh: number; rot?: number };
  bb?: BBFoot;
  /** 內部相連的腳，例如七段顯示器的兩個共同腳。 */
  ties?: number[][];
  build?: (c: Comp, n: number[]) => Device;
}

const num = (c: Comp, key: string) => Number(c.params[key]);

const twoPins = (a: string, b: string): PinDef[] => [
  { name: a, sch: [-2, 0] },
  { name: b, sch: [2, 0] },
];

const twoLead = (span: number): BBFoot => ({ kind: 'twoLead', span });

export const LED_COLORS: Record<string, { vf: number; label: string; color: string }> = {
  red: { vf: 2.0, label: '紅色', color: '#ff3b30' },
  yellow: { vf: 2.1, label: '黃色', color: '#ffd60a' },
  green: { vf: 2.2, label: '綠色', color: '#34c759' },
  blue: { vf: 3.2, label: '藍色', color: '#2f7bff' },
  white: { vf: 3.2, label: '白色', color: '#f5f5f0' },
};

const SI_DIODE = { is: 2.5e-9, n: 1.75 };

export const WAVE_OPTIONS = [
  { value: 'sine', label: '正弦波' },
  { value: 'square', label: '方波' },
  { value: 'triangle', label: '三角波' },
];

/** 四閘 IC 的腳位表：[輸入..., 輸出]。 */
const QUAD_STD = [
  [1, 2, 3],
  [4, 5, 6],
  [9, 10, 8],
  [12, 13, 11],
];
const QUAD_NOR = [
  [2, 3, 1],
  [5, 6, 4],
  [8, 9, 10],
  [11, 12, 13],
];
const HEX_INV = [
  [1, 2],
  [3, 4],
  [5, 6],
  [9, 8],
  [11, 10],
  [13, 12],
];

/** DIP 元件在電路圖上用方塊表示：左側由上而下 1..n/2，右側由上而下 n..n/2+1。 */
export function dipSchPin(numPins: number, k: number): Point {
  const half = numPins / 2;
  if (k <= half) return [-5, (k - 1) * 2 - (half - 1)];
  return [5, (numPins - k) * 2 - (half - 1)];
}

function dipPins(names: string[], optional: number[] = []): PinDef[] {
  return names.map((name, i) => ({
    name,
    sch: dipSchPin(names.length, i + 1),
    dip: i + 1,
    optional: optional.includes(i + 1) || name === 'NC',
  }));
}

function quadChip(type: string, label: string, kind: GateKind, gateName: string): CompDef {
  const units = kind === 'nor' ? QUAD_NOR : QUAD_STD;
  const names = Array(14).fill('NC');
  units.forEach((u, i) => {
    names[u[0] - 1] = `${i + 1}A`;
    names[u[1] - 1] = `${i + 1}B`;
    names[u[2] - 1] = `${i + 1}Y`;
  });
  names[13] = 'VCC';
  names[6] = 'GND';
  const pins = dipPins(names, units.flat());
  return {
    type,
    name: label,
    prefix: 'U',
    category: '積體電路',
    desc: `四個 ${gateName} 閘，要接 14 腳 VCC 與 7 腳 GND 才會動作`,
    pins,
    params: [],
    sch: { hw: 5, hh: 7 },
    bb: { kind: 'dip', numPins: 14 },
    build: (_c, n) => gateChip(kind, n, units, 14, 7),
  };
}

function gateDef(type: GateKind, name: string, desc: string): CompDef {
  const single = type === 'not' || type === 'buf';
  const inputs: PinDef[] = single
    ? [{ name: 'A', sch: [-3, 0], optional: true }]
    : [
        { name: 'A', sch: [-3, -1], optional: true },
        { name: 'B', sch: [-3, 1], optional: true },
      ];
  return {
    type,
    name,
    prefix: 'G',
    category: '邏輯閘',
    desc,
    pins: [...inputs, { name: 'Y', sch: [3, 0], optional: true }],
    params: [],
    sch: { hw: 3, hh: 2 },
    build: (_c, n) => gateDevice(type, n),
  };
}

const defs: CompDef[] = [
  // ---- 電源 ----
  {
    type: 'dc',
    name: '直流電源',
    prefix: 'V',
    category: '電源',
    desc: '提供固定電壓，例如電池或電源供應器',
    pins: twoPins('正極', '負極'),
    params: [{ key: 'V', label: '電壓', unit: 'V', def: 5, kind: 'number', min: 0.1, max: 100 }],
    sch: { hw: 1, hh: 2, rot: 1 },
    bb: { kind: 'bench', w: 7, h: 4, terms: [[2, 4], [5, 4]] },
    build: (c, n) => new VoltageSource(n[0], n[1], waves.dc(num(c, 'V'))),
  },
  {
    type: 'ac',
    name: '訊號產生器',
    prefix: 'VS',
    category: '電源',
    desc: '輸出交流訊號：正弦波、方波或三角波',
    pins: twoPins('輸出', '共同'),
    params: [
      { key: 'wave', label: '波形', def: 'sine', kind: 'select', options: WAVE_OPTIONS },
      { key: 'amp', label: '振幅', unit: 'V', def: 5, kind: 'number', min: 0.01, max: 100 },
      { key: 'freq', label: '頻率', unit: 'Hz', def: 60, kind: 'number', min: 0.1, max: 1e6 },
      { key: 'offset', label: '直流偏移', unit: 'V', def: 0, kind: 'number' },
    ],
    sch: { hw: 2, hh: 2, rot: 1 },
    bb: { kind: 'bench', w: 8, h: 4, terms: [[2, 4], [6, 4]] },
    build: (c, n) => {
      const amp = num(c, 'amp');
      const f = num(c, 'freq');
      const off = num(c, 'offset');
      const w = c.params.wave === 'square' ? waves.square(amp, f, off) : c.params.wave === 'triangle' ? waves.triangle(amp, f, off) : waves.sine(amp, f, off);
      return new VoltageSource(n[0], n[1], w);
    },
  },
  {
    type: 'isrc',
    name: '電流源',
    prefix: 'I',
    category: '電源',
    desc: '提供固定電流，箭頭是電流方向',
    pins: twoPins('流入', '流出'),
    params: [{ key: 'I', label: '電流', unit: 'A', def: 0.01, kind: 'number', min: 1e-6, max: 10 }],
    sch: { hw: 2, hh: 2, rot: 1 },
    build: (c, n) => new CurrentSource(n[0], n[1], num(c, 'I')),
  },
  {
    type: 'gnd',
    name: '接地',
    prefix: 'GND',
    category: '電源',
    desc: '電壓的參考點（0V）。電路圖上所有接地都是同一點',
    pins: [{ name: '接地', sch: [0, 0], optional: true }],
    params: [],
    sch: { hw: 1, hh: 1 },
  },
  {
    type: 'rail',
    name: '電源標籤',
    prefix: 'VCC',
    category: '電源',
    desc: '接到固定電壓的簡寫，免畫電源和回路。只能用在電路圖',
    pins: [{ name: '輸出', sch: [0, 0] }],
    params: [{ key: 'V', label: '電壓', unit: 'V', def: 5, kind: 'number' }],
    sch: { hw: 1, hh: 1 },
    build: (c, n) => new VoltageSource(n[0], 0, waves.dc(num(c, 'V'))),
  },

  // ---- 被動元件 ----
  {
    type: 'res',
    name: '電阻',
    prefix: 'R',
    category: '被動元件',
    desc: '限制電流，電壓與電流成正比（V = IR）',
    pins: twoPins('腳1', '腳2'),
    params: [
      { key: 'R', label: '電阻值', unit: 'Ω', def: 1000, kind: 'number', min: 1, max: 1e7 },
      { key: 'Pmax', label: '額定功率', unit: 'W', def: 0.25, kind: 'number' },
    ],
    sch: { hw: 2, hh: 1 },
    bb: twoLead(4),
    build: (c, n) => new Resistor(n[0], n[1], Math.max(1e-3, num(c, 'R'))),
  },
  {
    type: 'pot',
    name: '可變電阻',
    prefix: 'VR',
    category: '被動元件',
    desc: '旋轉改變中間腳的位置，常用來調整分壓',
    pins: [
      { name: '端點A', sch: [-2, 0] },
      { name: '端點B', sch: [2, 0] },
      { name: '中間腳', sch: [0, -2] },
    ],
    params: [
      { key: 'R', label: '總電阻', unit: 'Ω', def: 10000, kind: 'number', min: 100, max: 1e6 },
      { key: 'pos', label: '位置', def: 0.5, kind: 'percent' },
    ],
    sch: { hw: 2, hh: 2 },
    bb: { kind: 'inline', order: [0, 2, 1] },
    build: (c, n) => new Potentiometer(n[0], n[1], n[2], Math.max(1, num(c, 'R')), num(c, 'pos')),
  },
  {
    type: 'cap',
    name: '電容',
    prefix: 'C',
    category: '被動元件',
    desc: '儲存電荷，電壓不能瞬間改變。電解電容有正負極',
    pins: twoPins('正極', '負極'),
    params: [
      { key: 'C', label: '電容值', unit: 'F', def: 100e-6, kind: 'number', min: 1e-12, max: 0.1 },
      { key: 'polar', label: '電解電容（有極性）', def: true, kind: 'bool' },
    ],
    sch: { hw: 2, hh: 1 },
    bb: twoLead(2),
    build: (c, n) => new Capacitor(n[0], n[1], Math.max(1e-15, num(c, 'C'))),
  },
  {
    type: 'ind',
    name: '電感',
    prefix: 'L',
    category: '被動元件',
    desc: '儲存磁能，電流不能瞬間改變',
    pins: twoPins('腳1', '腳2'),
    params: [{ key: 'L', label: '電感值', unit: 'H', def: 0.01, kind: 'number', min: 1e-6, max: 10 }],
    sch: { hw: 2, hh: 1 },
    bb: twoLead(4),
    build: (c, n) => new Inductor(n[0], n[1], Math.max(1e-9, num(c, 'L'))),
  },
  {
    type: 'lamp',
    name: '燈泡',
    prefix: 'LP',
    category: '被動元件',
    desc: '功率越大越亮',
    pins: twoPins('腳1', '腳2'),
    params: [
      { key: 'R', label: '燈絲電阻', unit: 'Ω', def: 100, kind: 'number', min: 1, max: 1e4 },
      { key: 'Pfull', label: '全亮功率', unit: 'W', def: 0.25, kind: 'number' },
    ],
    sch: { hw: 2, hh: 2 },
    bb: twoLead(4),
    build: (c, n) => new Resistor(n[0], n[1], Math.max(1e-3, num(c, 'R'))),
  },

  // ---- 半導體 ----
  {
    type: 'diode',
    name: '二極體',
    prefix: 'D',
    category: '半導體',
    desc: '電流只能由陽極流向陰極，順向壓降約 0.7V',
    pins: twoPins('陽極', '陰極'),
    params: [],
    sch: { hw: 2, hh: 1 },
    bb: twoLead(4),
    build: (_c, n) => new Diode(n[0], n[1], SI_DIODE),
  },
  {
    type: 'zener',
    name: '齊納二極體',
    prefix: 'ZD',
    category: '半導體',
    desc: '逆向崩潰時兩端電壓幾乎固定，常用來穩壓',
    pins: twoPins('陽極', '陰極'),
    params: [{ key: 'Vz', label: '齊納電壓', unit: 'V', def: 5.1, kind: 'number', min: 1, max: 100 }],
    sch: { hw: 2, hh: 1 },
    bb: twoLead(4),
    build: (c, n) => new Diode(n[0], n[1], { ...SI_DIODE, bv: num(c, 'Vz') }),
  },
  {
    type: 'led',
    name: 'LED',
    prefix: 'LED',
    category: '半導體',
    desc: '發光二極體。一定要串限流電阻，電流太大會燒毀',
    pins: twoPins('陽極', '陰極'),
    params: [
      {
        key: 'color',
        label: '顏色',
        def: 'red',
        kind: 'select',
        options: Object.entries(LED_COLORS).map(([value, v]) => ({ value, label: v.label })),
      },
    ],
    sch: { hw: 2, hh: 1 },
    bb: twoLead(2),
    build: (c, n) => new Led(n[0], n[1], (LED_COLORS[String(c.params.color)] ?? LED_COLORS.red).vf),
  },
  {
    type: 'npn',
    name: 'NPN 電晶體',
    prefix: 'Q',
    category: '半導體',
    desc: '基極小電流控制集極大電流，Ic ≈ β × Ib',
    pins: [
      { name: 'B', sch: [-2, 0] },
      { name: 'C', sch: [1, -2] },
      { name: 'E', sch: [1, 2] },
    ],
    params: [{ key: 'beta', label: '電流增益 β', def: 100, kind: 'number', min: 10, max: 1000 }],
    sch: { hw: 2, hh: 2 },
    bb: { kind: 'inline', order: [2, 0, 1] },
    build: (c, n) => new BJT(n[0], n[1], n[2], 1, num(c, 'beta')),
  },
  {
    type: 'pnp',
    name: 'PNP 電晶體',
    prefix: 'Q',
    category: '半導體',
    desc: '和 NPN 電流方向相反，基極拉低時導通',
    pins: [
      { name: 'B', sch: [-2, 0] },
      { name: 'C', sch: [1, -2] },
      { name: 'E', sch: [1, 2] },
    ],
    params: [{ key: 'beta', label: '電流增益 β', def: 100, kind: 'number', min: 10, max: 1000 }],
    sch: { hw: 2, hh: 2 },
    bb: { kind: 'inline', order: [2, 0, 1] },
    build: (c, n) => new BJT(n[0], n[1], n[2], -1, num(c, 'beta')),
  },
  {
    type: 'nmos',
    name: 'N 通道 MOSFET',
    prefix: 'M',
    category: '半導體',
    desc: '閘極電壓控制導通，閘極幾乎不取電流',
    pins: [
      { name: 'G', sch: [-2, 0] },
      { name: 'D', sch: [1, -2] },
      { name: 'S', sch: [1, 2] },
    ],
    params: [{ key: 'Vth', label: '臨界電壓', unit: 'V', def: 2, kind: 'number', min: 0.5, max: 10 }],
    sch: { hw: 2, hh: 2 },
    bb: { kind: 'inline', order: [2, 0, 1] },
    build: (c, n) => new Mosfet(n[0], n[1], n[2], 1, num(c, 'Vth')),
  },
  {
    type: 'pmos',
    name: 'P 通道 MOSFET',
    prefix: 'M',
    category: '半導體',
    desc: '和 N 通道相反，閘極比源極低時導通',
    pins: [
      { name: 'G', sch: [-2, 0] },
      { name: 'D', sch: [1, -2] },
      { name: 'S', sch: [1, 2] },
    ],
    params: [{ key: 'Vth', label: '臨界電壓', unit: 'V', def: 2, kind: 'number', min: 0.5, max: 10 }],
    sch: { hw: 2, hh: 2 },
    bb: { kind: 'inline', order: [2, 0, 1] },
    build: (c, n) => new Mosfet(n[0], n[1], n[2], -1, num(c, 'Vth')),
  },
  {
    type: 'opamp',
    name: '運算放大器',
    prefix: 'U',
    category: '半導體',
    desc: 'µA741：放大兩輸入端的電壓差。要接正負電源，輸出無法超過電源',
    pins: [
      { name: '反相輸入 −', sch: [-3, -1], dip: 2 },
      { name: '非反相輸入 +', sch: [-3, 1], dip: 3 },
      { name: '輸出', sch: [3, 0], dip: 6 },
      { name: 'V+', sch: [0, -2], dip: 7 },
      { name: 'V−', sch: [0, 2], dip: 4 },
    ],
    params: [],
    sch: { hw: 3, hh: 2 },
    bb: { kind: 'dip', numPins: 8 },
    build: (_c, n) => new OpAmp(n),
  },

  // ---- 開關 ----
  {
    type: 'sw',
    name: '開關',
    prefix: 'SW',
    category: '開關',
    desc: '點一下切換導通或斷開',
    pins: twoPins('腳1', '腳2'),
    params: [{ key: 'closed', label: '導通', def: false, kind: 'bool' }],
    sch: { hw: 2, hh: 1 },
    bb: twoLead(3),
    build: (c, n) => new Switch(n[0], n[1], c.params.closed === true),
  },
  {
    type: 'push',
    name: '按鈕',
    prefix: 'PB',
    category: '開關',
    desc: '按住時導通，放開就斷開',
    pins: twoPins('腳1', '腳2'),
    params: [{ key: 'closed', label: '按下', def: false, kind: 'bool' }],
    sch: { hw: 2, hh: 1 },
    bb: twoLead(3),
    build: (c, n) => new Switch(n[0], n[1], c.params.closed === true),
  },

  // ---- 儀表 ----
  {
    type: 'meter',
    name: '三用電錶',
    prefix: 'M',
    category: '儀表',
    desc: '電壓檔並聯、電流檔串聯；歐姆檔量電阻時電路要先斷電',
    pins: twoPins('紅棒', '黑棒'),
    params: [
      {
        key: 'mode',
        label: '檔位',
        def: 'dcv',
        kind: 'select',
        options: [
          { value: 'dcv', label: '直流電壓 DCV' },
          { value: 'acv', label: '交流電壓 ACV（有效值）' },
          { value: 'dca', label: '直流電流 DCA' },
          { value: 'aca', label: '交流電流 ACA（有效值）' },
          { value: 'ohm', label: '電阻 Ω' },
        ],
      },
    ],
    sch: { hw: 2, hh: 2 },
    bb: { kind: 'bench', w: 7, h: 5, terms: [[2, 5], [5, 5]] },
    build: (c, n) => new Meter(n[0], n[1], String(c.params.mode) as MeterMode),
  },

  // ---- 邏輯閘 ----
  gateDef('and', 'AND 及閘', '全部輸入為 1，輸出才是 1'),
  gateDef('or', 'OR 或閘', '任一輸入為 1，輸出就是 1'),
  gateDef('not', 'NOT 反閘', '輸出和輸入相反'),
  gateDef('nand', 'NAND 反及閘', 'AND 的相反，只有全部為 1 時輸出 0'),
  gateDef('nor', 'NOR 反或閘', 'OR 的相反，只有全部為 0 時輸出 1'),
  gateDef('xor', 'XOR 互斥或閘', '兩輸入不同時輸出 1'),
  gateDef('xnor', 'XNOR 互斥反或閘', '兩輸入相同時輸出 1'),

  // ---- 數位電路 ----
  {
    type: 'lin',
    name: '邏輯輸入',
    prefix: 'IN',
    category: '數位電路',
    desc: '點一下切換 0 或 1',
    pins: [{ name: '輸出', sch: [2, 0], optional: true }],
    params: [{ key: 'high', label: '輸出 1', def: false, kind: 'bool' }],
    sch: { hw: 2, hh: 1 },
    build: (c, n) => logicInput(n, c.params.high === true),
  },
  {
    type: 'lout',
    name: '邏輯輸出',
    prefix: 'OUT',
    category: '數位電路',
    desc: '顯示輸入腳目前是 0 或 1',
    pins: [{ name: '輸入', sch: [-2, 0] }],
    params: [],
    sch: { hw: 2, hh: 1 },
    build: (_c, n) => new Resistor(n[0], 0, 1e6),
  },
  {
    type: 'clock',
    name: '時脈',
    prefix: 'CLK',
    category: '數位電路',
    desc: '輸出 0～5V 的方波，驅動正反器與計數器',
    pins: [{ name: '輸出', sch: [2, 0], optional: true }],
    params: [{ key: 'freq', label: '頻率', unit: 'Hz', def: 1, kind: 'number', min: 0.1, max: 1e6 }],
    sch: { hw: 2, hh: 1 },
    build: (c, n) => new VoltageSource(n[0], 0, waves.square(2.5, num(c, 'freq'), 2.5), 25),
  },
  {
    type: 'dff',
    name: 'D 型正反器',
    prefix: 'FF',
    category: '數位電路',
    desc: '時脈正緣時，把 D 的值記到 Q',
    pins: [
      { name: 'D', sch: [-3, -1], optional: true },
      { name: 'CLK', sch: [-3, 1] },
      { name: 'Q', sch: [3, -1], optional: true },
      { name: 'Q̄', sch: [3, 1], optional: true },
    ],
    params: [],
    sch: { hw: 3, hh: 2 },
    build: (_c, n) => dFlipFlop(n),
  },
  {
    type: 'jkff',
    name: 'JK 正反器',
    prefix: 'FF',
    category: '數位電路',
    desc: 'J=K=1 時每個時脈翻轉一次，J、K 空接視為 1',
    pins: [
      { name: 'J', sch: [-3, -2], optional: true },
      { name: 'CLK', sch: [-3, 0] },
      { name: 'K', sch: [-3, 2], optional: true },
      { name: 'Q', sch: [3, -1], optional: true },
      { name: 'Q̄', sch: [3, 1], optional: true },
    ],
    params: [],
    sch: { hw: 3, hh: 3 },
    build: (_c, n) => jkFlipFlop(n),
  },
  {
    type: 'cnt4',
    name: '4 位元計數器',
    prefix: 'CNT',
    category: '數位電路',
    desc: '時脈正緣加一，數到 15 回到 0',
    pins: [
      { name: 'CLK', sch: [-3, -1] },
      { name: 'CLR', sch: [-3, 1], optional: true },
      { name: 'Q0', sch: [3, -3], optional: true },
      { name: 'Q1', sch: [3, -1], optional: true },
      { name: 'Q2', sch: [3, 1], optional: true },
      { name: 'Q3', sch: [3, 3], optional: true },
    ],
    params: [],
    sch: { hw: 3, hh: 4 },
    build: (_c, n) => counter4(n),
  },
  {
    type: 'hex7',
    name: '十六進位顯示器',
    prefix: 'DSP',
    category: '數位電路',
    desc: '把 4 位元輸入顯示成 0～F',
    pins: [
      { name: 'D0', sch: [-3, -3] },
      { name: 'D1', sch: [-3, -1] },
      { name: 'D2', sch: [-3, 1] },
      { name: 'D3', sch: [-3, 3] },
    ],
    params: [],
    sch: { hw: 3, hh: 4 },
    build: (_c, n) => hexDisplay(n),
  },

  // ---- 積體電路（麵包板用，也可放在電路圖） ----
  quadChip('ic7400', '7400 四 NAND', 'nand', 'NAND'),
  quadChip('ic7402', '7402 四 NOR', 'nor', 'NOR'),
  (() => {
    const names = Array(14).fill('NC');
    HEX_INV.forEach((u, i) => {
      names[u[0] - 1] = `${i + 1}A`;
      names[u[1] - 1] = `${i + 1}Y`;
    });
    names[13] = 'VCC';
    names[6] = 'GND';
    const def: CompDef = {
      type: 'ic7404',
      name: '7404 六反相器',
      prefix: 'U',
      category: '積體電路',
      desc: '六個 NOT 閘，要接 14 腳 VCC 與 7 腳 GND 才會動作',
      pins: dipPins(names, HEX_INV.flat()),
      params: [],
      sch: { hw: 5, hh: 7 },
      bb: { kind: 'dip', numPins: 14 },
      build: (_c, n) => gateChip('not', n, HEX_INV, 14, 7),
    };
    return def;
  })(),
  quadChip('ic7408', '7408 四 AND', 'and', 'AND'),
  quadChip('ic7432', '7432 四 OR', 'or', 'OR'),
  quadChip('ic7486', '7486 四 XOR', 'xor', 'XOR'),
  {
    type: 'ic7474',
    name: '7474 雙 D 型正反器',
    prefix: 'U',
    category: '積體電路',
    desc: '兩個正緣觸發 D 型正反器，附低態動作的 PRE、CLR',
    pins: dipPins(
      ['1CLR', '1D', '1CLK', '1PRE', '1Q', '1Q̄', 'GND', '2Q̄', '2Q', '2PRE', '2CLK', '2D', '2CLR', 'VCC'],
      [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13],
    ),
    params: [],
    sch: { hw: 5, hh: 7 },
    bb: { kind: 'dip', numPins: 14 },
    build: (_c, n) => chip7474(n),
  },
  {
    type: 'ic7493',
    name: '7493 4 位元計數器',
    prefix: 'U',
    category: '積體電路',
    desc: '負緣觸發。QA 接 CKB 才是 4 位元；R0(1)、R0(2) 要接地才會數',
    pins: dipPins(
      ['CKB', 'R0(1)', 'R0(2)', 'NC', 'VCC', 'NC', 'NC', 'QC', 'QB', 'GND', 'QD', 'QA', 'NC', 'CKA'],
      [1, 2, 3, 8, 9, 11, 12, 14],
    ),
    params: [],
    sch: { hw: 5, hh: 7 },
    bb: { kind: 'dip', numPins: 14 },
    build: (_c, n) => chip7493(n),
  },
  {
    type: 'ic7447',
    name: '7447 七段解碼器',
    prefix: 'U',
    category: '積體電路',
    desc: 'BCD 轉七段，輸出低態動作，配共陽極顯示器（每段要串電阻）',
    pins: dipPins(
      ['B', 'C', 'LT', 'BI', 'RBI', 'D', 'A', 'GND', 'e', 'd', 'c', 'b', 'a', 'g', 'f', 'VCC'],
      [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15],
    ),
    params: [],
    sch: { hw: 5, hh: 8 },
    bb: { kind: 'dip', numPins: 16 },
    build: (_c, n) => chip7447(n),
  },
  {
    type: 'ne555',
    name: 'NE555 計時器',
    prefix: 'U',
    category: '積體電路',
    desc: '常用來做振盪或定時。無穩態週期約 0.693(Ra+2Rb)C',
    pins: dipPins(['GND', 'TRIG', 'OUT', 'RESET', 'CTRL', 'THR', 'DIS', 'VCC'], [3, 4, 5, 7]),
    params: [],
    sch: { hw: 5, hh: 4 },
    bb: { kind: 'dip', numPins: 8 },
    build: (_c, n) => new Timer555(n),
  },
  {
    type: 'seg7',
    name: '七段顯示器',
    prefix: 'DS',
    category: '積體電路',
    desc: '共陽極：3、8 腳接正電，各段接低電位時亮，每段要串電阻',
    pins: dipPins(['e', 'd', '共陽', 'c', '小數點', 'b', 'a', '共陽', 'f', 'g'], [5, 8]),
    params: [{ key: 'color', label: '顏色', def: 'red', kind: 'select', options: Object.entries(LED_COLORS).map(([value, v]) => ({ value, label: v.label })) }],
    sch: { hw: 5, hh: 5 },
    bb: { kind: 'dip', numPins: 10 },
    ties: [[2, 7]],
    build: (c, n) => {
      const vf = (LED_COLORS[String(c.params.color)] ?? LED_COLORS.red).vf;
      // 依序 a b c d e f g dp
      const segPins = [6, 5, 3, 1, 0, 8, 9, 4];
      return new Composite(n, segPins.map((p) => new Led(n[2], n[p], vf)));
    },
  },
];

export const CATALOG = new Map<string, CompDef>(defs.map((d) => [d.type, d]));

export function getDef(type: string): CompDef {
  const d = CATALOG.get(type);
  if (!d) throw new Error(`未知的元件類型：${type}`);
  return d;
}

export function defaultParams(type: string): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const p of getDef(type).params) out[p.key] = p.def;
  return out;
}

/** 元件值的簡短說明，顯示在元件旁邊。 */
export function compLabel(c: Comp, fmt: (v: number, unit: string) => string): string {
  const p = c.params;
  switch (c.type) {
    case 'res':
      return fmt(Number(p.R), 'Ω');
    case 'pot':
      return `${fmt(Number(p.R), 'Ω')} ${Math.round(Number(p.pos) * 100)}%`;
    case 'cap':
      return fmt(Number(p.C), 'F');
    case 'ind':
      return fmt(Number(p.L), 'H');
    case 'lamp':
      return fmt(Number(p.R), 'Ω');
    case 'dc':
    case 'rail':
      return fmt(Number(p.V), 'V');
    case 'ac':
      return `${fmt(Number(p.amp), 'V')} ${fmt(Number(p.freq), 'Hz')}`;
    case 'isrc':
      return fmt(Number(p.I), 'A');
    case 'clock':
      return fmt(Number(p.freq), 'Hz');
    case 'zener':
      return fmt(Number(p.Vz), 'V');
    default:
      return '';
  }
}
