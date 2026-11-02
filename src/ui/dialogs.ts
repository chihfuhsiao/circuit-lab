// 對照電路圖、使用說明、關於。

import { App } from '../app';
import { compareViews } from '../circuit/compare';
import { h, modal } from './dom';

export function showCompare(app: App): void {
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

export function showHelp(): void {
  modal(
    '使用說明',
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
        h('li', {}, h('kbd', {}, '+'), ' 放大　', h('kbd', {}, '-'), ' 縮小；也可以用滾輪縮放，右鍵或按住空白鍵拖曳可以移動畫面'),
      ),
    ],
  );
}

export function showAbout(): void {
  modal('關於電路實驗室', [
    h('p', {}, '給高中資訊科、電子科學生使用的電路模擬軟體。可以在電路圖或麵包板上接線，即時模擬類比與數位電路。'),
    h('p', { class: 'muted' }, '不需要帳號，也不會收集任何資料；電路只存在這台電腦的瀏覽器與你存的檔案裡。'),
  ]);
}
