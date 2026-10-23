// IQ 테스트 — 데이터 + 로직 (오프라인, 외부 전송 없음)

const TEXT = {
  ko: {
    title: 'IQ 테스트',
    subtitle: '서로 다른 3개의 시험지(A·B·C) — 패턴·숫자·언어 영역 15문항씩',
    disclaimerHome: '⚠️ 재미·자가 참고용입니다. 공식 심리 검사나 전문 IQ 측정을 대체하지 않습니다.',
    startBtn: '시작하기',
    questionsLabel: n => `문항 ${n}개 · 패턴 5 · 숫자 5 · 언어 5`,
    typeLabel: { pattern: '패턴 추론', number: '숫자 추론', verbal: '언어 추론' },
    progress: (i, n) => `${i} / ${n}`,
    next: '다음',
    finish: '제출하고 결과 보기',
    pickAnswer: '답을 먼저 선택하세요.',
    resultTitle: '결과',
    scoreLine: (c, n) => `정답 ${c} / ${n}`,
    iqLine: '예상 점수 (참고용)',
    classLabel: '분류',
    timeLabel: '걸린 시간',
    byTypeTitle: '영역별 정답 수',
    disclaimerResult: '이 점수는 표준화된 규준(norm) 집단과 비교한 공식 IQ가 아니라, 정답률을 정규분포 가정으로 환산한 참고용 추정치입니다. 집중력, 피로도, 문항 난이도 체감에 따라 매번 달라질 수 있습니다.',
    retry: '같은 시험 다시 풀기',
    home: '시험 목록으로',
    tryAnother: '다른 시험 풀어보기',
    classes: [
      [130, '매우 우수'], [120, '우수'], [110, '평균 상'],
      [90, '평균'], [80, '평균 하'], [70, '경계선'], [-Infinity, '매우 낮음'],
    ],
  },
  en: {
    title: 'IQ Test',
    subtitle: 'Three independent forms (A·B·C) — 15 questions each: pattern, number, verbal',
    disclaimerHome: '⚠️ For entertainment / self-reference only. Not a substitute for a professional psychometric assessment.',
    startBtn: 'Start',
    questionsLabel: n => `${n} questions · 5 pattern · 5 number · 5 verbal`,
    typeLabel: { pattern: 'Pattern reasoning', number: 'Number reasoning', verbal: 'Verbal reasoning' },
    progress: (i, n) => `${i} / ${n}`,
    next: 'Next',
    finish: 'Submit & see result',
    pickAnswer: 'Please select an answer first.',
    resultTitle: 'Result',
    scoreLine: (c, n) => `${c} / ${n} correct`,
    iqLine: 'Estimated score (for reference)',
    classLabel: 'Classification',
    timeLabel: 'Time taken',
    byTypeTitle: 'Correct by category',
    disclaimerResult: 'This is not a clinically normed IQ score — it is a rough estimate that maps your percent-correct onto a normal-distribution curve (mean 100, SD 15). It will vary with focus, fatigue, and how familiar the item style feels.',
    retry: 'Retake this form',
    home: 'Back to test list',
    tryAnother: 'Try another form',
    classes: [
      [130, 'Very Superior'], [120, 'Superior'], [110, 'High Average'],
      [90, 'Average'], [80, 'Low Average'], [70, 'Borderline'], [-Infinity, 'Extremely Low'],
    ],
  },
};

// ---- Pattern items (language-neutral symbols), 15 total, 5 per form ----
const PATTERNS = [
  { prompt: '▲ ▲▲ ▲▲▲ ▲▲▲▲ ?', options: ['▲▲▲▲▲', '▲▲▲', '▲▲▲▲▲▲', '■■■■■'], answer: 0 },
  { prompt: '● ■ ▲ ● ■ ?', options: ['●', '■', '▲', '★'], answer: 2 },
  { prompt: '● ● ●● ●●● ●●●●● ?', options: ['●●●●●●', '●●●●●●●', '●●●●●●●●', '●●●●●●●●●●●●●'], answer: 2 },
  { prompt: '●■▲  /  ■▲●  /  ▲●?', options: ['▲', '■', '●', '★'], answer: 1 },
  { prompt: '→ ↑ ← ↓ → ↑ ← ?', options: ['→', '↑', '←', '↓'], answer: 3 },
  { prompt: '■ ■■ ■■■ ■■■■■ ?', options: ['■■■■■■', '■■■■■■■', '■■■■■■■■', '■■■■■■■■■■■'], answer: 2 },
  { prompt: '◆ ● ◆ ● ◆ ?', options: ['◆', '●', '▲', '■'], answer: 1 },
  { prompt: '· o O ● ?', options: ['⬤', 'o', '●', '·'], answer: 0 },
  { prompt: '▲●  /  ●▲  /  ▲?', options: ['▲', '●', '■', '★'], answer: 1 },
  { prompt: '★ ★★★ ★★★★★ ?', options: ['★★★★★★', '★★★★★★★', '★★★★★★★★', '★★'], answer: 1 },
  { prompt: '▲▲ ▲▲▲▲ ▲▲▲▲▲▲ ?', options: ['▲▲▲▲▲▲▲', '▲▲▲▲▲▲▲▲', '▲▲▲▲▲▲▲▲▲', '▲▲▲▲▲'], answer: 1 },
  { prompt: '● ▲ ■ ● ▲ ?', options: ['●', '▲', '■', '★'], answer: 2 },
  { prompt: '↑→↓←  /  →↓←↑  /  ↓←↑?', options: ['↑', '→', '↓', '←'], answer: 1 },
  { prompt: '● ●● ●●●● ?', options: ['●●●●●', '●●●●●●', '●●●●●●●●', '●●●'], answer: 2 },
  { prompt: 'X O X O X ?', options: ['X', 'O', '△', '□'], answer: 1 },
];

// ---- Number sequence items, 15 total, 5 per form ----
const NUMBERS = [
  { prompt: '2, 4, 6, 8, ?', options: ['9', '10', '11', '12'], answer: 1 },
  { prompt: '3, 6, 12, 24, ?', options: ['30', '36', '48', '72'], answer: 2 },
  { prompt: '1, 4, 9, 16, ?', options: ['20', '22', '25', '36'], answer: 2 },
  { prompt: '1, 1, 2, 3, 5, ?', options: ['6', '7', '8', '9'], answer: 2 },
  { prompt: '5, 10, 8, 13, 11, ?', options: ['9', '14', '16', '18'], answer: 2 },
  { prompt: '100, 90, 81, 73, ?', options: ['64', '65', '66', '67'], answer: 2 },
  { prompt: '7, 14, 28, 56, ?', options: ['84', '98', '112', '126'], answer: 2 },
  { prompt: '2, 3, 5, 8, 13, ?', options: ['18', '20', '21', '24'], answer: 2 },
  { prompt: '81, 27, 9, 3, ?', options: ['0', '1', '2', '-3'], answer: 1 },
  { prompt: '11, 13, 17, 19, 23, ?', options: ['25', '27', '29', '31'], answer: 2 },
  { prompt: '2, 6, 12, 20, 30, ?', options: ['36', '40', '42', '48'], answer: 2 },
  { prompt: '10, 20, 19, 29, 28, ?', options: ['27', '36', '37', '38'], answer: 3 },
  { prompt: '1, 8, 27, 64, ?', options: ['100', '110', '125', '128'], answer: 2 },
  { prompt: '3, 9, 27, 81, ?', options: ['162', '216', '243', '324'], answer: 2 },
  { prompt: '4, 9, 16, 25, 36, ?', options: ['42', '45', '48', '49'], answer: 3 },
];

// ---- Verbal items, 15 per language, index-aligned with the same answer index ----
const VERBAL = {
  en: [
    { stem: 'Bird is to Nest as Bee is to ___?', options: ['Hive', 'Web', 'Burrow', 'Nest'], answer: 0 },
    { stem: 'Choose the opposite of "Benevolent".', options: ['Kind', 'Malevolent', 'Generous', 'Caring'], answer: 1 },
    { stem: 'Which word does not belong?', options: ['Apple', 'Banana', 'Carrot', 'Grape'], answer: 2 },
    { stem: 'Author is to Book as Composer is to ___?', options: ['Symphony', 'Painting', 'Sculpture', 'Novel'], answer: 0 },
    { stem: 'Choose the word closest in meaning to "Meticulous".', options: ['Careless', 'Precise', 'Lazy', 'Hasty'], answer: 1 },
    { stem: 'Fish is to Water as Bird is to ___?', options: ['Sky', 'Nest', 'Tree', 'Ground'], answer: 0 },
    { stem: 'Choose the opposite of "Transparent".', options: ['Clear', 'Opaque', 'Visible', 'Bright'], answer: 1 },
    { stem: 'Which word does not belong?', options: ['Square', 'Triangle', 'Circle', 'Red'], answer: 3 },
    { stem: 'Doctor is to Hospital as Teacher is to ___?', options: ['School', 'Hammer', 'Kitchen', 'Court'], answer: 0 },
    { stem: 'Choose the word closest in meaning to "Candid".', options: ['Honest', 'Secretive', 'Shy', 'Rude'], answer: 0 },
    { stem: 'Key is to Lock as Password is to ___?', options: ['Account', 'Door', 'Key', 'Book'], answer: 0 },
    { stem: 'Choose the opposite of "Abundant".', options: ['Plentiful', 'Scarce', 'Rich', 'Full'], answer: 1 },
    { stem: 'Which word does not belong?', options: ['Piano', 'Guitar', 'Violin', 'Painting'], answer: 3 },
    { stem: 'Hungry is to Food as Thirsty is to ___?', options: ['Water', 'Hunger', 'Sleep', 'Air'], answer: 0 },
    { stem: 'Choose the word closest in meaning to "Diligent".', options: ['Lazy', 'Hardworking', 'Careless', 'Slow'], answer: 1 },
  ],
  ko: [
    { stem: '새 : 둥지 = 벌 : ___?', options: ['벌집', '거미줄', '굴', '둥지'], answer: 0 },
    { stem: '"자비로운"의 반대말은?', options: ['친절한', '잔인한', '너그러운', '따뜻한'], answer: 1 },
    { stem: '다른 하나를 고르세요.', options: ['사과', '바나나', '당근', '포도'], answer: 2 },
    { stem: '작가 : 책 = 작곡가 : ___?', options: ['교향곡', '그림', '조각', '소설'], answer: 0 },
    { stem: '"꼼꼼한"과 의미가 가장 가까운 단어는?', options: ['부주의한', '정밀한', '게으른', '급한'], answer: 1 },
    { stem: '물고기 : 물 = 새 : ___?', options: ['하늘', '둥지', '나무', '땅'], answer: 0 },
    { stem: '"투명한"의 반대말은?', options: ['맑은', '불투명한', '보이는', '밝은'], answer: 1 },
    { stem: '다른 하나를 고르세요.', options: ['정사각형', '삼각형', '원', '빨강'], answer: 3 },
    { stem: '의사 : 병원 = 교사 : ___?', options: ['학교', '망치', '주방', '법원'], answer: 0 },
    { stem: '"솔직한"과 의미가 가장 가까운 단어는?', options: ['정직한', '비밀스러운', '수줍은', '무례한'], answer: 0 },
    { stem: '열쇠 : 자물쇠 = 비밀번호 : ___?', options: ['계정', '문', '열쇠', '책'], answer: 0 },
    { stem: '"풍부한"의 반대말은?', options: ['넉넉한', '부족한', '부유한', '가득한'], answer: 1 },
    { stem: '다른 하나를 고르세요.', options: ['피아노', '기타', '바이올린', '그림'], answer: 3 },
    { stem: '배고픔 : 음식 = 목마름 : ___?', options: ['물', '배고픔', '잠', '공기'], answer: 0 },
    { stem: '"성실한"과 의미가 가장 가까운 단어는?', options: ['게으른', '근면한', '부주의한', '느린'], answer: 1 },
  ],
};

function buildForm(formIdx) {
  // formIdx 0,1,2 -> items [0-4],[5-9],[10-14] from each bank, interleaved pattern/number/verbal
  const lo = formIdx * 5, hi = lo + 5;
  const items = [];
  for (let i = lo; i < hi; i++) {
    items.push({ type: 'pattern', ...PATTERNS[i] });
    items.push({ type: 'number', ...NUMBERS[i] });
    items.push({ type: 'verbal', en: VERBAL.en[i], ko: VERBAL.ko[i] });
  }
  return items;
}

const FORMS = ['A', 'B', 'C'].map((name, i) => ({ id: name, items: buildForm(i) }));

// ---- Inverse normal CDF (Acklam's rational approximation) ----
function invNorm(p) {
  if (p <= 0) p = 0.0001;
  if (p >= 1) p = 0.9999;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const plow = 0.02425;
  let q, r;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - plow) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function estimateIQ(correct, total) {
  // Continuity correction avoids the +/-Infinity that correct/total would give at 0 or 100%.
  const p = (correct + 0.5) / (total + 1);
  return Math.round(100 + 15 * invNorm(p));
}

function classify(lang, iq) {
  for (const [min, label] of TEXT[lang].classes) {
    if (iq >= min) return label;
  }
  return TEXT[lang].classes[TEXT[lang].classes.length - 1][1];
}

// ---- App state & rendering ----
const state = { lang: 'ko', formIdx: null, idx: 0, selected: null, answers: [], startedAt: 0 };

const root = document.getElementById('app');

function t() { return TEXT[state.lang]; }

function setLang(lang) {
  state.lang = lang;
  render();
}

function startForm(formIdx) {
  state.formIdx = formIdx;
  state.idx = 0;
  state.selected = null;
  state.answers = [];
  state.startedAt = Date.now();
  render();
}

function goHome() {
  state.formIdx = null;
  render();
}

function selectOption(i) {
  state.selected = i;
  render();
}

function nextQuestion() {
  if (state.selected === null) {
    alert(t().pickAnswer);
    return;
  }
  const items = FORMS[state.formIdx].items;
  const item = items[state.idx];
  const correctIdx = item.type === 'verbal' ? item[state.lang].answer : item.answer;
  state.answers.push({ type: item.type, correct: state.selected === correctIdx });
  state.selected = null;
  state.idx++;
  render();
}

function fmtTime(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

function render() {
  root.innerHTML = '';
  root.appendChild(renderLangSwitch());
  if (state.formIdx === null) {
    root.appendChild(renderHome());
  } else if (state.idx < FORMS[state.formIdx].items.length) {
    root.appendChild(renderQuestion());
  } else {
    root.appendChild(renderResult());
  }
}

function renderLangSwitch() {
  return el('div', { class: 'langbar' }, [
    el('button', { class: state.lang === 'ko' ? 'seg on' : 'seg', onclick: () => setLang('ko') }, '한글'),
    el('button', { class: state.lang === 'en' ? 'seg on' : 'seg', onclick: () => setLang('en') }, 'English'),
  ]);
}

function renderHome() {
  const tt = t();
  const wrap = el('div', { class: 'home' });
  wrap.appendChild(el('h1', {}, tt.title));
  wrap.appendChild(el('p', { class: 'sub' }, tt.subtitle));
  wrap.appendChild(el('p', { class: 'warn' }, tt.disclaimerHome));
  const list = el('div', { class: 'cards' });
  FORMS.forEach((f, i) => {
    const card = el('div', { class: 'card' }, [
      el('div', { class: 'card-title' }, `${tt.title} ${f.id}`),
      el('div', { class: 'card-sub' }, tt.questionsLabel(f.items.length)),
      el('button', { class: 'btn primary', onclick: () => startForm(i) }, tt.startBtn),
    ]);
    list.appendChild(card);
  });
  wrap.appendChild(list);
  return wrap;
}

function renderQuestion() {
  const tt = t();
  const items = FORMS[state.formIdx].items;
  const item = items[state.idx];
  const wrap = el('div', { class: 'quiz' });
  wrap.appendChild(el('div', { class: 'progress' }, tt.progress(state.idx + 1, items.length)));
  wrap.appendChild(el('div', { class: 'bar' }, [
    el('div', { class: 'bar-fill', style: `width:${(state.idx / items.length) * 100}%` }),
  ]));
  wrap.appendChild(el('div', { class: 'type-tag' }, tt.typeLabel[item.type === 'verbal' ? 'verbal' : item.type]));

  const stem = item.type === 'verbal' ? item[state.lang].stem : item.prompt;
  const options = item.type === 'verbal' ? item[state.lang].options : item.options;

  wrap.appendChild(el('div', { class: 'stem' }, stem));
  const opts = el('div', { class: 'options' });
  options.forEach((opt, i) => {
    opts.appendChild(el('button', {
      class: 'option' + (state.selected === i ? ' selected' : ''),
      onclick: () => selectOption(i),
    }, opt));
  });
  wrap.appendChild(opts);

  const isLast = state.idx === items.length - 1;
  wrap.appendChild(el('button', { class: 'btn primary wide', onclick: nextQuestion }, isLast ? tt.finish : tt.next));
  return wrap;
}

function renderResult() {
  const tt = t();
  const items = FORMS[state.formIdx].items;
  const total = items.length;
  const correct = state.answers.filter(a => a.correct).length;
  const iq = estimateIQ(correct, total);
  const label = classify(state.lang, iq);
  const elapsed = Date.now() - state.startedAt;

  const byType = { pattern: [0, 0], number: [0, 0], verbal: [0, 0] };
  state.answers.forEach(a => {
    byType[a.type][1]++;
    if (a.correct) byType[a.type][0]++;
  });

  const wrap = el('div', { class: 'result' });
  wrap.appendChild(el('h1', {}, tt.resultTitle));
  wrap.appendChild(el('div', { class: 'score-big' }, tt.scoreLine(correct, total)));
  wrap.appendChild(el('div', { class: 'iq-box' }, [
    el('div', { class: 'iq-label' }, tt.iqLine),
    el('div', { class: 'iq-num' }, String(iq)),
    el('div', { class: 'iq-class' }, `${tt.classLabel}: ${label}`),
  ]));
  wrap.appendChild(el('div', { class: 'time-row' }, `${tt.timeLabel}: ${fmtTime(elapsed)}`));

  const bt = el('div', { class: 'bytype' }, [el('div', { class: 'bytype-title' }, tt.byTypeTitle)]);
  ['pattern', 'number', 'verbal'].forEach(k => {
    bt.appendChild(el('div', { class: 'bytype-row' }, `${tt.typeLabel[k]}: ${byType[k][0]} / ${byType[k][1]}`));
  });
  wrap.appendChild(bt);

  wrap.appendChild(el('p', { class: 'warn small' }, tt.disclaimerResult));

  const btns = el('div', { class: 'result-btns' }, [
    el('button', { class: 'btn primary', onclick: () => startForm(state.formIdx) }, tt.retry),
    el('button', { class: 'btn', onclick: goHome }, tt.tryAnother + ' / ' + tt.home),
  ]);
  wrap.appendChild(btns);
  return wrap;
}

render();
