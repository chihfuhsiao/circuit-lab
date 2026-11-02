// 用程式描述電路的小工具，範例與實驗內容共用。

import { addBBWire, addComp, addSchWire } from '../circuit/doc';
import { normalizeWire, schPinPos } from '../circuit/topology';
import { BBPlace, CircuitDoc, Comp, newDoc, ParamValue, Point, pinKey } from '../circuit/types';
import { getDef } from '../circuit/catalog';
import { terminalId } from '../circuit/breadboard';

type Ref = string | Point;

export class CircuitBuilder {
  doc: CircuitDoc;
  private refs = new Map<string, Comp>();

  constructor(title: string, speed = 0.1) {
    this.doc = newDoc(title);
    this.doc.speed = speed;
  }

  /** 放到電路圖。rot 省略時用元件的預設方向。 */
  sch(type: string, ref: string, x: number, y: number, params?: Record<string, ParamValue>, rot?: number): this {
    const c = addComp(this.doc, type, { sch: { x, y, rot: rot ?? getDef(type).sch?.rot ?? 0 } }, params, ref);
    this.refs.set(ref, c);
    return this;
  }

  /** 只放到麵包板。 */
  bb(type: string, ref: string, place: BBPlace, params?: Record<string, ParamValue>): this {
    const c = addComp(this.doc, type, { bb: place }, params, ref);
    this.refs.set(ref, c);
    return this;
  }

  /** 把已在電路圖上的元件也放到麵包板。 */
  place(ref: string, place: BBPlace): this {
    this.comp(ref).bb = place;
    return this;
  }

  comp(ref: string): Comp {
    const c = this.refs.get(ref);
    if (!c) throw new Error(`找不到元件 ${ref}`);
    return c;
  }

  private pos(r: Ref): Point {
    if (typeof r !== 'string') return r;
    const [ref, pin] = r.split('.');
    return schPinPos(this.comp(ref), Number(pin));
  }

  /** 電路圖導線，經過指定的點，例如 w('V1.0', [0,-4], 'R1.0')。 */
  w(...refs: Ref[]): this {
    addSchWire(this.doc, normalizeWire(refs.map((r) => this.pos(r))));
    return this;
  }

  /** 麵包板跳線：孔位，或 'V1.0' 表示儀器端子。 */
  j(a: string, b: string, color?: string): this {
    addBBWire(this.doc, this.target(a), this.target(b), color);
    return this;
  }

  private target(s: string): string {
    const m = /^([A-Za-z]+\d*)\.(\d+)$/.exec(s);
    if (m && this.refs.has(m[1])) return terminalId(this.comp(m[1]).id, Number(m[2]));
    return s;
  }

  probe(r: string): this {
    const [ref, pin] = r.split('.');
    this.doc.probes.push({ compId: this.comp(ref).id, pin: Number(pin) });
    return this;
  }

  done(): CircuitDoc {
    return this.doc;
  }
}

export const key = pinKey;
