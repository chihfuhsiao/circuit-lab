// 工程記號的解析與顯示、電阻色碼。

const PREFIX: Record<string, number> = {
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  µ: 1e-6,
  μ: 1e-6,
  m: 1e-3,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
};

/** 解析 "4.7k"、"100n"、"10u"、"2M2" 這類輸入；無法解析時回傳 null。 */
export function parseValue(text: string): number | null {
  const t = text.trim().replace(/[Ωω歐姆VvAaFfHhWwzZ秒s]+$/u, '').trim();
  if (t === '') return null;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(meg|MEG|[pnuµμmkKMG])?(\d*)$/u.exec(t);
  if (!m) return null;
  let num = m[1];
  if (m[3]) {
    if (!m[2]) return null;
    num = `${m[1]}.${m[3]}`; // 2k2 = 2.2k
  }
  const scale = m[2] ? (m[2].toLowerCase() === 'meg' ? 1e6 : PREFIX[m[2]]) : 1;
  const v = Number(num) * scale;
  return Number.isFinite(v) ? v : null;
}

const STEPS: [number, string][] = [
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
];

/** 例如 formatValue(4700,'Ω') = "4.7 kΩ"。 */
export function formatValue(v: number, unit = '', digits = 3): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '—';
  if (v === 0) return `0 ${unit}`.trim();
  const a = Math.abs(v);
  for (const [scale, prefix] of STEPS) {
    if (a >= scale * 0.9995) {
      const n = v / scale;
      return `${trimNumber(n, digits)} ${prefix}${unit}`.trim();
    }
  }
  return `${v.toExponential(1)} ${unit}`.trim();
}

function trimNumber(n: number, digits: number): string {
  const s = n.toPrecision(digits);
  return s.includes('e') ? String(Number(s)) : s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** 輸入框內顯示的短格式，例如 4700 → "4.7k"。 */
export function formatInput(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  for (const [scale, prefix] of STEPS) {
    if (a >= scale * 0.9995) return `${trimNumber(v / scale, 4)}${prefix}`;
  }
  return String(v);
}

const BAND_COLORS = ['#111111', '#7a4a21', '#d3232a', '#ee7f1a', '#f2d21b', '#2c9b3f', '#2360c9', '#7a3fb0', '#8c8c8c', '#f5f5f5'];
export const BAND_NAMES = ['黑', '棕', '紅', '橙', '黃', '綠', '藍', '紫', '灰', '白'];
const GOLD = '#c9a227';
const SILVER = '#b8b8b8';

export interface ColorBand {
  color: string;
  name: string;
}

/** 四環電阻色碼（第四環固定金色 5%）。 */
export function resistorBands(r: number): ColorBand[] {
  const fallback = [0, 0, 0].map((d) => ({ color: BAND_COLORS[d], name: BAND_NAMES[d] }));
  if (!(r > 0)) return [...fallback, { color: GOLD, name: '金' }];
  let exp = Math.floor(Math.log10(r)) - 1;
  let sig = Math.round(r / 10 ** exp);
  if (sig >= 100) {
    sig = Math.round(sig / 10);
    exp++;
  }
  const d1 = Math.floor(sig / 10);
  const d2 = sig % 10;
  const bands: ColorBand[] = [
    { color: BAND_COLORS[d1], name: BAND_NAMES[d1] },
    { color: BAND_COLORS[d2], name: BAND_NAMES[d2] },
  ];
  if (exp >= 0 && exp <= 9) bands.push({ color: BAND_COLORS[exp], name: BAND_NAMES[exp] });
  else if (exp === -1) bands.push({ color: GOLD, name: '金' });
  else bands.push({ color: SILVER, name: '銀' });
  bands.push({ color: GOLD, name: '金' });
  return bands;
}
