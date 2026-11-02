// 視窗外框：標題列與功能表、工具列、畫面分頁、提醒、狀態列。

import { App, Tool } from '../app';
import { newDoc, ViewKind } from '../circuit/types';
import { showAbout, showCompare, showHelp } from './dialogs';
import { h } from './dom';
import { openFile, saveFile, shareLink } from './file';
import { icon, IconName } from './icons';
import { buildMenuBar, MenuDef } from './menu';
import { ScopeApi } from './scope';
import { confirmReplace } from './side';
import { Stage } from './stage';
import { currentTheme, setTheme } from './theme';

const SPEEDS: [string, number][] = [
  ['真實速度（1 秒/秒）', 1],
  ['100 ms/秒', 0.1],
  ['20 ms/秒', 0.02],
  ['5 ms/秒', 0.005],
  ['2 ms/秒', 0.002],
  ['500 µs/秒', 5e-4],
  ['100 µs/秒', 1e-4],
  ['10 µs/秒', 1e-5],
];

function formatTime(t: number): string {
  if (t >= 1) return `${t.toFixed(2)} s`;
  if (t >= 1e-3) return `${(t * 1e3).toFixed(1)} ms`;
  return `${(t * 1e6).toFixed(0)} µs`;
}

function toolButton(name: IconName, label: string | null, tip: string, key: string | undefined, onclick: () => void): HTMLButtonElement {
  return h(
    'button',
    { class: label ? 'tb tb-label' : 'tb', 'data-tip': tip, 'data-key': key, 'aria-label': label ?? tip, onclick },
    icon(name),
    label ? h('span', {}, label) : '',
  );
}

export interface Chrome {
  titleBar: HTMLElement;
  toolBar: HTMLElement;
  stageHead: HTMLElement;
  statusBar: HTMLElement;
  messages: HTMLElement;
}

export function buildChrome(app: App, stage: Stage, scope: ScopeApi): Chrome {
  const key = (k: string) => () => stage.view.keyDown(new KeyboardEvent('keydown', { key: k }));
  const act = {
    newDoc: () => confirmReplace(app, () => app.loadDoc(newDoc(), app.view)),
    open: () => openFile(app),
    save: () => saveFile(app),
    share: () => shareLink(app),
    rotate: key('r'),
    del: key('Delete'),
    tool: (t: Tool) => app.setTool(app.tool === t ? 'select' : t),
    run: () => app.setRunning(!app.running),
    volts: () => {
      app.showVolts = !app.showVolts;
      refresh();
    },
    compare: () => showCompare(app),
    fit: () => stage.fit(),
    theme: (t: 'dark' | 'light') => setTheme(t, app),
  };

  // ---- 標題列 ----

  const menus: MenuDef[] = [
    {
      label: '檔案',
      items: [
        { label: '新增電路', icon: 'newFile', action: act.newDoc },
        { label: '開啟電路檔…', icon: 'open', action: act.open },
        'sep',
        { label: '存檔', icon: 'save', key: 'Ctrl+S', action: act.save },
        { label: '分享連結', icon: 'share', action: act.share },
      ],
    },
    {
      label: '編輯',
      items: [
        { label: '復原', icon: 'undo', key: 'Ctrl+Z', action: () => app.undo(), enabled: () => app.canUndo },
        { label: '重做', icon: 'redo', key: 'Ctrl+Y', action: () => app.redo(), enabled: () => app.canRedo },
        'sep',
        { label: '旋轉', icon: 'rotate', key: 'R', action: act.rotate, enabled: () => app.selection.size > 0 },
        { label: '刪除', icon: 'trash', key: 'Delete', action: act.del, enabled: () => app.selection.size > 0 },
        'sep',
        { label: '選取工具', icon: 'cursor', action: () => app.setTool('select'), checked: () => app.tool === 'select' },
        { label: '接線工具', icon: 'wire', key: 'W', action: () => act.tool('wire'), enabled: () => app.view === 'sch', checked: () => app.tool === 'wire' },
        { label: '示波器探棒', icon: 'probe', action: () => act.tool('probe'), checked: () => app.tool === 'probe' },
      ],
    },
    {
      label: '檢視',
      items: [
        { label: '電路圖', action: () => app.setView('sch'), checked: () => app.view === 'sch' },
        { label: '麵包板', action: () => app.setView('bb'), checked: () => app.view === 'bb' },
        'sep',
        { label: '放大', icon: 'zoomIn', key: '+', action: () => stage.zoomBy(1.25) },
        { label: '縮小', icon: 'zoomOut', key: '-', action: () => stage.zoomBy(0.8) },
        { label: '全部顯示', icon: 'fit', key: 'F', action: act.fit },
        'sep',
        { label: '節點電壓', action: act.volts, enabled: () => app.view === 'sch', checked: () => app.showVolts },
        { label: '示波器面板', action: () => scope.toggle(), checked: () => scope.isOpen() },
        'sep',
        { label: '深色主題', action: () => act.theme('dark'), checked: () => currentTheme() === 'dark' },
        { label: '淺色主題（投影用）', action: () => act.theme('light'), checked: () => currentTheme() === 'light' },
      ],
    },
    {
      label: '模擬',
      items: [
        { label: '執行／暫停', icon: 'play', key: 'P', action: act.run },
        { label: '單步', icon: 'step', action: () => app.stepOnce(), enabled: () => !app.running },
        { label: '重設', icon: 'reset', action: () => app.reset() },
        'sep',
        { label: '對照電路圖', icon: 'compare', action: act.compare },
      ],
    },
    {
      label: '說明',
      items: [
        { label: '使用說明', icon: 'help', action: showHelp },
        { label: '關於電路實驗室', icon: 'info', action: showAbout },
      ],
    },
  ];

  const title = h('input', {
    class: 'doc-title',
    value: app.doc.title,
    'aria-label': '電路名稱',
    'data-tip': '點一下可以改電路名稱',
    onchange: (e: Event) => {
      app.doc.title = (e.target as HTMLInputElement).value.trim() || '未命名電路';
      app.commit();
    },
  });
  const dirty = h('span', { class: 'doc-state', 'data-tip': '瀏覽器會自動暫存；要傳給別人請按「存檔」' });
  const themeBtn = h('button', {
    class: 'tb',
    'aria-label': '切換深色與淺色主題',
    'data-tip': '切換深色與淺色主題',
    onclick: () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark', app),
  });

  const titleBar = h(
    'header',
    { class: 'titlebar' },
    h('div', { class: 'brand' }, h('span', { class: 'logo' }, icon('logo', 14)), h('span', { class: 'brand-name' }, '電路實驗室')),
    buildMenuBar(menus),
    h('div', { class: 'doc' }, title, dirty),
    h('div', { class: 'title-right' }, themeBtn, toolButton('help', null, '使用說明', undefined, showHelp)),
  );

  // ---- 工具列 ----

  const undo = toolButton('undo', null, '復原', 'Ctrl+Z', () => app.undo());
  const redo = toolButton('redo', null, '重做', 'Ctrl+Y', () => app.redo());
  const rotate = toolButton('rotate', null, '旋轉選取的元件', 'R', act.rotate);
  const del = toolButton('trash', null, '刪除選取的項目', 'Delete', act.del);
  const selectTool = toolButton('cursor', '選取', '選取與拖曳元件', undefined, () => app.setTool('select'));
  const wireTool = toolButton('wire', '接線', '接線工具：從任何位置開始拉線（電路圖）', 'W', () => act.tool('wire'));
  const probeTool = toolButton('probe', '探棒', '點電路上的節點，加到示波器', undefined, () => act.tool('probe'));

  const run = h('button', { class: 'tb tb-run', 'data-tip': '執行或暫停模擬', 'data-key': 'P', onclick: act.run });
  const step = toolButton('step', null, '暫停時前進一小段', undefined, () => app.stepOnce());
  const reset = toolButton('reset', null, '回到 0 秒：電容放電、燒毀的元件換新', undefined, () => app.reset());
  const speed = h(
    'select',
    {
      class: 'select speed',
      'aria-label': '模擬速度',
      'data-tip': '每過 1 秒真實時間，電路經過多少時間。交流或高頻電路要調慢才看得清楚。',
      onchange: (e: Event) => app.setSpeed(Number((e.target as HTMLSelectElement).value)),
    },
    SPEEDS.map(([label, v]) => h('option', { value: v }, label)),
  );
  const clockValue = h('span', { class: 'clock-value' }, '0 µs');
  const clock = h('div', { class: 'clock', 'aria-label': '模擬時間', 'data-tip': '電路經過的模擬時間' }, h('span', { class: 'clock-label' }, 'T'), clockValue);

  const sep = () => h('span', { class: 'tb-sep' });
  const toolBar = h(
    'div',
    { class: 'toolbar', role: 'toolbar', 'aria-label': '工具列' },
    toolButton('newFile', '新增', '新增空白電路', undefined, act.newDoc),
    toolButton('open', '開啟', '開啟電路檔', undefined, act.open),
    toolButton('save', '存檔', '存成電路檔，可以傳給別人', 'Ctrl+S', act.save),
    toolButton('share', '分享', '複製可以開啟這個電路的連結', undefined, act.share),
    sep(),
    undo,
    redo,
    rotate,
    del,
    sep(),
    selectTool,
    wireTool,
    probeTool,
    h('span', { class: 'spacer' }),
    run,
    step,
    reset,
    sep(),
    speed,
    clock,
  );

  // ---- 畫面分頁 ----

  const viewTab = (v: ViewKind, name: IconName, label: string) => {
    const count = h('span', { class: 'tab-count' });
    const b = h('button', { class: 'view-tab', role: 'tab', onclick: () => app.setView(v) }, icon(name), label, count);
    return { b, count };
  };
  const tabSch = viewTab('sch', 'schematic', '電路圖');
  const tabBB = viewTab('bb', 'board', '麵包板');
  const volts = toolButton('volts', '節點電壓', '在導線上顯示節點電壓', undefined, act.volts);
  const compare = toolButton('compare', '對照電路圖', '檢查麵包板的接線是否和電路圖相同', undefined, act.compare);
  const fit = toolButton('fit', '全部顯示', '縮放到看見整個電路', 'F', act.fit);
  const stageHead = h(
    'div',
    { class: 'stage-head' },
    h('div', { class: 'view-tabs', role: 'tablist', 'aria-label': '畫面' }, tabSch.b, tabBB.b),
    h('span', { class: 'spacer' }),
    volts,
    compare,
    fit,
  );

  // ---- 提醒 ----

  const messages = h('div', { class: 'messages', 'aria-live': 'polite' });
  let messagesHidden = false;
  const MSG_ICON: Record<string, IconName> = { error: 'error', warn: 'warn', info: 'info' };
  let lastMsgKey = '';
  const renderMessages = () => {
    const list = app.diags.slice(0, 4);
    const extra = app.diags.length - list.length;
    const key = list.map((d) => d.text).join('|') + extra;
    if (key === lastMsgKey) return;
    lastMsgKey = key;
    messages.replaceChildren(
      ...list.map((d) =>
        h(
          'button',
          {
            class: `msg ${d.level}`,
            onclick: () => {
              if (d.compId) app.select([d.compId]);
            },
          },
          icon(MSG_ICON[d.level] ?? 'info'),
          h('span', {}, d.text),
        ),
      ),
      ...(extra > 0 ? [h('span', { class: 'msg info' }, h('span', {}, `還有 ${extra} 則提醒`))] : []),
    );
  };

  // ---- 狀態列 ----

  const runDot = h('span', { class: 'run-dot' });
  const runText = h('span', {});
  const stats = h('span', { class: 'status-item' });
  const diagErr = h('span', { class: 'diag-count err' }, icon('error', 13));
  const diagWarn = h('span', { class: 'diag-count warn' }, icon('warn', 13));
  const diagBtn = h('button', {
    class: 'status-btn',
    'aria-label': '顯示或隱藏提醒',
    'data-tip': '顯示或隱藏畫布上的提醒',
    onclick: () => {
      messagesHidden = !messagesHidden;
      messages.hidden = messagesHidden;
    },
  }, diagErr, diagWarn);
  const hint = h('span', { class: 'status-hint' });
  const zoomText = h('button', { class: 'status-btn zoom-value', 'data-tip': '全部顯示', 'data-key': 'F', onclick: act.fit }, '100%');
  const statusBar = h(
    'footer',
    { class: 'statusbar' },
    h('span', { class: 'status-item' }, runDot, runText),
    stats,
    diagBtn,
    hint,
    h('span', { class: 'spacer' }),
    h('button', { class: 'status-btn', 'aria-label': '縮小', 'data-tip': '縮小', 'data-key': '-', onclick: () => stage.zoomBy(0.8) }, icon('zoomOut', 14)),
    zoomText,
    h('button', { class: 'status-btn', 'aria-label': '放大', 'data-tip': '放大', 'data-key': '+', onclick: () => stage.zoomBy(1.25) }, icon('zoomIn', 14)),
  );

  // ---- 依狀態更新 ----

  const refresh = () => {
    const onSch = app.view === 'sch';
    undo.disabled = !app.canUndo;
    redo.disabled = !app.canRedo;
    rotate.disabled = app.selection.size === 0;
    del.disabled = app.selection.size === 0;
    selectTool.classList.toggle('active', app.tool === 'select');
    wireTool.classList.toggle('active', app.tool === 'wire');
    wireTool.disabled = !onSch;
    probeTool.classList.toggle('active', app.tool === 'probe');
    tabSch.b.classList.toggle('on', onSch);
    tabSch.b.setAttribute('aria-selected', String(onSch));
    tabBB.b.classList.toggle('on', !onSch);
    tabBB.b.setAttribute('aria-selected', String(!onSch));
    tabSch.count.textContent = String(app.doc.comps.filter((c) => c.sch).length);
    tabBB.count.textContent = String(app.doc.comps.filter((c) => c.bb).length);
    run.replaceChildren(icon(app.running ? 'pause' : 'play'), h('span', {}, app.running ? '暫停' : '執行'));
    run.classList.toggle('paused', !app.running);
    step.disabled = app.running;
    compare.hidden = onSch;
    volts.hidden = !onSch;
    volts.classList.toggle('active', app.showVolts);
    if (document.activeElement !== title) title.value = app.doc.title;
    speed.value = String(app.doc.speed);
    if (speed.value === '') speed.selectedIndex = 1;
    themeBtn.replaceChildren(icon(currentTheme() === 'dark' ? 'sun' : 'moon'));
    refreshStatus();
  };

  const refreshStatus = () => {
    dirty.textContent = app.isDirty ? '未存檔' : '';
    runDot.className = `run-dot ${!app.running ? 'paused' : app.lagging ? 'lag' : 'on'}`;
    runText.textContent = !app.running ? '已暫停' : app.lagging ? '模擬跟不上，請調慢速度' : '模擬中';
    const compCount = app.compiled.topo.comps.length;
    const wires = app.view === 'sch' ? app.doc.schWires.length : app.doc.bbWires.length;
    stats.textContent = `元件 ${compCount}　導線 ${wires}`;
    const errors = app.diags.filter((d) => d.level === 'error').length;
    const warns = app.diags.filter((d) => d.level === 'warn').length;
    diagErr.replaceChildren(icon('error', 13), String(errors));
    diagErr.classList.toggle('some', errors > 0);
    diagWarn.replaceChildren(icon('warn', 13), String(warns));
    diagWarn.classList.toggle('some', warns > 0);
    hint.textContent = hintText(app);
  };

  app.on((e) => {
    if (e !== 'slow') refresh();
    else refreshStatus();
    if (e === 'slow' || e === 'doc') renderMessages();
  });
  refresh();
  renderMessages();

  let lastZoom = -1;
  let lastClock = '';
  stage.addFrameCallback(() => {
    const t = formatTime(app.compiled.sim.time);
    if (t !== lastClock) clockValue.textContent = lastClock = t;
    const z = Math.round(stage.zoom * 100);
    if (z !== lastZoom) zoomText.textContent = `${(lastZoom = z)}%`;
  });

  return { titleBar, toolBar, stageHead, statusBar, messages };
}

function hintText(app: App): string {
  if (app.tool === 'probe') return '點電路上的節點，加到示波器';
  if (app.tool === 'wire') return '點起點，再點終點；按 Esc 取消';
  const comp = app.selectedComp;
  if (comp) return app.view === 'sch' ? `已選取 ${comp.ref}：按 R 旋轉、Delete 刪除` : `已選取 ${comp.ref}：可拖曳引腳換孔、按 R 調換方向、Delete 拔除`;
  if (app.selection.size > 1) return `已選取 ${app.selection.size} 個項目`;
  return app.view === 'sch' ? '點元件庫再點畫布放置；從腳拖曳可以接線；滾輪縮放' : '從孔或電源端子拖曳可以接跳線；滾輪縮放；右鍵拖曳移動畫面';
}
