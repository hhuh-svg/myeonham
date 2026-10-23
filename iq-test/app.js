// IQ 테스트 — 데이터 + 로직 (오프라인, 외부 전송 없음)

const PER_CATEGORY = 10; // per form: 10 pattern + 10 number + 10 verbal = 30 questions

const TEXT = {
  ko: {
    title: 'IQ 테스트',
    subtitle: '서로 다른 3개의 시험지(A·B·C) — 각 30문항(패턴·숫자·언어 10문항씩)',
    disclaimerHome: '⚠️ 재미·자가 참고용입니다. 공식 심리 검사나 전문 IQ 측정을 대체하지 않습니다.',
    ageLabel: '나이 (선택)',
    ageNote: '입력하면 같은 연령대 평균과 비교해 점수를 환산합니다. 비워두면 전체 평균과 비교합니다.',
    agePlaceholder: '예: 35',
    startBtn: '시작하기',
    questionsLabel: n => `문항 ${n}개 · 패턴 ${PER_CATEGORY} · 숫자 ${PER_CATEGORY} · 언어 ${PER_CATEGORY}`,
    typeLabel: { pattern: '패턴 추론', number: '숫자 추론', verbal: '언어 추론' },
    progress: (i, n) => `${i} / ${n}`,
    next: '다음',
    finish: '제출하고 결과 보기',
    pickAnswer: '답을 먼저 선택하세요.',
    resultTitle: '결과',
    scoreLine: (c, n) => `정답 ${c} / ${n}`,
    iqLine: '예상 점수 (참고용)',
    classLabel: '분류',
    ageUsedLabel: age => age ? `${age}세 기준으로 비교` : '전체 평균 기준으로 비교',
    timeLabel: '걸린 시간',
    byTypeTitle: '영역별 정답 수',
    disclaimerResult: '이 점수는 표준화된 규준(norm) 집단과 비교한 공식 IQ가 아니라, 입력한 나이대의 가정된 평균 정답률과 비교해 표준편차 단위로 환산한 참고용 추정치입니다(연령대별 기준 정답률은 실제 규준 데이터가 아니라 단순화한 가정치입니다). 집중력, 피로도, 문항 난이도 체감에 따라 매번 달라질 수 있습니다.',
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
    subtitle: 'Three independent forms (A·B·C) — 30 questions each (10 pattern, 10 number, 10 verbal)',
    disclaimerHome: '⚠️ For entertainment / self-reference only. Not a substitute for a professional psychometric assessment.',
    ageLabel: 'Age (optional)',
    ageNote: 'If given, your score is compared against the assumed average for your age group. Leave blank to compare against an overall average.',
    agePlaceholder: 'e.g. 35',
    startBtn: 'Start',
    questionsLabel: n => `${n} questions · ${PER_CATEGORY} pattern · ${PER_CATEGORY} number · ${PER_CATEGORY} verbal`,
    typeLabel: { pattern: 'Pattern reasoning', number: 'Number reasoning', verbal: 'Verbal reasoning' },
    progress: (i, n) => `${i} / ${n}`,
    next: 'Next',
    finish: 'Submit & see result',
    pickAnswer: 'Please select an answer first.',
    resultTitle: 'Result',
    scoreLine: (c, n) => `${c} / ${n} correct`,
    iqLine: 'Estimated score (for reference)',
    classLabel: 'Classification',
    ageUsedLabel: age => age ? `Compared against age ${age}` : 'Compared against overall average',
    timeLabel: 'Time taken',
    byTypeTitle: 'Correct by category',
    disclaimerResult: 'This is not a clinically normed IQ score. It converts your result into standard-deviation units relative to an assumed average accuracy for your age group (those age-group averages are simplified assumptions, not real normative data). It will vary with focus, fatigue, and how familiar the item style feels.',
    retry: 'Retake this form',
    home: 'Back to test list',
    tryAnother: 'Try another form',
    classes: [
      [130, 'Very Superior'], [120, 'Superior'], [110, 'High Average'],
      [90, 'Average'], [80, 'Low Average'], [70, 'Borderline'], [-Infinity, 'Extremely Low'],
    ],
  },
};

// ---- Pattern items (language-neutral symbols), ordered roughly easy -> hard ----
const PATTERNS = [
  { prompt: '● ●● ●●● ●●●● ?', options: ['●●●●●', '●●●', '●●●●●●', '■■■■■'], answer: 0 },
  { prompt: '★ ☆ ★ ★ ☆ ?', options: ['★', '☆', '●', '▲'], answer: 0 },
  { prompt: '● ■ ▲ ● ■ ?', options: ['●', '■', '▲', '★'], answer: 2 },
  { prompt: 'X O X O X ?', options: ['X', 'O', '△', '□'], answer: 1 },
  { prompt: '◆ ● ◆ ● ◆ ?', options: ['◆', '●', '▲', '■'], answer: 1 },
  { prompt: '▲ ▲▲ ▲▲▲ ▲▲▲▲ ▲▲▲▲▲ ?', options: ['▲▲▲▲▲▲', '▲▲▲', '▲▲▲▲▲▲▲', '■■■■■■'], answer: 0 },
  { prompt: '● ▲ ■ ● ▲ ?', options: ['●', '▲', '■', '★'], answer: 2 },
  { prompt: '→ ↑ ← ↓ → ↑ ← ?', options: ['→', '↑', '←', '↓'], answer: 3 },
  { prompt: '↑→↓←  /  →↓←↑  /  ↓←↑?', options: ['↑', '→', '↓', '←'], answer: 1 },
  { prompt: '●■▲  /  ■▲●  /  ▲●?', options: ['▲', '■', '●', '★'], answer: 1 },
  { prompt: '▲●  /  ●▲  /  ▲?', options: ['▲', '●', '■', '★'], answer: 1 },
  { prompt: '· o O ● ?', options: ['⬤', 'o', '●', '·'], answer: 0 },
  { prompt: '● ●● ●●●● ?', options: ['●●●●●', '●●●●●●', '●●●●●●●●', '●●●'], answer: 2 },
  { prompt: '★ ★★★ ★★★★★ ?', options: ['★★★★★★', '★★★★★★★', '★★★★★★★★', '★★'], answer: 1 },
  { prompt: '■ ■■ ■■■ ■■■■■ ?', options: ['■■■■■■', '■■■■■■■', '■■■■■■■■', '■■■■■■■■■■■'], answer: 2 },
  { prompt: '▲▲ ▲▲▲▲ ▲▲▲▲▲▲ ?', options: ['▲▲▲▲▲▲▲', '▲▲▲▲▲▲▲▲', '▲▲▲▲▲▲▲▲▲', '▲▲▲▲▲'], answer: 1 },
  { prompt: '● ● ▲ ● ●  (다른 것을 고르세요 / pick the odd one out)', options: ['●', '▲', '■', '★'], answer: 1 },
  { prompt: '●■▲ / ■▲● / ▲●?', options: ['▲', '■', '●', '★'], answer: 1 },
  { prompt: '● ▲ ● ■ ● ▲ ● ?', options: ['●', '▲', '■', '★'], answer: 2 },
  { prompt: '→ →→ →→→ ?', options: ['→→→→', '→→', '→→→→→', '←←←←'], answer: 0 },
  { prompt: '● ■■ ●●● ■■■■ ?', options: ['●●●●●', '■■■■■', '●●●●', '■■■■■■'], answer: 0 },
  { prompt: '▲▲ ▲▲▲ ▲▲▲▲ / ■■ ■■■ ■■■■ / ●● ●●● ?', options: ['●●●', '●●●●', '●●●●●', '■■■■'], answer: 1 },
  { prompt: '★ ● ▲ ■ ★ ● ▲ ?', options: ['★', '●', '▲', '■'], answer: 3 },
  { prompt: '▲ ▲ ▲▲ ▲▲▲ ▲▲▲▲▲ ?', options: ['▲▲▲▲▲▲', '▲▲▲▲▲▲▲', '▲▲▲▲▲▲▲▲', '▲▲▲▲▲▲▲▲▲'], answer: 2 },
  { prompt: '● ■ ▲ / ▲ ● ■ / ■ ▲ ?', options: ['●', '■', '▲', '★'], answer: 0 },
  { prompt: '● ▲ ■ ★ ◆ ● ▲ ■ ★ ?', options: ['◆', '●', '★', '■'], answer: 0 },
  { prompt: '● ●● ●●● / ■ ■■ ■■■ / ▲ ▲▲ ?', options: ['▲▲', '▲▲▲', '▲▲▲▲', '■■■'], answer: 1 },
  { prompt: '★ ★★ ★★★★ ★★★★★★★★ ?', options: ['★★★★★★★★★★★★★★★★', '★★★★★★★★★★★★', '★★★★★★★★★★', '★★★★★★'], answer: 0 },
  { prompt: '▲ ■ ● / ■ ● ▲ / ● ▲ ?', options: ['▲', '■', '●', '★'], answer: 1 },
  { prompt: '● ■ ● ■ ● ?', options: ['●', '■', '▲', '★'], answer: 1 },
];

// ---- Number sequence items, ordered roughly easy -> hard ----
const NUMBERS = [
  { prompt: '2, 4, 6, 8, ?', options: ['9', '10', '11', '12'], answer: 1 },
  { prompt: '3, 6, 9, 12, ?', options: ['13', '14', '15', '18'], answer: 2 },
  { prompt: '5, 10, 15, 20, ?', options: ['22', '24', '25', '30'], answer: 2 },
  { prompt: '1, 2, 4, 8, ?', options: ['12', '14', '16', '32'], answer: 2 },
  { prompt: '1, 4, 9, 16, ?', options: ['20', '22', '25', '36'], answer: 2 },
  { prompt: '1, 1, 2, 3, 5, ?', options: ['6', '7', '8', '9'], answer: 2 },
  { prompt: '3, 6, 12, 24, ?', options: ['30', '36', '48', '72'], answer: 2 },
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
  { prompt: '2, 5, 11, 23, 47, ?', options: ['89', '93', '94', '95'], answer: 3 },
  { prompt: '6, 11, 21, 41, 81, ?', options: ['151', '159', '160', '161'], answer: 3 },
  { prompt: '1, 3, 6, 10, 15, ?', options: ['18', '19', '20', '21'], answer: 3 },
  { prompt: '5, 6, 8, 11, 15, ?', options: ['18', '19', '20', '21'], answer: 2 },
  { prompt: '2, 4, 8, 16, 32, ?', options: ['48', '56', '64', '96'], answer: 2 },
  { prompt: '1, 2, 6, 24, 120, ?', options: ['480', '600', '720', '840'], answer: 2 },
  { prompt: '9, 16, 25, 36, 49, ?', options: ['56', '60', '63', '64'], answer: 3 },
  { prompt: '1, 4, 10, 22, 46, ?', options: ['88', '90', '92', '94'], answer: 3 },
  { prompt: '3, 4, 7, 11, 18, ?', options: ['25', '27', '28', '29'], answer: 3 },
  { prompt: '2, 9, 28, 65, 126, ?', options: ['197', '207', '217', '227'], answer: 2 },
  { prompt: '1, 2, 4, 7, 11, 16, ?', options: ['20', '21', '22', '23'], answer: 2 },
  { prompt: '5, 15, 30, 50, 75, ?', options: ['95', '100', '105', '110'], answer: 2 },
  { prompt: '13, 17, 19, 23, 29, ?', options: ['27', '29', '30', '31'], answer: 3 },
];

// ---- Verbal items, ordered roughly easy -> hard; en/ko are index-aligned with the same answer index ----
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
    { stem: 'Ocean is to Wave as Desert is to ___?', options: ['Dune', 'Oasis', 'Cactus', 'Mirage'], answer: 0 },
    { stem: 'Choose the opposite of "Frugal".', options: ['Thrifty', 'Wasteful', 'Stingy', 'Modest'], answer: 1 },
    { stem: 'Which word does not belong?', options: ['Whale', 'Dolphin', 'Shark', 'Seal'], answer: 2 },
    { stem: 'Tadpole is to Frog as Caterpillar is to ___?', options: ['Butterfly', 'Cocoon', 'Larva', 'Egg'], answer: 0 },
    { stem: 'Choose the word closest in meaning to "Ambiguous".', options: ['Clear', 'Vague', 'Certain', 'Direct'], answer: 1 },
    { stem: 'Thermometer is to Temperature as Scale is to ___?', options: ['Weight', 'Height', 'Time', 'Sound'], answer: 0 },
    { stem: 'Choose the opposite of "Reluctant".', options: ['Eager', 'Hesitant', 'Unwilling', 'Shy'], answer: 0 },
    { stem: 'Which word does not belong?', options: ['Violin', 'Cello', 'Harp', 'Trumpet'], answer: 3 },
    { stem: 'Sculptor is to Chisel as Painter is to ___?', options: ['Brush', 'Canvas', 'Frame', 'Easel'], answer: 0 },
    { stem: 'Choose the word closest in meaning to "Resilient".', options: ['Fragile', 'Hardy', 'Weak', 'Delicate'], answer: 1 },
    { stem: 'Chapter is to Book as Scene is to ___?', options: ['Play', 'Actor', 'Stage', 'Script'], answer: 0 },
    { stem: 'Choose the opposite of "Verbose".', options: ['Wordy', 'Concise', 'Talkative', 'Lengthy'], answer: 1 },
    { stem: 'Which word does not belong?', options: ['Joy', 'Sorrow', 'Anger', 'Chair'], answer: 3 },
    { stem: 'Scissors is to Cut as Needle is to ___?', options: ['Sew', 'Thread', 'Fabric', 'Pin'], answer: 0 },
    {
      stem: 'All painters are artists. Some artists are musicians. Which of the following could be true?',
      options: ['All painters are musicians', 'Some painters are musicians', 'No artist is a musician', 'All musicians are painters'],
      answer: 1,
    },
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
    { stem: '바다 : 파도 = 사막 : ___?', options: ['모래언덕', '오아시스', '선인장', '신기루'], answer: 0 },
    { stem: '"절약하는"의 반대말은?', options: ['아끼는', '낭비하는', '검소한', '소박한'], answer: 1 },
    { stem: '다른 하나를 고르세요.', options: ['고래', '돌고래', '상어', '물범'], answer: 2 },
    { stem: '올챙이 : 개구리 = 애벌레 : ___?', options: ['나비', '고치', '유충', '알'], answer: 0 },
    { stem: '"모호한"과 가장 가까운 단어는?', options: ['명확한', '애매한', '확실한', '직접적인'], answer: 1 },
    { stem: '온도계 : 온도 = 저울 : ___?', options: ['무게', '키', '시간', '소리'], answer: 0 },
    { stem: '"꺼리는"의 반대말은?', options: ['열망하는', '주저하는', '마지못한', '수줍은'], answer: 0 },
    { stem: '다른 하나를 고르세요.', options: ['바이올린', '첼로', '하프', '트럼펫'], answer: 3 },
    { stem: '조각가 : 끌 = 화가 : ___?', options: ['붓', '캔버스', '액자', '이젤'], answer: 0 },
    { stem: '"회복력이 강한"과 가장 가까운 단어는?', options: ['약한', '강인한', '허약한', '섬세한'], answer: 1 },
    { stem: '장(챕터) : 책 = 장면 : ___?', options: ['연극', '배우', '무대', '대본'], answer: 0 },
    { stem: '"말이 많은"의 반대말은?', options: ['수다스러운', '간결한', '장황한', '긴'], answer: 1 },
    { stem: '다른 하나를 고르세요.', options: ['기쁨', '슬픔', '분노', '의자'], answer: 3 },
    { stem: '가위 : 자르다 = 바늘 : ___?', options: ['꿰매다', '실', '옷감', '핀'], answer: 0 },
    {
      stem: '모든 화가는 예술가다. 일부 예술가는 음악가다. 다음 중 참일 수 있는 것은?',
      options: ['모든 화가는 음악가다', '일부 화가는 음악가다', '어떤 예술가도 음악가가 아니다', '모든 음악가는 화가다'],
      answer: 1,
    },
  ],
};

function buildForm(formIdx) {
  // Each form draws every 3rd item (formIdx, formIdx+3, formIdx+6, ...) from banks ordered
  // easy -> hard, so each 30-question form spans the same difficulty range for fair comparison.
  const items = [];
  for (let k = 0; k < PER_CATEGORY; k++) {
    const i = formIdx + k * 3;
    items.push({ type: 'pattern', ...PATTERNS[i] });
    items.push({ type: 'number', ...NUMBERS[i] });
    items.push({ type: 'verbal', en: VERBAL.en[i], ko: VERBAL.ko[i] });
  }
  return items;
}

const FORMS = ['A', 'B', 'C'].map((name, i) => ({ id: name, items: buildForm(i) }));

// ---- Age-adjusted scoring ----
// Simplified, hand-assumed average accuracy per age band (NOT real normative data).
// Performance on this item style is assumed to rise through youth, peak in the mid-20s/30s,
// then gradually decline — a rough stand-in for the typical fluid-reasoning age curve.
const AGE_BANDS = [
  { max: 9, mean: 0.30, sd: 0.17 },
  { max: 12, mean: 0.38, sd: 0.17 },
  { max: 15, mean: 0.46, sd: 0.16 },
  { max: 17, mean: 0.54, sd: 0.16 },
  { max: 24, mean: 0.60, sd: 0.15 },
  { max: 34, mean: 0.63, sd: 0.15 },
  { max: 44, mean: 0.60, sd: 0.15 },
  { max: 54, mean: 0.56, sd: 0.15 },
  { max: 64, mean: 0.50, sd: 0.16 },
  { max: Infinity, mean: 0.44, sd: 0.17 },
];
const GENERAL_BAND = { mean: 0.55, sd: 0.17 };

function bandFor(age) {
  if (age == null) return GENERAL_BAND;
  for (const b of AGE_BANDS) if (age <= b.max) return b;
  return AGE_BANDS[AGE_BANDS.length - 1];
}

function estimateIQ(correct, total, age) {
  const band = bandFor(age);
  // Continuity correction avoids the extreme z-scores a bare correct/total would give at 0% or 100%.
  const p = (correct + 0.5) / (total + 1);
  const z = (p - band.mean) / band.sd;
  const iq = Math.round(100 + 15 * z);
  return Math.max(40, Math.min(160, iq));
}

function classify(lang, iq) {
  for (const [min, label] of TEXT[lang].classes) {
    if (iq >= min) return label;
  }
  return TEXT[lang].classes[TEXT[lang].classes.length - 1][1];
}

// ---- App state & rendering ----
const state = { lang: 'ko', age: '', formIdx: null, idx: 0, selected: null, answers: [], startedAt: 0 };

const root = document.getElementById('app');

function t() { return TEXT[state.lang]; }

function parsedAge() {
  const n = parseInt(state.age, 10);
  return Number.isFinite(n) && n >= 1 && n <= 120 ? n : null;
}

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

  const ageRow = el('div', { class: 'age-row' }, [
    el('label', { for: 'ageInput' }, tt.ageLabel),
    el('input', {
      id: 'ageInput', type: 'number', inputmode: 'numeric', min: '1', max: '120',
      placeholder: tt.agePlaceholder, value: state.age,
      oninput: (e) => { state.age = e.target.value; },
    }),
  ]);
  wrap.appendChild(ageRow);
  wrap.appendChild(el('p', { class: 'age-note' }, tt.ageNote));

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
  wrap.appendChild(el('div', { class: 'type-tag' }, tt.typeLabel[item.type]));

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
  const age = parsedAge();
  const iq = estimateIQ(correct, total, age);
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
    el('div', { class: 'iq-age' }, tt.ageUsedLabel(age)),
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
