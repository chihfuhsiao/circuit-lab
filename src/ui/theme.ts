// 深色／淺色主題。預設深色；教室投影看不清楚時可以切成淺色。記在這台電腦的瀏覽器裡。

import { App } from '../app';
import { setCanvasTheme, ThemeName } from '../view/common';

const KEY = 'circuit-sim:theme';
let current: ThemeName = 'dark';

export function currentTheme(): ThemeName {
  return current;
}

function apply(t: ThemeName): void {
  current = t;
  document.documentElement.dataset.theme = t;
  setCanvasTheme(t);
}

export function initTheme(): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    // 瀏覽器不允許儲存時就用預設值。
  }
  apply(saved === 'light' ? 'light' : 'dark');
}

export function setTheme(t: ThemeName, app: App): void {
  apply(t);
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // 同上。
  }
  app.emit('theme');
}
