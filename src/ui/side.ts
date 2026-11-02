// 右側分頁：屬性、範例、引導實驗。

import { App } from '../app';
import { CircuitDoc, ViewKind } from '../circuit/types';
import { EXAMPLES, Example } from '../content/examples';
import { Check, CircuitStep, Experiment, EXPERIMENTS, QuizStep, Step } from '../content/experiments';
import { clear, h, modal } from './dom';
import { buildInspector } from './inspector';

type Tab = 'props' | 'examples' | 'experiments';

/** 目前的電路會被取代時先問一下。 */
export function confirmReplace(app: App, onYes: () => void): void {
  const hasWork = app.doc.comps.length > 0 && app.isDirty;
  if (!hasWork) {
    onYes();
    return;
  }
  modal('要取代目前的電路嗎？', [h('p', {}, '目前的電路還沒存檔，載入後就會被取代。需要的話可以先按取消，再按「存檔」。')], [
    { label: '取消' },
    { label: '繼續載入', primary: true, onclick: onYes },
  ]);
}

export function buildSide(app: App): HTMLElement {
  let tab: Tab = 'props';
  const body = h('div', { class: 'tab-body' });
  const inspector = buildInspector(app);
  const examples = buildExamples(app);
  const experiments = buildExperiments(app);
  const panes: Record<Tab, HTMLElement> = { props: inspector, examples, experiments };
  const buttons = new Map<Tab, HTMLButtonElement>();

  const show = (t: Tab) => {
    tab = t;
    body.replaceChildren(panes[t]);
    for (const [k, b] of buttons) {
      b.classList.toggle('on', k === t);
      b.setAttribute('aria-selected', String(k === t));
    }
  };
  const tabs = h(
    'div',
    { class: 'tabs', role: 'tablist' },
    (
      [
        ['props', '屬性'],
        ['examples', '範例'],
        ['experiments', '實驗'],
      ] as [Tab, string][]
    ).map(([k, label]) => {
      const b = h('button', { role: 'tab', onclick: () => show(k) }, label);
      buttons.set(k, b);
      return b;
    }),
  );
  show('props');

  // 選了元件就跳回屬性頁，實驗進行中則留在實驗頁。
  app.on((e) => {
    if (e === 'selection' && app.selectedComp && tab === 'examples') show('props');
  });

  return h('aside', { class: 'side', 'aria-label': '側邊面板' }, tabs, body);
}

function buildExamples(app: App): HTMLElement {
  const groups: Example['group'][] = ['基本電學', '電子學', '數位邏輯', '麵包板'];
  return h(
    'div',
    {},
    h('p', { class: 'muted', style: 'margin:0 0 4px' }, '點一下載入，每個都可以修改。'),
    groups.map((g) =>
      h(
        'div',
        {},
        h('h3', {}, g),
        h(
          'div',
          { class: 'card-list' },
          EXAMPLES.filter((e) => e.group === g).map((e) =>
            h(
              'button',
              {
                class: 'card',
                onclick: () => confirmReplace(app, () => app.loadDoc(e.build(), e.view)),
              },
              h('b', {}, e.title),
              h('span', {}, e.desc),
            ),
          ),
        ),
      ),
    ),
  );
}

interface RunState {
  exp: Experiment;
  index: number;
  memo: Record<string, any>;
  wrong: number | null;
}

function buildExperiments(app: App): HTMLElement {
  const el = h('div', {});
  let state: RunState | null = null;
  let progressEl: HTMLElement | null = null;
  /** 實驗自己載入電路時為 true；其他來源（範例、開檔、新增）載入時要結束實驗。 */
  let ownLoad = false;

  const loadForExperiment = (doc: CircuitDoc, view: ViewKind) => {
    ownLoad = true;
    app.loadDoc(doc, view);
    ownLoad = false;
  };

  const renderList = () => {
    clear(el);
    const courses = ['基本電學', '電子學', '數位邏輯', '麵包板實作'] as const;
    el.append(h('p', { class: 'muted', style: 'margin:0 0 4px' }, '照步驟動手接線，每一步會自動檢查。'));
    for (const c of courses) {
      el.append(
        h('h3', {}, c),
        h(
          'div',
          { class: 'card-list' },
          EXPERIMENTS.filter((e) => e.course === c).map((e) =>
            h(
              'button',
              { class: 'card', onclick: () => start(e) },
              h('b', {}, e.title),
              h('span', {}, e.goal),
            ),
          ),
        ),
      );
    }
  };

  const start = (exp: Experiment) => {
    confirmReplace(app, () => {
      loadForExperiment(exp.starter(), exp.view);
      state = { exp, index: 0, memo: {}, wrong: null };
      renderRun();
    });
  };

  const renderRun = () => {
    const s = state!;
    clear(el);
    progressEl = null;
    const finished = s.index >= s.exp.steps.length;
    el.append(
      h('button', { class: 'btn ghost', onclick: leave }, '← 實驗列表'),
      h('h2', { style: 'margin-top:6px' }, s.exp.title),
      h('p', { class: 'muted', style: 'margin:2px 0 8px' }, s.exp.goal),
    );
    if (finished) el.append(h('div', { class: 'banner', role: 'status' }, '實驗完成！你可以繼續修改電路，試試別的數值。'));
    s.exp.steps.forEach((step, i) => el.append(renderStep(step, i)));
    el.append(
      h(
        'div',
        { style: 'display:flex;gap:6px;margin-top:10px;flex-wrap:wrap' },
        h('button', { class: 'btn', onclick: () => confirmReplace(app, () => { loadForExperiment(s.exp.starter(), s.exp.view); s.index = 0; s.memo = {}; s.wrong = null; renderRun(); }) }, '重新開始'),
        h('button', { class: 'btn', onclick: () => showSolution(s.exp) }, '看參考電路'),
      ),
    );
  };

  const leave = () => {
    state = null;
    renderList();
  };

  const showSolution = (exp: Experiment) => {
    modal('參考電路', [h('p', {}, '會載入完成的電路，你目前的接線會被取代。建議先自己試試看，真的卡住再看。')], [
      { label: '取消' },
      { label: '載入參考電路', primary: true, onclick: () => loadForExperiment(exp.solution(), exp.view) },
    ]);
  };

  const renderStep = (step: Step, i: number): HTMLElement => {
    const s = state!;
    if (i > s.index) return h('div', { class: 'step todo' }, h('span', { class: 'num' }, `${i + 1}.`), step.kind === 'quiz' ? '問答' : '接線');
    if (i < s.index) {
      return h(
        'div',
        { class: 'step done' },
        h('span', { class: 'num' }, '✓'),
        step.kind === 'quiz' ? (step as QuizStep).explain : step.text,
      );
    }
    if (step.kind === 'quiz') {
      return h(
        'div',
        { class: 'step now' },
        h('span', { class: 'num' }, `${i + 1}.`),
        step.text,
        step.options.map((opt, k) =>
          h(
            'button',
            {
              class: `quiz-option${s.wrong === k ? ' wrong' : ''}`,
              onclick: () => {
                if (k === step.answer) {
                  s.index++;
                  s.wrong = null;
                  renderRun();
                } else {
                  s.wrong = k;
                  renderRun();
                }
              },
            },
            opt,
          ),
        ),
        s.wrong !== null ? h('div', { class: 'quiz-note', role: 'status' }, '再想想看，可以先看看電路的數值。') : '',
      );
    }
    progressEl = (step as CircuitStep).progress ? h('div', { class: 'progress' }) : null;
    return h(
      'div',
      { class: 'step now' },
      h('span', { class: 'num' }, `${i + 1}.`),
      step.text,
      progressEl,
      step.hint ? h('div', { class: 'hint' }, `提示：${step.hint}`) : '',
    );
  };

  // 定時檢查目前步驟。
  app.on((e) => {
    if (e === 'loaded' && !ownLoad && state) {
      leave();
      return;
    }
    if (e !== 'slow' || !state) return;
    const s = state;
    const step = s.exp.steps[s.index];
    if (!step || step.kind !== 'circuit') return;
    const check = new Check(app.doc, app.compiled, s.memo);
    const pass = step.check(check);
    if (progressEl && step.progress) progressEl.textContent = step.progress(check);
    if (pass) {
      s.index++;
      s.memo = {};
      renderRun();
    }
  });

  renderList();
  return el;
}
