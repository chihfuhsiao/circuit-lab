// 介面圖示：16×16 的線條圖，全部內嵌，不依賴外部字型或圖庫。

const PATHS = {
  logo: '<path d="M1.5 8h2.2l1.1-3 2 6 2-6 2 6 1.1-3h2.6"/>',
  newFile: '<path d="M3.75 1.75h5.5l3 3v9.5h-8.5z"/><path d="M9 1.75v3.25h3.25"/><path d="M8 7.5v4M6 9.5h4"/>',
  open: '<path d="M1.75 12.75v-9.5h4l1.5 1.75h6v2"/><path d="M1.75 12.75 3.75 7h10.5l-2 5.75z"/>',
  save: '<path d="M2.25 2.25h9l2.5 2.5v9h-11.5z"/><path d="M5 2.25v3.25h5V2.25"/><path d="M4.5 13.75V9h7v4.75"/>',
  share: '<circle cx="12" cy="3.5" r="1.75"/><circle cx="12" cy="12.5" r="1.75"/><circle cx="4" cy="8" r="1.75"/><path d="M5.6 7.1 10.4 4.4M5.6 8.9l4.8 2.7"/>',
  undo: '<path d="M5.5 3 2.5 6l3 3"/><path d="M2.75 6H9.5a3.75 3.75 0 0 1 0 7.5H6"/>',
  redo: '<path d="m10.5 3 3 3-3 3"/><path d="M13.25 6H6.5a3.75 3.75 0 0 0 0 7.5H10"/>',
  cursor: '<path d="M3.25 2.25 12.75 7l-4 1.25L7 12.5z"/><path d="m9 9 3 3.5"/>',
  wire: '<circle cx="3" cy="12.75" r="1.5"/><circle cx="13" cy="3.25" r="1.5"/><path d="M4.5 12.75H8v-9.5h3.5"/>',
  probe: '<path d="m9.5 2 4.5 4.5-5.5 5.5L4 7.5z"/><path d="M4 7.5 2 14l6.5-2"/><path d="m2 14 2.5-2.5"/>',
  rotate: '<path d="M13.25 8a5.25 5.25 0 1 1-1.6-3.8"/><path d="M13.5 1.75v3h-3"/>',
  trash: '<path d="M2.75 4.25h10.5"/><path d="M6 4.25v-2h4v2"/><path d="m4 4.25.75 9.5h6.5l.75-9.5"/><path d="M6.75 7v4M9.25 7v4"/>',
  zoomIn: '<circle cx="7" cy="7" r="4.75"/><path d="m10.5 10.5 3.75 3.75M7 5v4M5 7h4"/>',
  zoomOut: '<circle cx="7" cy="7" r="4.75"/><path d="m10.5 10.5 3.75 3.75M5 7h4"/>',
  fit: '<path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5"/><rect x="5.25" y="5.25" width="5.5" height="5.5" rx="0.5"/>',
  volts: '<path d="M2 8.5V3.25a1 1 0 0 1 1-1h5.25L14 8l-6 6z"/><circle cx="5" cy="5.25" r="0.75"/>',
  compare: '<path d="M3 4h3M3 8h3M3 12h3"/><path d="m8.5 4 1.25 1.25L12.5 2.5M8.5 8l1.25 1.25L12.5 6.5M8.5 12l1.25 1.25L12.5 10.5"/>',
  play: '<path d="M4.5 2.5 13 8l-8.5 5.5z" fill="currentColor"/>',
  pause: '<rect x="3.75" y="2.75" width="3" height="10.5" rx="0.6" fill="currentColor" stroke="none"/><rect x="9.25" y="2.75" width="3" height="10.5" rx="0.6" fill="currentColor" stroke="none"/>',
  step: '<path d="M3 3 10 8l-7 5z"/><path d="M12.75 3v10"/>',
  reset: '<path d="M2.75 8a5.25 5.25 0 1 0 1.6-3.8"/><path d="M2.5 1.75v3h3"/><rect x="6.5" y="6.5" width="3" height="3" rx="0.4" fill="currentColor" stroke="none"/>',
  chevDown: '<path d="m4 6 4 4 4-4"/>',
  chevRight: '<path d="m6 4 4 4-4 4"/>',
  chevUp: '<path d="m4 10 4-4 4 4"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/>',
  help: '<circle cx="8" cy="8" r="6.25"/><path d="M6.1 6.2a1.95 1.95 0 1 1 2.9 1.7c-.65.4-1 .8-1 1.6"/><circle cx="8" cy="11.6" r="0.4" fill="currentColor"/>',
  sun: '<circle cx="8" cy="8" r="3"/><path d="M8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/>',
  moon: '<path d="M13.5 9.75A6 6 0 0 1 6.25 2.5a6 6 0 1 0 7.25 7.25z"/>',
  schematic: '<path d="M1 8h2.5l1.2-3 2 6 2-6 2 6 1.05-3H15"/>',
  board: '<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1"/><path d="M1.75 8h12.5"/><path d="M4.5 5.25h.01M8 5.25h.01M11.5 5.25h.01M4.5 10.75h.01M8 10.75h.01M11.5 10.75h.01" stroke-width="1.8"/>',
  sliders: '<path d="M2 4.5h6.5M12 4.5h2M2 11.5h2M7.5 11.5H14"/><circle cx="10.25" cy="4.5" r="1.75"/><circle cx="5.75" cy="11.5" r="1.75"/>',
  book: '<path d="M8 3.5C6.75 2.5 4.5 2.25 2 2.5v10c2.5-.25 4.75 0 6 1 1.25-1 3.5-1.25 6-1v-10c-2.5-.25-4.75 0-6 1z"/><path d="M8 3.5v10"/>',
  flask: '<path d="M6 1.75h4M6.75 1.75V6L2.9 12.5a1.15 1.15 0 0 0 1 1.75h8.2a1.15 1.15 0 0 0 1-1.75L9.25 6V1.75"/><path d="M4.75 9.75h6.5"/>',
  close: '<path d="m4 4 8 8M12 4l-8 8"/>',
  warn: '<path d="M8 2.25 14.5 13.5h-13z"/><path d="M8 6.5v3.25"/><circle cx="8" cy="11.6" r="0.35" fill="currentColor"/>',
  error: '<circle cx="8" cy="8" r="6.25"/><path d="m5.75 5.75 4.5 4.5M10.25 5.75l-4.5 4.5"/>',
  info: '<circle cx="8" cy="8" r="6.25"/><path d="M8 7.25v4"/><circle cx="8" cy="4.9" r="0.35" fill="currentColor"/>',
  check: '<path d="m3 8.5 3.25 3.25L13 5"/>',
  wave: '<path d="M1.5 8c1.1-5.5 2.2-5.5 3.25 0s2.2 5.5 3.25 0 2.2-5.5 3.25 0 2.2 5.5 3.25 0"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  arrowLeft: '<path d="M6.5 3.5 2 8l4.5 4.5"/><path d="M2.25 8H14"/>',
  speed: '<path d="M2.25 11.5a6.25 6.25 0 1 1 11.5 0"/><path d="m8 9 3-3.25"/><circle cx="8" cy="9.25" r="0.9" fill="currentColor"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function iconSvg(name: IconName, size = 16): string {
  return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}

export function icon(name: IconName, size = 16): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'ico';
  el.innerHTML = iconSvg(name, size);
  return el;
}
