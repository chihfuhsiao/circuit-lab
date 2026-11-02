// 用課本算得出答案的電路驗證引擎。
import { describe, expect, it } from 'vitest';
import { Device, Simulator } from '../src/engine/sim';
import {
  BJT,
  Capacitor,
  CurrentSource,
  Diode,
  Inductor,
  Led,
  Meter,
  Mosfet,
  OpAmp,
  Potentiometer,
  Resistor,
  Switch,
  VoltageSource,
  waves,
} from '../src/engine/analog';
import {
  Chip,
  chip7474,
  chip7493,
  counter4,
  dFlipFlop,
  gateChip,
  gateDevice,
  jkFlipFlop,
  logicInput,
  Timer555,
} from '../src/engine/digital';

function run(sim: Simulator, seconds: number, dt: number, each?: (t: number) => void): void {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    sim.step(dt);
    each?.(sim.time);
  }
}

function sim(nodes: number, ...devices: Device[]): Simulator {
  return new Simulator(nodes, devices);
}

describe('基本電學', () => {
  it('分壓：10V 經 1k、4k，中點為 8V', () => {
    const s = sim(2, new VoltageSource(1, 0, waves.dc(10)), new Resistor(1, 2, 1e3), new Resistor(2, 0, 4e3));
    s.step(1e-5);
    expect(s.v(2)).toBeCloseTo(8, 3);
    expect(s.v(1)).toBeCloseTo(10, 3);
  });

  it('歐姆定律：電壓源供電時電流為負，大小等於 V/R', () => {
    const src = new VoltageSource(1, 0, waves.dc(12));
    const r = new Resistor(1, 0, 3e3);
    const s = sim(1, src, r);
    s.step(1e-5);
    expect(r.currents[0]).toBeCloseTo(4e-3, 6);
    expect(src.currents[0]).toBeCloseTo(-4e-3, 6);
  });

  it('惠斯登電橋平衡時兩中點等電位', () => {
    const s = sim(
      3,
      new VoltageSource(1, 0, waves.dc(10)),
      new Resistor(1, 2, 100),
      new Resistor(2, 0, 200),
      new Resistor(1, 3, 1e3),
      new Resistor(3, 0, 2e3),
    );
    s.step(1e-5);
    expect(s.v(2) - s.v(3)).toBeCloseTo(0, 4);
  });

  it('疊加定理：電壓源與電流源並存', () => {
    // 10V 經 1k 到節點 2，節點 2 經 1k 接地，再注入 1mA：V2 = 5 + 0.5 = 5.5V
    const s = sim(2, new VoltageSource(1, 0, waves.dc(10)), new Resistor(1, 2, 1e3), new Resistor(2, 0, 1e3), new CurrentSource(0, 2, 1e-3));
    s.step(1e-5);
    expect(s.v(2)).toBeCloseTo(5.5, 3);
  });

  it('RC 充電：經過一個時間常數達 63.2%', () => {
    const c = new Capacitor(2, 0, 100e-6);
    const s = sim(2, new VoltageSource(1, 0, waves.dc(10)), new Resistor(1, 2, 1e3), c);
    run(s, 0.1, 1e-4);
    expect(s.v(2)).toBeCloseTo(10 * (1 - Math.exp(-1)), 1);
    expect(Math.abs(s.v(2) - 6.321)).toBeLessThan(0.02);
    run(s, 0.9, 1e-4);
    expect(s.v(2)).toBeCloseTo(10, 2);
  });

  it('RL：經過一個時間常數電流達 63.2%', () => {
    const r = new Resistor(1, 2, 100);
    const s = sim(2, new VoltageSource(1, 0, waves.dc(10)), r, new Inductor(2, 0, 0.1));
    run(s, 1e-3, 1e-6);
    expect(Math.abs(r.currents[0] - 0.1 * (1 - Math.exp(-1)))).toBeLessThan(1e-3);
  });

  it('LC 共振頻率符合 1/(2π√LC)', () => {
    const c = new Capacitor(1, 0, 1e-6, 5);
    const s = sim(1, c, new Inductor(1, 0, 1e-3));
    const f0 = 1 / (2 * Math.PI * Math.sqrt(1e-3 * 1e-6));
    let crossings = 0;
    let last = s.v(1);
    let first = -1;
    let lastCross = -1;
    run(s, 2e-3, 1e-7, (t) => {
      const v = s.v(1);
      if (last < 0 && v >= 0) {
        if (first < 0) first = t;
        lastCross = t;
        crossings++;
      }
      last = v;
    });
    const f = (crossings - 1) / (lastCross - first);
    expect(Math.abs(f - f0) / f0).toBeLessThan(0.01);
  });

  it('RLC 串聯：諧振時電流最大、電流等於 V/R', () => {
    const L = 10e-3;
    const C = 1e-6;
    const f0 = 1 / (2 * Math.PI * Math.sqrt(L * C));
    const r = new Resistor(1, 2, 100);
    const s = sim(3, new VoltageSource(1, 0, waves.sine(1, f0)), r, new Inductor(2, 3, L), new Capacitor(3, 0, C));
    let peak = 0;
    run(s, 10e-3, 1e-6, (t) => {
      if (t > 8e-3) peak = Math.max(peak, r.currents[0]);
    });
    expect(Math.abs(peak - 0.01)).toBeLessThan(2e-4);
  });

  it('可變電阻：位置 25% 時分壓為 75%', () => {
    const s = sim(2, new VoltageSource(1, 0, waves.dc(8)), new Potentiometer(1, 0, 2, 10e3, 0.25));
    s.step(1e-5);
    expect(s.v(2)).toBeCloseTo(6, 2);
  });

  it('開關開路時沒有電流，閉合後導通', () => {
    const open = sim(2, new VoltageSource(1, 0, waves.dc(5)), new Switch(1, 2, false), new Resistor(2, 0, 1e3));
    open.step(1e-5);
    expect(open.v(2)).toBeCloseTo(0, 4);
    const closed = sim(2, new VoltageSource(1, 0, waves.dc(5)), new Switch(1, 2, true), new Resistor(2, 0, 1e3));
    closed.step(1e-5);
    expect(closed.v(2)).toBeCloseTo(5, 3);
  });
});

describe('短路與異常', () => {
  it('電源短路不會當掉，而且電流大到可以偵測', () => {
    const src = new VoltageSource(1, 0, waves.dc(5));
    const s = sim(1, src, new Switch(1, 0, true));
    s.step(1e-5);
    expect(Number.isFinite(s.v(1))).toBe(true);
    expect(Math.abs(src.currents[0])).toBeGreaterThan(100);
  });

  it('兩個電壓不同的電源並聯不會當掉', () => {
    const s = sim(1, new VoltageSource(1, 0, waves.dc(5)), new VoltageSource(1, 0, waves.dc(9)));
    s.step(1e-5);
    expect(Number.isFinite(s.v(1))).toBe(true);
    expect(s.numericFault).toBe(false);
  });

  it('懸空節點不會讓矩陣奇異', () => {
    const s = sim(3, new VoltageSource(1, 0, waves.dc(5)), new Resistor(1, 2, 1e3), new Resistor(3, 3, 1e3));
    s.step(1e-5);
    expect(s.v(2)).toBeCloseTo(5, 2);
    expect(s.numericFault).toBe(false);
  });
});

describe('電子學', () => {
  const si = { is: 2.5e-9, n: 1.75 };

  it('二極體順向壓降約 0.7V', () => {
    const s = sim(2, new VoltageSource(1, 0, waves.dc(5)), new Resistor(1, 2, 430), new Diode(2, 0, si));
    run(s, 1e-3, 1e-5);
    expect(s.v(2)).toBeGreaterThan(0.6);
    expect(s.v(2)).toBeLessThan(0.8);
    expect(s.converged).toBe(true);
  });

  it('二極體逆向截止', () => {
    const s = sim(2, new VoltageSource(1, 0, waves.dc(-5)), new Resistor(1, 2, 1e3), new Diode(2, 0, si));
    run(s, 1e-3, 1e-5);
    expect(s.v(2)).toBeCloseTo(-5, 3);
  });

  it('半波整流：只剩正半週，峰值少一個壓降', () => {
    const s = sim(2, new VoltageSource(1, 0, waves.sine(10, 60)), new Diode(1, 2, si), new Resistor(2, 0, 1e3));
    let max = 0;
    let min = 0;
    run(s, 0.05, 2e-5, () => {
      max = Math.max(max, s.v(2));
      min = Math.min(min, s.v(2));
    });
    expect(max).toBeGreaterThan(9.2);
    expect(max).toBeLessThan(9.5);
    expect(min).toBeGreaterThan(-0.01);
  });

  it('半波整流加濾波電容：漣波變小', () => {
    const s = sim(2, new VoltageSource(1, 0, waves.sine(10, 60)), new Diode(1, 2, si), new Resistor(2, 0, 1e3), new Capacitor(2, 0, 470e-6));
    let min = 99;
    run(s, 0.2, 2e-5, (t) => {
      if (t > 0.1) min = Math.min(min, s.v(2));
    });
    expect(min).toBeGreaterThan(8.8);
  });

  it('齊納穩壓：輸出維持在崩潰電壓附近', () => {
    const s = sim(2, new VoltageSource(1, 0, waves.dc(12)), new Resistor(1, 2, 330), new Diode(0, 2, { is: 1e-12, n: 1, bv: 5.1 }), new Resistor(2, 0, 2e3));
    run(s, 1e-3, 1e-5);
    expect(s.v(2)).toBeGreaterThan(5.0);
    expect(s.v(2)).toBeLessThan(5.6);
    expect(s.converged).toBe(true);
  });

  it('LED 串 330Ω 接 5V：約 9mA，壓降約 2V', () => {
    const led = new Led(2, 0, 2);
    const s = sim(2, new VoltageSource(1, 0, waves.dc(5)), new Resistor(1, 2, 330), led);
    run(s, 1e-3, 1e-5);
    expect(led.id).toBeGreaterThan(8e-3);
    expect(led.id).toBeLessThan(10e-3);
    expect(led.burned).toBe(false);
    expect(led.brightness).toBeGreaterThan(0.3);
  });

  it('LED 直接接 5V 會燒毀，之後不導通', () => {
    const led = new Led(1, 0, 2);
    const s = sim(1, new VoltageSource(1, 0, waves.dc(5)), led);
    run(s, 2e-3, 1e-5);
    expect(led.burned).toBe(true);
    expect(led.id).toBe(0);
    expect(s.numericFault).toBe(false);
  });

  it('NPN 共射極：線性區 Ic ≈ β·Ib', () => {
    const q = new BJT(3, 2, 0, 1, 100);
    const s = sim(3, new VoltageSource(1, 0, waves.dc(12)), new Resistor(1, 2, 1e3), new Resistor(1, 3, 1.13e6), q);
    run(s, 1e-3, 1e-5);
    expect(s.converged).toBe(true);
    const ib = q.currents[0];
    const ic = q.currents[1];
    expect(ib).toBeCloseTo((12 - 0.65) / 1.13e6, 6);
    expect(Math.abs(ic / ib - 100)).toBeLessThan(2);
    expect(s.v(3)).toBeGreaterThan(0.55);
    expect(s.v(3)).toBeLessThan(0.75);
  });

  it('NPN 當開關：飽和時 Vce 很小', () => {
    const q = new BJT(3, 2, 0, 1, 100);
    const s = sim(3, new VoltageSource(1, 0, waves.dc(5)), new Resistor(1, 2, 330), new Resistor(1, 3, 4.7e3), q);
    run(s, 1e-3, 1e-5);
    expect(s.v(2)).toBeLessThan(0.2);
  });

  it('PNP 極性正確', () => {
    // 射極接 +5V、基極經電阻接地、集極經電阻接地
    const q = new BJT(3, 2, 1, -1, 100);
    const s = sim(3, new VoltageSource(1, 0, waves.dc(5)), new Resistor(3, 0, 470e3), new Resistor(2, 0, 100), q);
    run(s, 1e-3, 1e-5);
    expect(s.converged).toBe(true);
    expect(s.v(3)).toBeCloseTo(5 - 0.62, 0);
    // Ib = (5-0.62)/470k ≈ 9.3µA，Ic ≈ 0.93mA，集極電流流出元件，100Ω 上約 0.09V
    expect(q.currents[1]).toBeLessThan(0);
    expect(s.v(2)).toBeCloseTo(0.093, 2);
  });

  it('NMOS：Vgs 低於臨界截止，高於臨界導通', () => {
    const on = new Mosfet(2, 3, 0, 1, 2, 0.1);
    const s1 = sim(3, new VoltageSource(1, 0, waves.dc(10)), new VoltageSource(2, 0, waves.dc(5)), new Resistor(1, 3, 1e3), on);
    run(s1, 1e-4, 1e-6);
    expect(s1.v(3)).toBeLessThan(0.5);
    const off = new Mosfet(2, 3, 0, 1, 2, 0.1);
    const s2 = sim(3, new VoltageSource(1, 0, waves.dc(10)), new VoltageSource(2, 0, waves.dc(1)), new Resistor(1, 3, 1e3), off);
    run(s2, 1e-4, 1e-6);
    expect(s2.v(3)).toBeCloseTo(10, 1);
  });

  it('PMOS：閘極拉低時導通', () => {
    const on = new Mosfet(2, 3, 1, -1, 2, 0.1);
    const s = sim(3, new VoltageSource(1, 0, waves.dc(10)), new VoltageSource(2, 0, waves.dc(0)), new Resistor(3, 0, 1e3), on);
    run(s, 1e-4, 1e-6);
    expect(s.v(3)).toBeGreaterThan(9.5);
  });

  // 節點：1 V+、2 V-、3 輸入、4 反相端、5 輸出
  function dualSupply(): Device[] {
    return [new VoltageSource(1, 0, waves.dc(15)), new VoltageSource(0, 2, waves.dc(15))];
  }

  it('反相放大器：增益 -Rf/Ri', () => {
    const s = sim(5, ...dualSupply(), new VoltageSource(3, 0, waves.dc(0.5)), new Resistor(3, 4, 1e3), new Resistor(4, 5, 10e3), new OpAmp([4, 0, 5, 1, 2]));
    run(s, 1e-4, 1e-6);
    expect(s.converged).toBe(true);
    expect(s.v(5)).toBeCloseTo(-5, 1);
  });

  it('非反相放大器：增益 1+Rf/Ri', () => {
    const s = sim(5, ...dualSupply(), new VoltageSource(3, 0, waves.dc(1)), new Resistor(4, 0, 1e3), new Resistor(4, 5, 2e3), new OpAmp([4, 3, 5, 1, 2]));
    run(s, 1e-4, 1e-6);
    expect(s.v(5)).toBeCloseTo(3, 1);
  });

  it('輸出超過電源時飽和削波', () => {
    const s = sim(5, ...dualSupply(), new VoltageSource(3, 0, waves.dc(5)), new Resistor(3, 4, 1e3), new Resistor(4, 5, 10e3), new OpAmp([4, 0, 5, 1, 2]));
    run(s, 1e-4, 1e-6);
    // 飽和在 -13.5V，再加上回授電流在 75Ω 輸出電阻上的壓降（約 0.13V）
    expect(s.v(5)).toBeGreaterThan(-13.5);
    expect(s.v(5)).toBeLessThan(-13.2);
  });

  it('反相放大弦波：輸出是放大反相的弦波且能離開飽和', () => {
    const s = sim(5, ...dualSupply(), new VoltageSource(3, 0, waves.sine(2, 1000)), new Resistor(3, 4, 1e3), new Resistor(4, 5, 10e3), new OpAmp([4, 0, 5, 1, 2]));
    let max = -99;
    let min = 99;
    let bad = 0;
    run(s, 3e-3, 1e-6, () => {
      max = Math.max(max, s.v(5));
      min = Math.min(min, s.v(5));
      if (!s.converged) bad++;
    });
    expect(max).toBeCloseTo(13.5, 0);
    expect(min).toBeCloseTo(-13.5, 0);
    expect(bad).toBe(0);
    // 回到線性區：t=3ms 時輸入為 0，輸出應接近 0
    expect(Math.abs(s.v(5))).toBeLessThan(0.5);
  });

  it('比較器：非反相端高時輸出正飽和', () => {
    const s = sim(5, ...dualSupply(), new VoltageSource(3, 0, waves.dc(1)), new VoltageSource(4, 0, waves.dc(0.5)), new OpAmp([4, 3, 5, 1, 2]));
    run(s, 1e-5, 1e-6);
    expect(s.v(5)).toBeCloseTo(13.5, 1);
  });

  it('運算放大器沒接電源時不輸出', () => {
    const s = sim(3, new VoltageSource(1, 0, waves.dc(1)), new OpAmp([0, 1, 2, 3, 3]), new Resistor(2, 0, 1e3));
    run(s, 1e-5, 1e-6);
    expect(Math.abs(s.v(2))).toBeLessThan(1e-3);
  });

  it('三用電錶：電壓檔、電流檔、歐姆檔', () => {
    const vm = new Meter(2, 0, 'dcv');
    const s1 = sim(2, new VoltageSource(1, 0, waves.dc(10)), new Resistor(1, 2, 1e3), new Resistor(2, 0, 1e3), vm);
    run(s1, 1e-3, 1e-5);
    expect(vm.reading).toBeCloseTo(5, 2);

    const am = new Meter(2, 0, 'dca');
    const s2 = sim(2, new VoltageSource(1, 0, waves.dc(10)), new Resistor(1, 2, 1e3), am);
    run(s2, 1e-3, 1e-5);
    expect(am.reading).toBeCloseTo(0.01, 4);

    const om = new Meter(1, 0, 'ohm');
    const s3 = sim(1, new Resistor(1, 0, 4.7e3), om);
    run(s3, 1e-3, 1e-5);
    expect(Math.abs(om.reading - 4.7e3)).toBeLessThan(5);

    const open = new Meter(1, 0, 'ohm');
    const s4 = sim(1, open);
    run(s4, 1e-3, 1e-5);
    expect(open.reading).toBe(Infinity);
  });

  it('三用電錶交流檔：振幅 10V 的弦波讀到約 7.07V', () => {
    const m = new Meter(1, 0, 'acv');
    const s = sim(1, new VoltageSource(1, 0, waves.sine(10, 1000)), m);
    run(s, 0.1, 2e-6);
    expect(Math.abs(m.reading - 7.07)).toBeLessThan(0.1);
  });
});

// 史密特振盪器節點：1 V+、2 V-、3 輸出、4 反相端、5 非反相端
class OpAmpAstable extends OpAmp {
  constructor() {
    super([4, 5, 3, 1, 2]);
  }
}

describe('史密特振盪', () => {
  it('週期符合 2RC·ln((1+β)/(1-β))，β=0.5', () => {
    const R = 10e3;
    const C = 100e-9;
    const s = sim(
      5,
      new VoltageSource(1, 0, waves.dc(15)),
      new VoltageSource(0, 2, waves.dc(15)),
      new Resistor(3, 4, R),
      new Capacitor(4, 0, C),
      new Resistor(3, 5, 10e3),
      new Resistor(5, 0, 10e3),
      new OpAmpAstable(),
    );
    let lastCross = -1;
    let periods: number[] = [];
    let last = s.v(3);
    run(s, 40e-3, 2e-6, (t) => {
      const v = s.v(3);
      if (last < 0 && v > 0) {
        if (lastCross > 0) periods.push(t - lastCross);
        lastCross = t;
      }
      last = v;
    });
    expect(periods.length).toBeGreaterThan(3);
    const T = 2 * R * C * Math.log(3);
    const measured = periods[periods.length - 1];
    expect(Math.abs(measured - T) / T).toBeLessThan(0.03);
  });
});

describe('數位邏輯', () => {
  function truth(kind: Parameters<typeof gateDevice>[0], expected: boolean[]) {
    const combos = [
      [false, false],
      [false, true],
      [true, false],
      [true, true],
    ];
    combos.forEach(([a, b], i) => {
      const g = gateDevice(kind, [1, 2, 3]);
      const s = sim(3, logicInput([1], a), logicInput([2], b), g, new Resistor(3, 0, 1e6));
      run(s, 1e-4, 1e-5);
      expect(s.v(3) > 2.5).toBe(expected[i]);
    });
  }

  it('AND 真值表', () => truth('and', [false, false, false, true]));
  it('OR 真值表', () => truth('or', [false, true, true, true]));
  it('NAND 真值表', () => truth('nand', [true, true, true, false]));
  it('NOR 真值表', () => truth('nor', [true, false, false, false]));
  it('XOR 真值表', () => truth('xor', [false, true, true, false]));
  it('XNOR 真值表', () => truth('xnor', [true, false, false, true]));

  it('NOT 閘反相', () => {
    const s = sim(2, logicInput([1], true), gateDevice('not', [1, 2]), new Resistor(2, 0, 1e6));
    run(s, 1e-4, 1e-5);
    expect(s.v(2)).toBeLessThan(0.5);
  });

  it('輸入空接視為高電位（TTL 行為）', () => {
    const s = sim(2, gateDevice('not', [1, 2]), new Resistor(2, 0, 1e6));
    run(s, 1e-4, 1e-5);
    expect(s.v(2)).toBeLessThan(0.5);
  });

  it('NAND SR 拴鎖：記憶上一次的狀態', () => {
    const build = (sBar: boolean, rBar: boolean, prevState?: unknown[]) => {
      const n1 = gateDevice('nand', [1, 4, 3]);
      const n2 = gateDevice('nand', [2, 3, 4]);
      if (prevState) {
        n1.loadState(prevState[0]);
        n2.loadState(prevState[1]);
      }
      const s = sim(4, logicInput([1], sBar), logicInput([2], rBar), n1, n2);
      run(s, 2e-4, 1e-5);
      return { s, state: [n1.saveState(), n2.saveState()] };
    };
    const set = build(false, true);
    expect(set.s.v(3)).toBeGreaterThan(3);
    const hold = build(true, true, set.state);
    expect(hold.s.v(3)).toBeGreaterThan(3);
    const reset = build(true, false, hold.state);
    expect(reset.s.v(3)).toBeLessThan(0.5);
    const hold2 = build(true, true, reset.state);
    expect(hold2.s.v(3)).toBeLessThan(0.5);
  });

  it('NAND SR 拴鎖剛啟動時會落入穩定狀態，Q 與 Q̄ 相反', () => {
    const s = sim(4, logicInput([1], true), logicInput([2], true), gateDevice('nand', [1, 4, 3]), gateDevice('nand', [2, 3, 4]));
    run(s, 1e-3, 1e-5);
    const q = s.v(3) > 2.5;
    const qn = s.v(4) > 2.5;
    expect(q).not.toBe(qn);
    run(s, 1e-3, 1e-5);
    expect(s.v(3) > 2.5).toBe(q);
  });

  it('環形振盪器（三個反相器）會振盪', () => {
    const s = sim(3, gateDevice('not', [1, 2]), gateDevice('not', [2, 3]), gateDevice('not', [3, 1]));
    let changes = 0;
    let last = s.v(1) > 2.5;
    run(s, 1e-3, 1e-6, () => {
      const now = s.v(1) > 2.5;
      if (now !== last) changes++;
      last = now;
    });
    expect(changes).toBeGreaterThan(10);
    expect(s.numericFault).toBe(false);
  });

  it('D 型正反器在正緣取樣', () => {
    const q = dFlipFlop([1, 2, 3, 4]);
    const s = sim(4, logicInput([1], true), new VoltageSource(2, 0, waves.square(2.5, 1000, 2.5)), q);
    run(s, 0.4e-3, 1e-6);
    // 第一個半週 CLK 為高：開始時的正緣之後 Q = 1
    run(s, 1.2e-3, 1e-6);
    expect(s.v(3)).toBeGreaterThan(3);
    expect(s.v(4)).toBeLessThan(0.5);
  });

  it('JK 正反器 J=K=1 時每個時脈翻轉（除以 2）', () => {
    const q = jkFlipFlop([1, 2, 3, 4, 5]);
    const s = sim(5, new VoltageSource(2, 0, waves.square(2.5, 1000, 2.5)), q);
    let edges = 0;
    let last = s.v(4) > 2.5;
    run(s, 10e-3, 2e-6, () => {
      const now = s.v(4) > 2.5;
      if (now && !last) edges++;
      last = now;
    });
    expect(edges).toBeGreaterThanOrEqual(4);
    expect(edges).toBeLessThanOrEqual(6);
  });

  it('4 位元計數器每個時脈加一，溢位回到 0', () => {
    const c = counter4([1, 2, 3, 4, 5, 6]);
    const s = sim(6, new VoltageSource(1, 0, waves.square(2.5, 1000, 2.5)), c);
    run(s, 3.5e-3, 2e-6);
    expect((c.state as { n: number }).n).toBeGreaterThanOrEqual(3);
    run(s, 16e-3, 2e-6);
    expect((c.state as { n: number }).n).toBeLessThan(16);
  });

  it('7400 要接 VCC 才會動作', () => {
    // 腳號 1..14 對應節點；3 號腳接負載
    const nodesPowered = [1, 2, 3, 4, 5, 6, 0, 8, 9, 10, 11, 12, 13, 14];
    const chip = gateChip('nand', nodesPowered, [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]], 14, 7);
    const s = sim(14, new VoltageSource(14, 0, waves.dc(5)), new Resistor(1, 0, 100), chip, new Resistor(3, 0, 1e4));
    run(s, 1e-4, 1e-5);
    expect(s.v(3)).toBeGreaterThan(3);

    const nodesOff = [1, 2, 3, 4, 5, 6, 0, 8, 9, 10, 11, 12, 13, 14];
    const chipOff = gateChip('nand', nodesOff, [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]], 14, 7);
    const s2 = sim(14, new Resistor(1, 0, 100), chipOff, new Resistor(3, 0, 1e4));
    run(s2, 1e-4, 1e-5);
    expect(chipOff.powered).toBe(false);
    expect(s2.v(3)).toBeLessThan(0.5);
  });

  it('74 系列 VCC 超過額定會燒毀', () => {
    const nodes = [1, 2, 3, 4, 5, 6, 0, 8, 9, 10, 11, 12, 13, 14];
    const chip = gateChip('nand', nodes, [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]], 14, 7);
    const s = sim(14, new VoltageSource(14, 0, waves.dc(12)), chip);
    run(s, 1e-4, 1e-5);
    expect(chip.burned).toBe(true);
  });

  it('7474 正緣觸發，CLR 優先', () => {
    const nodes = [1, 2, 3, 4, 5, 6, 0, 8, 9, 10, 11, 12, 13, 14];
    const chip: Chip = chip7474(nodes);
    const s = sim(14, new VoltageSource(14, 0, waves.dc(5)), new VoltageSource(3, 0, waves.square(2.5, 1000, 2.5)), chip);
    run(s, 3.2e-3, 2e-6);
    expect(s.v(5)).toBeGreaterThan(3); // D 空接為 1，正緣後 Q=1
  });

  it('7493 接成 4 位元計數', () => {
    const nodes = [1, 2, 0, 4, 15, 6, 7, 8, 9, 0, 11, 12, 13, 14];
    // QA(12) 接 CKB(1)，R01(2) 接地
    nodes[0] = 12;
    nodes[1] = 0;
    const chip = chip7493(nodes);
    const s = sim(15, new VoltageSource(15, 0, waves.dc(5)), new VoltageSource(14, 0, waves.square(2.5, 1000, 2.5)), chip);
    run(s, 5.5e-3, 2e-6);
    const st = chip.state as { a: number; b: number };
    const count = st.a + st.b * 2;
    expect(count).toBeGreaterThanOrEqual(4);
    expect(count).toBeLessThanOrEqual(6);
  });

  it('555 無穩態：週期 0.693(Ra+2Rb)C', () => {
    // 腳 1 GND(0) 2 TRIG(2) 3 OUT(3) 4 RESET(1) 5 CTRL(5) 6 THR(2) 7 DIS(7) 8 VCC(1)
    const Ra = 1e3;
    const Rb = 10e3;
    const C = 1e-6;
    const t = new Timer555([0, 2, 3, 1, 5, 2, 7, 1]);
    const s = sim(7, new VoltageSource(1, 0, waves.dc(5)), new Resistor(1, 7, Ra), new Resistor(7, 2, Rb), new Capacitor(2, 0, C), t, new Capacitor(5, 0, 1e-8), new Resistor(3, 0, 1e4));
    let last = false;
    const rises: number[] = [];
    run(s, 0.1, 5e-6, (time) => {
      const now = s.v(3) > 2.5;
      if (now && !last) rises.push(time);
      last = now;
    });
    expect(rises.length).toBeGreaterThan(3);
    const T = rises[rises.length - 1] - rises[rises.length - 2];
    const expected = 0.693 * (Ra + 2 * Rb) * C;
    expect(Math.abs(T - expected) / expected).toBeLessThan(0.03);
  });
});

describe('效能', () => {
  it('線性電路重複步進會沿用 LU 分解', () => {
    const devs: Device[] = [new VoltageSource(1, 0, waves.dc(5))];
    for (let i = 1; i < 40; i++) devs.push(new Resistor(i, i + 1, 100));
    devs.push(new Resistor(40, 0, 100));
    const s = new Simulator(40, devs);
    const t0 = performance.now();
    run(s, 0.01, 1e-5);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(s.v(40)).toBeCloseTo(5 / 40, 2);
  });
});
