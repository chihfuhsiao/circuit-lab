// 進入點：組裝介面。

import './style.css';
import { App, loadAutosave } from './app';
import { EXAMPLES } from './content/examples';
import { buildChrome } from './ui/chrome';
import { h } from './ui/dom';
import { loadFromHash, saveFile } from './ui/file';
import { buildPalette } from './ui/palette';
import { buildScope } from './ui/scope';
import { buildSide } from './ui/side';
import { Panels } from './ui/split';
import { isTyping, Stage } from './ui/stage';
import { initTheme } from './ui/theme';
import { initTips } from './ui/tip';

async function start(): Promise<void> {
  initTheme();
  const fromLink = await loadFromHash();
  const saved = fromLink ?? loadAutosave();
  const first = saved ?? EXAMPLES[0].build();
  const app = new App(first);
  // 只放在麵包板上的電路，開啟時要直接看麵包板，否則畫面會是空的。
  if (first.comps.length && !first.comps.some((c) => c.sch)) app.setView('bb');
  if (fromLink) history.replaceState(null, '', location.pathname);

  const layout = h('div', { class: 'layout' });
  const panels = new Panels(layout);
  const stage = new Stage(app);
  const scope = buildScope(app, stage, panels);
  const chrome = buildChrome(app, stage, scope);
  stage.el.append(chrome.messages);

  layout.append(
    chrome.titleBar,
    chrome.toolBar,
    buildPalette(app, stage),
    panels.handle('pal', 'x', 1, 'split-pal'),
    h('div', { class: 'main' }, chrome.stageHead, stage.el, scope.el),
    panels.handle('side', 'x', -1, 'split-side'),
    buildSide(app),
    chrome.statusBar,
  );
  document.getElementById('root')!.append(layout);
  initTips();

  // 鍵盤
  window.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    const key = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && key === 'z') {
      if (e.shiftKey) app.redo();
      else app.undo();
      e.preventDefault();
      return;
    }
    if (ctrl && key === 'y') {
      app.redo();
      e.preventDefault();
      return;
    }
    if (ctrl && key === 's') {
      saveFile(app);
      e.preventDefault();
      return;
    }
    if (ctrl) return;
    if (key === 'p') {
      app.setRunning(!app.running);
      return;
    }
    if (key === 'f') {
      stage.fit();
      return;
    }
    if (key === '+' || key === '=') {
      stage.zoomBy(1.25);
      return;
    }
    if (key === '-') {
      stage.zoomBy(0.8);
      return;
    }
    if (key === 'w' && app.view === 'sch') {
      app.setTool(app.tool === 'wire' ? 'select' : 'wire');
      return;
    }
    if (stage.view.keyDown(e)) e.preventDefault();
  });

  // 開發時方便在瀏覽器主控台檢查與測試。
  if (import.meta.env.DEV) Object.assign(window, { __app: app, __stage: stage, __examples: EXAMPLES });
}

start();
