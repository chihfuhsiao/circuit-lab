// 麵包板幾何與導通規則。座標單位是孔距。

export const BB_COLS = 63;

const ROW_Y: Record<string, number> = {
  'T+': 0,
  'T-': 1,
  a: 3,
  b: 4,
  c: 5,
  d: 6,
  e: 7,
  f: 10,
  g: 11,
  h: 12,
  i: 13,
  j: 14,
  'B+': 16,
  'B-': 17,
};

export const BB_TOP_ROWS = ['a', 'b', 'c', 'd', 'e'];
export const BB_BOTTOM_ROWS = ['f', 'g', 'h', 'i', 'j'];
export const BB_RAILS = ['T+', 'T-', 'B+', 'B-'];
export const BB_HEIGHT = 17;

export const rowY = (row: string) => ROW_Y[row];

/** 電源軌每 5 孔一組，中間留空。 */
export const railHasHole = (col: number) => col % 6 !== 0;

export function parseHole(id: string): { row: string; col: number } | null {
  const m = /^(T\+|T-|B\+|B-|[a-j])(\d+)$/.exec(id);
  if (!m) return null;
  const col = Number(m[2]);
  if (col < 1 || col > BB_COLS) return null;
  if (m[1].length === 2 && !railHasHole(col)) return null;
  return { row: m[1], col };
}

export function holePos(id: string): [number, number] | null {
  const h = parseHole(id);
  return h ? [h.col, ROW_Y[h.row]] : null;
}

/** 同一條導通金屬片的代號：同欄的 a～e 相通、f～j 相通，電源軌整排相通。 */
export function holeStrip(id: string): string | null {
  const h = parseHole(id);
  if (!h) return null;
  if (h.row.length === 2) return h.row;
  return (BB_TOP_ROWS.includes(h.row) ? 'U' : 'L') + h.col;
}

/** 與此孔導通的所有孔位，供滑鼠移過時標示。 */
export function stripHoles(strip: string): string[] {
  if (BB_RAILS.includes(strip)) {
    const out: string[] = [];
    for (let c = 1; c <= BB_COLS; c++) if (railHasHole(c)) out.push(strip + c);
    return out;
  }
  const col = strip.slice(1);
  return (strip[0] === 'U' ? BB_TOP_ROWS : BB_BOTTOM_ROWS).map((r) => r + col);
}

export function allHoles(): string[] {
  const out: string[] = [];
  for (let c = 1; c <= BB_COLS; c++) {
    for (const r of [...BB_TOP_ROWS, ...BB_BOTTOM_ROWS]) out.push(r + c);
    if (railHasHole(c)) for (const r of BB_RAILS) out.push(r + c);
  }
  return out;
}

/** 找離座標最近的孔；超過 maxDist 孔距回傳 null。 */
export function nearestHole(x: number, y: number, maxDist = 0.6): string | null {
  const col = Math.round(x);
  if (col < 1 || col > BB_COLS) return null;
  let best: string | null = null;
  let bestD = maxDist;
  for (const row of Object.keys(ROW_Y)) {
    const d = Math.hypot(col - x, ROW_Y[row] - y);
    if (d <= bestD) {
      if (row.length === 2 && !railHasHole(col)) continue;
      best = row + col;
      bestD = d;
    }
  }
  return best;
}

/** DIP 第 k 腳（1 起算）的孔位。缺口朝左，第 1 腳在左下，逆時針編號，跨在中央溝槽上。 */
export function dipHole(col: number, numPins: number, k: number): string {
  const half = numPins / 2;
  return k <= half ? `f${col + k - 1}` : `e${col + numPins - k}`;
}

export function terminalId(compId: string, pin: number): string {
  return `t:${compId}:${pin}`;
}
export function parseTerminal(id: string): { compId: string; pin: number } | null {
  const m = /^t:(.+):(\d+)$/.exec(id);
  return m ? { compId: m[1], pin: Number(m[2]) } : null;
}
