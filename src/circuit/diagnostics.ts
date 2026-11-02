// 把電路的問題翻譯成學生聽得懂的話。

import { Led, Meter, OpAmp, VoltageSource } from '../engine/analog';
import { Chip, Composite, Timer555 } from '../engine/digital';
import { CATALOG, getDef } from './catalog';
import { Compiled, pinCurrent, pinVoltage } from './compile';
import { formatValue } from './format';
import { pinKey } from './types';

export interface Diag {
  level: 'error' | 'warn' | 'info';
  compId?: string;
  text: string;
}

const SHORT_AMPS = 10;

/** 接線本身的問題，不需要模擬結果。 */
export function staticDiagnostics(c: Compiled): Diag[] {
  const out: Diag[] = [];
  for (const comp of c.topo.comps) {
    const def = getDef(comp.type);
    def.pins.forEach((pin, i) => {
      if (pin.optional) return;
      const net = c.nets.pinNet.get(pinKey(comp.id, i));
      if (net === undefined) return;
      const others = c.nets.pins[net].length;
      const isTied = (def.ties ?? []).some((t) => t.includes(i));
      if (others <= 1 || (isTied && others <= 2 && c.nets.pins[net].every((p) => p.compId === comp.id))) {
        if (comp.type === 'gnd') return;
        out.push({ level: 'warn', compId: comp.id, text: `${comp.ref} 的「${pin.name}」還沒接上。` });
      }
    });
  }
  if (c.view === 'sch' && !c.hasGround && c.referenceComp) {
    out.push({
      level: 'info',
      compId: c.referenceComp.id,
      text: `電路圖沒有接地符號，暫時以 ${c.referenceComp.ref} 的負極當 0V。`,
    });
  }
  return out;
}

/** 需要看模擬結果才知道的問題。 */
export function liveDiagnostics(c: Compiled): Diag[] {
  const out: Diag[] = [];
  for (const comp of c.topo.comps) {
    const dev = c.devices.get(comp.id);
    if (!dev) continue;
    // 一個週期少於 20 步，波形就會明顯失真，不提醒的話學生會以為結果是對的。
    if ((comp.type === 'ac' || comp.type === 'clock') && Number(comp.params.freq) * c.sim.dt > 0.05) {
      out.push({ level: 'warn', compId: comp.id, text: `${comp.ref} 的頻率對目前的模擬速度來說太高，波形會失真。請把上方的模擬速度調慢。` });
    }
    if (dev instanceof VoltageSource && (comp.type === 'dc' || comp.type === 'ac' || comp.type === 'rail')) {
      const i = Math.abs(dev.currents[0]);
      if (i > SHORT_AMPS) {
        out.push({
          level: 'error',
          compId: comp.id,
          text: `${comp.ref} 短路了：電流高達 ${formatValue(i, 'A')}。電源的兩端之間一定要有電阻或負載。`,
        });
      }
    } else if (dev instanceof Led && dev.burned) {
      out.push({
        level: 'error',
        compId: comp.id,
        text: `${comp.ref} 燒毀了：電流超過額定。串一個夠大的限流電阻，再按「重設」換新的。`,
      });
    } else if (comp.type === 'seg7' && dev instanceof Composite && dev.parts.some((p) => (p as Led).burned)) {
      out.push({ level: 'error', compId: comp.id, text: `${comp.ref} 有燈段燒毀了：每一段都要串限流電阻，再按「重設」換新的。` });
    } else if (comp.type === 'res') {
      const v = pinVoltage(c, comp.id, 0) - pinVoltage(c, comp.id, 1);
      const i = pinCurrent(c, comp.id, 0);
      const p = Math.abs(v * i);
      const max = Number(comp.params.Pmax);
      if (p > max) {
        out.push({
          level: 'warn',
          compId: comp.id,
          text: `${comp.ref} 消耗 ${formatValue(p, 'W')}，超過額定 ${formatValue(max, 'W')}，實際電路會過熱。`,
        });
      }
    } else if (comp.type === 'cap' && comp.params.polar === true) {
      const v = pinVoltage(c, comp.id, 0) - pinVoltage(c, comp.id, 1);
      if (v < -0.5) {
        out.push({ level: 'warn', compId: comp.id, text: `${comp.ref} 是電解電容，現在正負極接反了（${formatValue(v, 'V')}），實際電路可能爆開。` });
      }
    } else if (dev instanceof OpAmp && !dev.isPowered) {
      out.push({ level: 'warn', compId: comp.id, text: `${comp.ref} 沒有電源：要把 V+、V− 接上電源才會工作。` });
    } else if (dev instanceof Chip && dev.def.vcc !== null) {
      const def = getDef(comp.type);
      const vccDip = def.pins[dev.def.vcc].dip;
      const gndDip = def.pins[dev.def.gnd!].dip;
      if (dev.burned) {
        out.push({ level: 'error', compId: comp.id, text: `${comp.ref} 燒毀了：VCC 超過額定（74 系列最高約 7V）。改接 5V 後按「重設」換新的。` });
      } else if (!dev.powered) {
        out.push({ level: 'warn', compId: comp.id, text: `${comp.ref} 沒有電源：把第 ${vccDip} 腳接 +5V、第 ${gndDip} 腳接地。` });
      }
    } else if (dev instanceof Timer555) {
      if (dev.burned) out.push({ level: 'error', compId: comp.id, text: `${comp.ref} 燒毀了：電源超過額定（555 最高約 16V）。按「重設」換新的。` });
      else if (!dev.powered) out.push({ level: 'warn', compId: comp.id, text: `${comp.ref} 沒有電源：把第 8 腳接正電、第 1 腳接地。` });
    } else if (dev instanceof Meter) {
      const i = Math.abs(dev.currents[0]);
      if ((dev.mode === 'dca' || dev.mode === 'aca') && i > 2) {
        out.push({ level: 'error', compId: comp.id, text: `${comp.ref} 在電流檔被並聯了：電流檔幾乎沒有電阻，要串聯在電路中，否則保險絲會燒斷。` });
      }
    }
  }
  if (c.sim.nonConvergedSteps > 0) {
    out.push({ level: 'warn', text: '這個電路有些瞬間算不出穩定的結果，顯示的數值可能不準。可以試著調慢模擬速度。' });
  }
  if (c.sim.numericFault) {
    out.push({ level: 'warn', text: '數值發生異常，模擬已自動略過出錯的瞬間。請檢查是否有極端的元件值。' });
  }
  return out;
}

export const typeName = (type: string) => CATALOG.get(type)?.name ?? type;
