// 內建範例。座標單位是格點；兩腳元件水平時腳在 x±2，直立時（rot=1）在 y±2。

import { CircuitDoc, ViewKind } from '../circuit/types';
import { CircuitBuilder } from './builder';

export interface Example {
  id: string;
  title: string;
  group: '基本電學' | '電子學' | '數位邏輯' | '麵包板';
  desc: string;
  view: ViewKind;
  build: () => CircuitDoc;
}

const V = (b: CircuitBuilder, x: number, y: number, volts: number, ref = 'V1') => b.sch('dc', ref, x, y, { V: volts });

export const EXAMPLES: Example[] = [
  {
    id: 'led',
    title: 'LED 與限流電阻',
    group: '基本電學',
    desc: '最基本的迴路。把電阻改小，看看 LED 什麼時候會燒毀。',
    view: 'sch',
    build: () => {
      const b = new CircuitBuilder('LED 與限流電阻');
      V(b, 0, 0, 5).sch('res', 'R1', 4, -4, { R: 330 }).sch('led', 'LED1', 8, 0, {}, 1).sch('gnd', 'GND', 0, 4);
      b.w('V1.0', [0, -4], 'R1.0').w('R1.1', [8, -4], 'LED1.0').w('LED1.1', [8, 4], 'GND.0').w('V1.1', 'GND.0');
      return b.done();
    },
  },
  {
    id: 'divider',
    title: '串聯分壓',
    group: '基本電學',
    desc: '串聯時電壓依電阻比例分配。改變 R1、R2 看中點電壓。',
    view: 'sch',
    build: () => {
      const b = new CircuitBuilder('串聯分壓');
      V(b, 0, 0, 12).sch('res', 'R1', 4, -4, { R: 1000 }).sch('res', 'R2', 8, 0, { R: 2000 }, 1).sch('gnd', 'GND', 0, 4);
      b.w('V1.0', [0, -4], 'R1.0').w('R1.1', [8, -4], 'R2.0').w('R2.1', [8, 4], 'GND.0').w('V1.1', 'GND.0');
      return b.done();
    },
  },
  {
    id: 'parallel',
    title: '並聯分流',
    group: '基本電學',
    desc: '並聯時電壓相同，電流和電阻成反比。把滑鼠移到導線上看電流。',
    view: 'sch',
    build: () => {
      const b = new CircuitBuilder('並聯分流');
      V(b, 0, 0, 10).sch('res', 'R1', 5, 0, { R: 1000 }, 1).sch('res', 'R2', 10, 0, { R: 2000 }, 1).sch('gnd', 'GND', 0, 4);
      b.w('V1.0', 'R2.0').w('V1.1', 'R2.1').w('V1.1', 'GND.0');
      return b.done();
    },
  },
  {
    id: 'bridge',
    title: '惠斯登電橋',
    group: '基本電學',
    desc: '兩臂比值相同時電橋平衡，電錶讀到 0V。改變任一電阻看看失衡。',
    view: 'sch',
    build: () => {
      const b = new CircuitBuilder('惠斯登電橋');
      V(b, 0, 0, 10)
        .sch('res', 'R1', 4, -3, { R: 100 }, 1)
        .sch('res', 'R2', 4, 3, { R: 200 }, 1)
        .sch('res', 'R3', 12, -3, { R: 1000 }, 1)
        .sch('res', 'R4', 12, 3, { R: 2000 }, 1)
        .sch('meter', 'M1', 8, 0, { mode: 'dcv' })
        .sch('gnd', 'GND', 0, 7);
      b.w('V1.0', [0, -5], 'R3.0').w('V1.1', [0, 5], 'R4.1').w([0, 5], 'GND.0');
      b.w('R1.1', 'R2.0').w('R3.1', 'R4.0').w([4, 0], 'M1.0').w('M1.1', [12, 0]);
      return b.done();
    },
  },
  {
    id: 'rc',
    title: 'RC 充電',
    group: '基本電學',
    desc: '時間常數 τ = RC = 0.1 秒。合上開關看電容電壓上升，按「重設」重來。',
    view: 'sch',
    build: () => {
      const b = new CircuitBuilder('RC 充電', 0.1);
      V(b, 0, 0, 5)
        .sch('sw', 'SW1', 3, -4)
        .sch('res', 'R1', 9, -4, { R: 10000 })
        .sch('cap', 'C1', 13, 0, { C: 10e-6 }, 1)
        .sch('gnd', 'GND', 0, 4);
      b.w('V1.0', [0, -4], 'SW1.0').w('SW1.1', 'R1.0').w('R1.1', [13, -4], 'C1.0').w('C1.1', [13, 4], 'GND.0').w('V1.1', 'GND.0');
      b.probe('C1.0');
      return b.done();
    },
  },
  {
    id: 'rl',
    title: 'RL 暫態',
    group: '基本電學',
    desc: '電感的電流不能瞬間改變。時間常數 τ = L/R = 1 毫秒。',
    view: 'sch',
    build: () => {
      const b = new CircuitBuilder('RL 暫態', 0.002);
      V(b, 0, 0, 10)
        .sch('sw', 'SW1', 3, -4)
        .sch('res', 'R1', 9, -4, { R: 100 })
        .sch('ind', 'L1', 13, 0, { L: 0.1 }, 1)
        .sch('gnd', 'GND', 0, 4);
      b.w('V1.0', [0, -4], 'SW1.0').w('SW1.1', 'R1.0').w('R1.1', [13, -4], 'L1.0').w('L1.1', [13, 4], 'GND.0').w('V1.1', 'GND.0');
      b.probe('L1.0');
      return b.done();
    },
  },
  {
    id: 'rlc',
    title: 'RLC 串聯諧振',
    group: '基本電學',
    desc: '諧振頻率約 1592 Hz，此時電容電壓遠大於電源電壓。改變頻率比較看看。',
    view: 'sch',
    build: () => {
      const b = new CircuitBuilder('RLC 串聯諧振', 0.002);
      b.sch('ac', 'VS1', 0, 0, { amp: 1, freq: 1592 })
        .sch('res', 'R1', 4, -4, { R: 20 })
        .sch('ind', 'L1', 10, -4, { L: 0.01 })
        .sch('cap', 'C1', 14, 0, { C: 1e-6, polar: false }, 1)
        .sch('gnd', 'GND', 0, 4);
      b.w('VS1.0', [0, -4], 'R1.0').w('R1.1', 'L1.0').w('L1.1', [14, -4], 'C1.0').w('C1.1', [14, 4], 'GND.0').w('VS1.1', 'GND.0');
      b.probe('VS1.0').probe('C1.0');
      return b.done();
    },
  },
  {
    id: 'halfwave',
    title: '半波整流與濾波',
    group: '電子學',
    desc: '二極體只讓正半週通過，電容把輸出撫平。刪掉 C1 比較波形。',
    view: 'sch',
    build: () => {
      const b = new CircuitBuilder('半波整流與濾波', 0.02);
      b.sch('ac', 'VS1', 0, 0, { amp: 10, freq: 60 })
        .sch('diode', 'D1', 4, -4)
        .sch('cap', 'C1', 9, 0, { C: 100e-6 }, 1)
        .sch('res', 'R1', 14, 0, { R: 1000 }, 1)
        .sch('gnd', 'GND', 0, 4);
      b.w('VS1.0', [0, -4], 'D1.0').w('D1.1', [14, -4], 'R1.0').w([9, -4], 'C1.0').w('R1.1', [14, 4], 'GND.0').w('C1.1', [9, 4]).w('VS1.1', 'GND.0');
      b.probe('VS1.0').probe('R1.0');
      return b.done();
    },
  },
  {
    id: 'fullwave',
    title: '橋式全波整流',
    group: '電子學',
    desc: '四個二極體讓正負半週都朝同一方向流過負載，輸出頻率加倍。',
    view: 'sch',
    build: () => {
      const b = new CircuitBuilder('橋式全波整流', 0.02);
      b.sch('ac', 'VS1', -3, 0, { amp: 10, freq: 60 })
        .sch('diode', 'D1', 6, -4)
        .sch('diode', 'D2', 6, -1)
        .sch('diode', 'D3', 6, 2, {}, 2)
        .sch('diode', 'D4', 6, 5, {}, 2)
        .sch('res', 'R1', 13, 0, { R: 1000 }, 1)
        .sch('gnd', 'GND', 10, 7);
      b.w('VS1.0', [-3, -4], 'D1.0').w([2, -4], [2, 2], 'D3.1');
      b.w('VS1.1', [-3, 7], [3, 7], [3, 5], 'D4.1').w([3, 5], [3, -1], 'D2.0');
      b.w('D1.1', [10, -4], [10, -1], 'D2.1').w([10, -4], [13, -4], 'R1.0');
      b.w('D3.0', [10, 2], [10, 5], 'D4.0').w([10, 5], [13, 5], 'R1.1').w([10, 5], 'GND.0');
      b.probe('R1.0');
      return b.done();
    },
  },
  {
    id: 'zener',
    title: '齊納穩壓',
    group: '電子學',
    desc: '輸入電壓變動時，輸出維持在齊納電壓附近。試著把 V1 調到 9V 或 20V。',
    view: 'sch',
    build: () => {
      const b = new CircuitBuilder('齊納穩壓');
      V(b, 0, 0, 12)
        .sch('res', 'R1', 4, -4, { R: 330, Pmax: 1 })
        .sch('zener', 'ZD1', 9, 0, { Vz: 5.1 }, 3)
        .sch('res', 'RL', 14, 0, { R: 2000 }, 1)
        .sch('gnd', 'GND', 0, 4);
      b.w('V1.0', [0, -4], 'R1.0').w('R1.1', [14, -4], 'RL.0').w([9, -4], 'ZD1.1').w('RL.1', [14, 4], 'GND.0').w('ZD1.0', [9, 4]).w('V1.1', 'GND.0');
      return b.done();
    },
  },
  {
    id: 'bjtswitch',
    title: '電晶體開關',
    group: '電子學',
    desc: '基極的小電流控制集極的大電流。點開關控制 LED。',
    view: 'sch',
    build: () => {
      const b = new CircuitBuilder('電晶體開關');
      V(b, 0, 0, 5)
        .sch('sw', 'SW1', 3, -6, {}, 1)
        .sch('res', 'RB', 6, 2, { R: 4700 })
        .sch('npn', 'Q1', 10, 2)
        .sch('led', 'LED1', 11, -3, {}, 1)
        .sch('res', 'RC', 11, -8, { R: 330 }, 1)
        .sch('gnd', 'GND', 0, 6);
      b.w('V1.0', [0, -10], 'RC.0').w([3, -10], 'SW1.0').w('SW1.1', [3, 2], 'RB.0').w('RB.1', 'Q1.0');
      b.w('RC.1', 'LED1.0').w('LED1.1', 'Q1.1').w('Q1.2', [11, 6], 'GND.0').w('V1.1', 'GND.0');
      return b.done();
    },
  },
  {
    id: 'ceamp',
    title: '共射極放大器',
    group: '電子學',
    desc: '分壓偏壓的放大電路。紅色是輸入、藍色是集極輸出，輸出放大且反相。',
    view: 'sch',
    build: () => {
      const b = new CircuitBuilder('共射極放大器', 0.005);
      b.sch('rail', 'VCC1', 11, -8, { V: 12 })
        .sch('rail', 'VCC2', 6, -8, { V: 12 })
        .sch('res', 'RC', 11, -6, { R: 2200 }, 1)
        .sch('res', 'R1', 6, -6, { R: 47000 }, 1)
        .sch('res', 'R2', 6, 4, { R: 10000 }, 1)
        .sch('npn', 'Q1', 10, 0)
        .sch('res', 'RE', 11, 6, { R: 470 }, 1)
        .sch('cap', 'CE', 15, 6, { C: 10e-6 }, 1)
        .sch('cap', 'CI', 3, 0, { C: 1e-6 }, 2)
        .sch('ac', 'VS1', -2, 3, { amp: 0.02, freq: 1000 })
        .sch('gnd', 'GND1', 6, 8)
        .sch('gnd', 'GND2', 11, 10);
      b.w('RC.1', 'Q1.1').w('R1.1', [6, 0], 'Q1.0').w([6, 0], 'R2.0').w('CI.0', [6, 0]);
      b.w('Q1.2', 'RE.0').w('RE.0', [15, 4]).w('RE.1', 'GND2.0').w('CE.1', [15, 10], 'GND2.0');
      b.w('R2.1', 'GND1.0').w('VS1.0', [-2, 0], 'CI.1').w('VS1.1', [-2, 8], 'GND1.0');
      b.probe('VS1.0').probe('Q1.1');
      return b.done();
    },
  },
  {
    id: 'inverting',
    title: '反相放大器',
    group: '電子學',
    desc: '增益 = −Rf/Ri = −10。把輸入振幅調大，看輸出在電源附近削波。',
    view: 'sch',
    build: () => {
      const b = new CircuitBuilder('反相放大器', 0.002);
      b.sch('opamp', 'U1', 8, 0)
        .sch('rail', 'VP', 8, -3, { V: 12 })
        .sch('rail', 'VN', 8, 3, { V: -12 }, 2)
        .sch('res', 'Ri', 2, -1, { R: 1000 })
        .sch('res', 'Rf', 8, -6, { R: 10000 })
        .sch('res', 'RL', 14, 3, { R: 10000 }, 1)
        .sch('ac', 'VS1', -3, 2, { amp: 0.5, freq: 1000 })
        .sch('gnd', 'GND1', 4, 3)
        .sch('gnd', 'GND2', -3, 5)
        .sch('gnd', 'GND3', 14, 6);
      b.w('U1.3', 'VP.0').w('U1.4', 'VN.0');
      b.w('Ri.1', 'U1.0').w('Ri.1', [4, -6], 'Rf.0').w('Rf.1', [12, -6], [12, 0]).w('U1.2', [14, 0], 'RL.0');
      b.w('U1.1', [4, 1], 'GND1.0').w('VS1.0', [-3, -1], 'Ri.0').w('VS1.1', 'GND2.0').w('RL.1', 'GND3.0');
      b.probe('VS1.0').probe('U1.2');
      return b.done();
    },
  },
  {
    id: 'ne555',
    title: '555 閃爍器',
    group: '電子學',
    desc: '無穩態振盪，週期 ≈ 0.693(Ra+2Rb)C ≈ 0.72 秒。調整電容改變閃爍速度。',
    view: 'sch',
    build: () => {
      const b = new CircuitBuilder('555 閃爍器', 1);
      b.sch('ne555', 'U1', 8, 0)
        .sch('rail', 'VCC1', 15, -5, { V: 5 })
        .sch('rail', 'VCC2', 0, 3, { V: 5 })
        .sch('res', 'RA', 18, -3, { R: 10000 }, 1)
        .sch('res', 'RB', 18, 3, { R: 47000 }, 1)
        .sch('cap', 'C1', 18, 9, { C: 10e-6 }, 1)
        .sch('gnd', 'GND1', 18, 11)
        .sch('gnd', 'GND2', 0, -3)
        .sch('res', 'R3', -6, 1, { R: 330 })
        .sch('led', 'LED1', -10, 4, {}, 1)
        .sch('gnd', 'GND3', -10, 8);
      const pin = (n: number) => `U1.${n - 1}`;
      b.w(pin(8), [15, -3], 'VCC1.0').w('VCC1.0', [18, -5], 'RA.0');
      b.w(pin(7), [18, -1], 'RA.1').w('RA.1', 'RB.0');
      b.w(pin(6), [15, 1], [15, 5], 'RB.1').w('RB.1', 'C1.0').w('C1.1', 'GND1.0');
      b.w(pin(2), [1, -1], [1, 7], 'C1.0');
      b.w(pin(1), 'GND2.0').w(pin(4), 'VCC2.0');
      b.w(pin(3), 'R3.1').w('R3.0', [-10, 1], 'LED1.0').w('LED1.1', 'GND3.0');
      b.probe('C1.0').probe(pin(3));
      return b.done();
    },
  },
  {
    id: 'gates',
    title: '基本邏輯閘',
    group: '數位邏輯',
    desc: '點 A、B 切換 0 與 1，比較 AND、OR、XOR 的輸出。',
    view: 'sch',
    build: () => {
      const b = new CircuitBuilder('基本邏輯閘');
      b.sch('lin', 'A', 0, 0)
        .sch('lin', 'B', 0, 4)
        .sch('and', 'G1', 10, -4)
        .sch('or', 'G2', 10, 2)
        .sch('xor', 'G3', 10, 8)
        .sch('lout', 'Y1', 17, -4)
        .sch('lout', 'Y2', 17, 2)
        .sch('lout', 'Y3', 17, 8);
      b.w('A.0', [5, 0]).w([5, -5], [5, 7]).w([5, -5], 'G1.0').w([5, 1], 'G2.0').w([5, 7], 'G3.0');
      b.w('B.0', [3, 4]).w([3, -3], [3, 9]).w([3, -3], 'G1.1').w([3, 3], 'G2.1').w([3, 9], 'G3.1');
      b.w('G1.2', 'Y1.0').w('G2.2', 'Y2.0').w('G3.2', 'Y3.0');
      return b.done();
    },
  },
  {
    id: 'halfadder',
    title: '半加器',
    group: '數位邏輯',
    desc: 'XOR 產生和（S），AND 產生進位（C）。試試 1 + 1。',
    view: 'sch',
    build: () => {
      const b = new CircuitBuilder('半加器');
      b.sch('lin', 'A', 0, 0)
        .sch('lin', 'B', 0, 4)
        .sch('xor', 'G1', 10, -1)
        .sch('and', 'G2', 10, 5)
        .sch('lout', 'S', 17, -1)
        .sch('lout', 'C', 17, 5);
      b.w('A.0', [5, 0]).w([5, -2], [5, 4]).w([5, -2], 'G1.0').w([5, 4], 'G2.0');
      b.w('B.0', [3, 4]).w([3, 0], [3, 6]).w([3, 0], [7, 0]).w([3, 6], 'G2.1');
      b.w('G1.2', 'S.0').w('G2.2', 'C.0');
      return b.done();
    },
  },
  {
    id: 'srlatch',
    title: 'SR 拴鎖',
    group: '數位邏輯',
    desc: '兩個 NAND 交叉回授就能記憶。兩個輸入都是 1 時保持狀態，輸入低態動作。',
    view: 'sch',
    build: () => {
      const b = new CircuitBuilder('SR 拴鎖');
      b.sch('lin', 'S', 0, -4, { high: true })
        .sch('lin', 'R', 0, 4, { high: true })
        .sch('nand', 'G1', 10, -3)
        .sch('nand', 'G2', 10, 3)
        .sch('lout', 'Q', 18, -3)
        .sch('lout', 'Qn', 18, 3);
      b.w('S.0', 'G1.0').w('R.0', 'G2.1');
      b.w('G1.2', 'Q.0').w([14, -3], [14, 0], [5, 0], [5, 2], 'G2.0');
      b.w('G2.2', 'Qn.0').w([15, 3], [15, -1], [6, -1], [6, -2], 'G1.1');
      return b.done();
    },
  },
  {
    id: 'divider2',
    title: 'JK 正反器除頻',
    group: '數位邏輯',
    desc: '每經過一個正反器，頻率就除以 2。看示波器的三條波形。',
    view: 'sch',
    build: () => {
      const b = new CircuitBuilder('JK 正反器除頻', 1);
      b.sch('clock', 'CLK', 0, 0, { freq: 2 })
        .sch('jkff', 'FF1', 8, 0)
        .sch('jkff', 'FF2', 18, 0)
        .sch('lout', 'Q0', 16, -6)
        .sch('lout', 'Q1', 26, -1);
      b.w('CLK.0', 'FF1.1').w('FF1.3', [13, -1], [13, 0], 'FF2.1').w([13, -1], [13, -6], 'Q0.0').w('FF2.3', 'Q1.0');
      b.probe('CLK.0').probe('FF1.3').probe('FF2.3');
      return b.done();
    },
  },
  {
    id: 'counter',
    title: '計數器與七段顯示',
    group: '數位邏輯',
    desc: '時脈推動 4 位元計數器，顯示器從 0 數到 F。',
    view: 'sch',
    build: () => {
      const b = new CircuitBuilder('計數器與七段顯示', 1);
      b.sch('clock', 'CLK', 0, 0, { freq: 2 }).sch('cnt4', 'CNT1', 8, 1).sch('hex7', 'DSP1', 18, 1);
      b.w('CLK.0', 'CNT1.0');
      for (let i = 0; i < 4; i++) b.w(`CNT1.${i + 2}`, `DSP1.${i}`);
      return b.done();
    },
  },
  {
    id: 'bbled',
    title: '麵包板：LED 電路',
    group: '麵包板',
    desc: '同一個電路的電路圖與麵包板接法。切換上方的畫面比較，注意孔的導通規則。',
    view: 'bb',
    build: () => {
      const b = new CircuitBuilder('麵包板：LED 電路');
      V(b, 0, 0, 5).sch('res', 'R1', 4, -4, { R: 330 }).sch('led', 'LED1', 8, 0, {}, 1).sch('gnd', 'GND', 0, 4);
      b.w('V1.0', [0, -4], 'R1.0').w('R1.1', [8, -4], 'LED1.0').w('LED1.1', [8, 4], 'GND.0').w('V1.1', 'GND.0');
      b.place('V1', { x: 3, y: -7 });
      b.place('R1', { holes: ['a10', 'a14'] });
      b.place('LED1', { holes: ['c14', 'c16'] });
      b.j('V1.0', 'T+5', '#d3232a').j('V1.1', 'T-8', '#17171a').j('T+10', 'b10', '#d3232a').j('b16', 'T-16', '#17171a');
      return b.done();
    },
  },
  {
    id: 'bbnand',
    title: '麵包板：7400 NAND',
    group: '麵包板',
    desc: '實際的邏輯 IC 要接電源。用開關控制 1 腳，看 3 腳的 LED。',
    view: 'bb',
    build: () => {
      const b = new CircuitBuilder('麵包板：7400 NAND');
      b.bb('dc', 'V1', { x: 3, y: -7 }, { V: 5 });
      b.bb('ic7400', 'U1', { col: 15 });
      b.bb('sw', 'SW1', { holes: ['h15', 'h12'] }, { closed: true });
      b.bb('res', 'R1', { holes: ['i17', 'i23'] }, { R: 330 });
      b.bb('led', 'LED1', { holes: ['h23', 'h25'] });
      b.j('V1.0', 'T+5', '#d3232a').j('V1.1', 'T-8', '#17171a').j('T-3', 'B-3', '#17171a');
      b.j('T+15', 'a15', '#d3232a').j('g21', 'B-21', '#17171a');
      b.j('g12', 'B-11', '#17171a').j('j25', 'B-25', '#17171a');
      return b.done();
    },
  },
];
