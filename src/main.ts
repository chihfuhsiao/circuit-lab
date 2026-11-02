// 進入點：組裝介面。

import './style.css';
import { App, loadAutosave } from './app';
import { compareViews } from './circuit/compare';
import { newDoc } from './circuit/types';
import { EXAMPLES } from './content/examples';
import { h, modal } from './ui/dom';
import { loadFromHash, openFile, saveFile, shareLink } from './ui/file';
import { buildPalette } from './ui/palette';
import { buildScope } from './ui/scope';
import { buildSide, confirmReplace } from './ui/side';
import { isTyping, Stage } from './ui/stage';

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

async function start(): Promise<void> {
  const fromLink = await loadFromHash();
  const saved = fromLink ?? loadAutosave();
  const first = saved ?? EXAMPLES[0].build();
  const app = new App(first);
  // 只放在麵包板上的電路，開啟時要直接看麵包板，否則畫面會是空的。
  if (first.comps.length && !first.comps.some((c) => c.sch)) app.setView('bb');
  if (fromLink) history.replaceState(null, '', location.pathname);

  const stage = new Stage(app);
  const main = h('div', { class: 'main' }, stage.el, buildScope(app, stage));

  // 上方工具列
  const title = h('input', {
    class: 'title-input',
    value: app.doc.title,
    'aria-label': '電路名稱',
    onchange: (e: Event) => {
      app.doc.title = (e.target as HTMLInputElement).value.trim() || '未命名電路';
      app.commit();
    },
  });
  const undo = h('button', { class: 'btn', title: '復原（Ctrl+Z）', onclick: () => app.undo() }, '↶ 復原');
  const redo = h('button', { class: 'btn', title: '重做（Ctrl+Y）', onclick: () => app.redo() }, '↷ 重做');
  const viewSch = h('button', { onclick: () => app.setView('sch') }, '電路圖');
  const viewBB = h('button', { onclick: () => app.setView('bb') }, '麵包板');
  const run = h('button', { class: 'btn primary', title: '暫停／繼續（P）', onclick: () => app.setRunning(!app.running) }, '⏸ 暫停');
  const step = h('button', { class: 'btn', title: '暫停時前進一小段', onclick: () => app.stepOnce() }, '⏭ 單步');
  const reset = h('button', { class: 'btn', title: '回到 0 秒：電容放電、燒毀的元件換新', onclick: () => app.reset() }, '⟲ 重設');
  const speed = h(
    'select',
    {
      class: 'select',
      'aria-label': '模擬速度',
      title: '每過 1 秒真實時間，電路經過多少時間。交流或高頻電路要調慢才看得清楚。',
      onchange: (e: Event) => app.setSpeed(Number((e.target as HTMLSelectElement).value)),
    },
    SPEEDS.map(([label, v]) => h('option', { value: v }, label)),
  );
  const clock = h('span', { class: 'clock', 'aria-label': '模擬時間' }, '0 µs');
  const volts = h('button', {
    class: 'btn',
    title: '在導線上顯示節點電壓',
    onclick: () => {
      app.showVolts = !app.showVolts;
      volts.classList.toggle('active', app.showVolts);
    },
  }, '節點電壓');
  volts.classList.toggle('active', app.showVolts);
  const compare = h('button', { class: 'btn', title: '檢查麵包板的接線是否和電路圖相同', onclick: () => showCompare(app) }, '對照電路圖');
  const fit = h('button', { class: 'btn', title: '縮放到看見整個電路（F）', onclick: () => stage.fit() }, '全部顯示');
  const wireTool = h('button', { class: 'btn', title: '接線工具（W）：從任何位置開始拉線', onclick: () => app.setTool(app.tool === 'wire' ? 'select' : 'wire') }, '接線');

  const top = h(
    'header',
    { class: 'topbar' },
    h('span', { class: 'brand' }, '電路實驗室'),
    title,
    h('button', { class: 'btn', onclick: () => confirmReplace(app, () => app.loadDoc(newDoc(), app.view)) }, '新增'),
    h('button', { class: 'btn', onclick: () => openFile(app) }, '開啟'),
    h('button', { class: 'btn', title: '存成電路檔，可以傳給別人（Ctrl+S）', onclick: () => saveFile(app) }, '存檔'),
    h('button', { class: 'btn', onclick: () => shareLink(app) }, '分享'),
    h('span', { class: 'sep' }),
    undo,
    redo,
    h('span', { class: 'sep' }),
    h('div', { class: 'seg', role: 'group', 'aria-label': '畫面' }, viewSch, viewBB),
    h('span', { class: 'sep' }),
    run,
    step,
    reset,
    speed,
    clock,
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn ghost', onclick: showHelp }, '說明'),
  );

  stage.el.append(h('div', { class: 'stage-tools' }, wireTool, volts, compare, fit));
  const messages = h('div', { class: 'messages', 'aria-live': 'polite' });
  stage.el.append(messages);

  const layout = h('div', { class: 'layout' }, top, buildPalette(app, stage), main, buildSide(app));
  document.getElementById('root')!.append(layout);

  // 依狀態更新工具列
  const refresh = () => {
    undo.disabled = !app.canUndo;
    redo.disabled = !app.canRedo;
    viewSch.classList.toggle('on', app.view === 'sch');
    viewBB.classList.toggle('on', app.view === 'bb');
    run.textContent = app.running ? '⏸ 暫停' : '▶ 繼續';
    step.disabled = app.running;
    compare.style.display = app.view === 'bb' ? '' : 'none';
    wireTool.style.display = app.view === 'sch' ? '' : 'none';
    volts.style.display = app.view === 'sch' ? '' : 'none';
    wireTool.classList.toggle('active', app.tool === 'wire');
    if (document.activeElement !== title) title.value = app.doc.title;
    speed.value = String(app.doc.speed);
    if (speed.value === '') speed.selectedIndex = 1;
  };
  app.on((e) => {
    if (e !== 'slow') refresh();
  });
  refresh();

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
          d.text,
        ),
      ),
      ...(extra > 0 ? [h('span', { class: 'msg info' }, `還有 ${extra} 則提醒`)] : []),
    );
  };
  app.on((e) => {
    if (e === 'slow' || e === 'doc') renderMessages();
  });

  stage.addFrameCallback(() => {
    clock.textContent = formatTime(app.compiled.sim.time);
  });

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
    if (key === 'w' && app.view === 'sch') {
      app.setTool(app.tool === 'wire' ? 'select' : 'wire');
      return;
    }
    if (stage.view.keyDown(e)) e.preventDefault();
  });

  // 開發時方便在瀏覽器主控台檢查與測試。
  if (import.meta.env.DEV) Object.assign(window, { __app: app, __stage: stage, __examples: EXAMPLES });
}

function showCompare(app: App): void {
  const res = compareViews(app.doc);
  const body: (Node | string)[] = [];
  if (res.compared === 0 && !res.unplaced.length) {
    body.push(h('div', { class: 'issue note' }, '電路圖上還沒有可以對照的元件。先在「電路圖」畫面畫好電路，再到麵包板接線。'));
  } else if (res.ok) {
    body.push(h('div', { class: 'issue good' }, `接線正確：${res.compared} 個元件都和電路圖相同。`));
  }
  if (res.unplaced.length) {
    body.push(h('div', { class: 'issue bad' }, `還沒放到麵包板：${res.unplaced.map((c) => c.ref).join('、')}`));
  }
  for (const issue of res.issues) body.push(h('div', { class: 'issue bad' }, issue.text));
  if (res.skipped.length) {
    body.push(h('div', { class: 'issue note' }, `${res.skipped.map((c) => c.ref).join('、')} 是電路圖專用符號，麵包板要改用對應的 IC，無法逐腳對照，請用實際動作檢查。`));
  }
  modal('對照電路圖', body);
}

function showHelp(): void {
  modal(
    '怎麼使用',
    [
      h('h3', {}, '電路圖'),
      h(
        'ul',
        {},
        h('li', {}, '點左邊的元件，再點畫布放置；放置前可按 ', h('kbd', {}, 'R'), ' 旋轉'),
        h('li', {}, '從元件的腳拖曳到另一隻腳就是接線；也可以點一下腳、再點一下終點'),
        h('li', {}, '點開關或邏輯輸入可以切換；按鈕要按住'),
        h('li', {}, '黃色小點代表電流（由正到負），導線紅色為高電位、灰色為 0V、藍色為負電位'),
      ),
      h('h3', {}, '麵包板'),
      h(
        'ul',
        {},
        h('li', {}, '同一欄的 a～e 相通、f～j 相通，電源軌整排相通；滑鼠移到孔上會標出來'),
        h('li', {}, '從空的孔或電源端子拖曳就是接跳線；選取元件後可以拖曳引腳換孔'),
        h('li', {}, '在電路圖放好的元件會出現在左上的「待放置」'),
        h('li', {}, '按「對照電路圖」檢查接線，模擬的是目前畫面接出來的電路'),
      ),
      h('h3', {}, '快捷鍵'),
      h(
        'ul',
        {},
        h('li', {}, h('kbd', {}, 'Ctrl+Z'), ' 復原　', h('kbd', {}, 'Ctrl+Y'), ' 重做　', h('kbd', {}, 'Ctrl+S'), ' 存檔'),
        h('li', {}, h('kbd', {}, 'Delete'), ' 刪除　', h('kbd', {}, 'R'), ' 旋轉　', h('kbd', {}, 'Esc'), ' 取消'),
        h('li', {}, h('kbd', {}, 'P'), ' 暫停　', h('kbd', {}, 'F'), ' 全部顯示　', h('kbd', {}, 'W'), ' 接線工具'),
        h('li', {}, '滾輪縮放，右鍵或按住空白鍵拖曳可以移動畫面'),
      ),
    ],
  );
}

start();
