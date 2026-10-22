// 자산 대시보드: 환율(USD/KRW) · 미국 주요 ETF 시세 · 비과세 지방채/CD 매력도 판단
// 환율·ETF·미국채 벤치마크는 전부 실시간 자동 조회. 지방채·브로커드 CD 개별 매물은
// 로그인 전용이라 전체목록을 자동으로 가져올 free API가 없어서, 대신 미국채 수익률을
// 자동으로 가져와 "지금 사도 될 수준인지" 판단 기준을 계산해줌 (수동 입력 없음).
// 투자 판단에 대한 책임은 사용자 본인에게 있음 (참고용, 투자 조언 아님).
(() => {
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const LS = {
  get(k, d) { try { const v = localStorage.getItem("findash." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("findash." + k, JSON.stringify(v)); } catch {} }
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmt = (n, d = 2) => Number(n).toLocaleString("ko-KR", { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtInt = (n) => Math.round(n).toLocaleString("ko-KR");

let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

function setUpdated(text) { $("#updatedAt").textContent = text; }
function nowLabel() { return new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }); }

// ---------- 네트워크: 지정 시간 내 응답 없으면 포기, 여러 소스를 순서대로 시도 ----------
function fetchJSON(url, ms = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal, cache: "no-store" })
    .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .finally(() => clearTimeout(t));
}
function fetchText(url, ms = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal, cache: "no-store" })
    .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
    .finally(() => clearTimeout(t));
}
// 소스 여러 개를 동시에 시도해 가장 먼저 성공하는 응답을 채택(순서대로 기다리면 전부 실패 시 대기시간이 합산되어 너무 길어짐)
function raceOk(tasks) {
  return new Promise((resolve, reject) => {
    let pending = tasks.length;
    const errs = [];
    tasks.forEach(t => {
      Promise.resolve().then(t).then(resolve, e => {
        errs.push((e && e.message) || String(e));
        pending--;
        if (pending === 0) reject(new Error(errs.join(" / ")));
      });
    });
  });
}
// tiers: [[같은 단계 소스...], [다음 단계 소스...], ...]. 한 단계 안에서는 동시에 시도하고,
// 그 단계가 전부 실패해야만 다음 단계로 넘어감(직접호출이 되면 프록시는 아예 타지 않음).
async function fetchFirstOk(tiers, ms = 5000) {
  let lastErr;
  for (const tier of tiers) {
    try { return await raceOk(tier.map(u => () => fetchJSON(u, ms))); }
    catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("모든 소스 실패");
}
async function fetchFirstOkText(tiers, ms = 5000) {
  let lastErr;
  for (const tier of tiers) {
    try { return await raceOk(tier.map(u => () => fetchText(u, ms))); }
    catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("모든 소스 실패");
}
// corsproxy.io는 2024년부터 무료 사용 시 401(가입/키 필요)을 반환해 제외함.
// codetabs/allorigins는 무료·무키로 계속 동작하는 대체 프록시.
function corsProxies(target) {
  return [
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`
  ];
}
// 한꺼번에 너무 많은 요청을 쏘면 브라우저 호스트당 연결 수 제한에 걸려
// 다른 탭의 요청까지 줄서서 느려지므로, 동시 실행 개수를 제한해서 처리
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// =========================================================
// 탭 전환
// =========================================================
const PANES = ["fx", "etf", "muni", "income", "news"];
const TITLES = { fx: "환율", etf: "ETF 시세", muni: "채권", income: "배당·이자 현황", news: "뉴스" };
function showTab(tab) {
  PANES.forEach(p => { $("#pane-" + p).hidden = p !== tab; });
  $$('.tabs button').forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  $("#paneTitle").textContent = TITLES[tab];
  LS.set("lastTab", tab);
  if (tab === "fx" && !fxLoaded) loadFx();
  if (tab === "etf" && !etfLoadedOnce) loadEtf();
  if (tab === "muni" && !benchLoadedFor.muni) loadMuniBench();
  if (tab === "income") loadIncome(); // 수량·채권이 다른 탭에서 바뀔 수 있어 볼 때마다 다시 계산(조회는 재사용)
  if (tab === "news" && !newsLoadedOnce) loadNews();
}
$$('.tabs button').forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));

// =========================================================
// 1) 환율 (USD → KRW), frankfurter.app (무료/무키/CORS) + open.er-api.com (보조)
// =========================================================
let fxLoaded = false;
const paneFx = $("#pane-fx");
const FX_PERIODS = ["1w", "1m", "6m", "1y", "3y"];
const FX_PERIOD_DAYS = { "1w": 7, "1m": 30, "6m": 182, "1y": 365, "3y": 1095 };
const FX_PERIOD_LABELS = { "1w": "1주", "1m": "1개월", "6m": "6개월", "1y": "1년", "3y": "3년" };
function fxSkeleton() {
  paneFx.innerHTML = `
    <div class="card" id="fxCard">
      <h2><span class="lbl">USD → KRW</span></h2>
      <div class="status">불러오는 중…</div>
    </div>
    <div class="card">
      <h2>환전 계산기</h2>
      <div class="conv">
        <span>$</span><input id="convUsd" type="number" inputmode="decimal" placeholder="100" step="0.01" value="1">
        <span class="eq">=</span>
        <span class="res" id="convKrwOut">₩ -</span>
      </div>
      <div class="conv">
        <span>₩</span><input id="convKrw" type="number" inputmode="decimal" placeholder="100000" step="1">
        <span class="eq">=</span>
        <span class="res" id="convUsdOut">$ -</span>
      </div>
    </div>
    <div class="row"><button class="btn sm" id="fxRefresh">새로고침</button></div>
    <p class="disclaim">환율은 중간시장가(mid-market) 기준 참고용입니다. 실제 송금·환전 시 은행/증권사 스프레드가 더해집니다.</p>
  `;
  $("#fxRefresh").addEventListener("click", () => loadFx(true));
  $("#convUsd").addEventListener("input", () => convertFrom("usd"));
  $("#convKrw").addEventListener("input", () => convertFrom("krw"));
}
let fxRate = null;
function convertFrom(side) {
  if (!fxRate) return;
  if (side === "usd") {
    const v = parseFloat($("#convUsd").value);
    $("#convKrwOut").textContent = isFinite(v) ? "₩ " + fmtInt(v * fxRate) : "₩ -";
  } else {
    const v = parseFloat($("#convKrw").value);
    $("#convUsdOut").textContent = isFinite(v) ? "$ " + fmt(v / fxRate) : "$ -";
  }
}
function sparkSVG(values, w = 300, h = 44) {
  if (!values || values.length < 2) return "";
  const min = Math.min(...values), max = Math.max(...values);
  const span = (max - min) || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / span) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const up = values[values.length - 1] >= values[0];
  const color = up ? "var(--up)" : "var(--down)";
  return `<svg class="spark big" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}
function fmtDateShort(iso) {
  const [y, m, d] = iso.split("-");
  return `${y}.${m}.${d}`;
}
let fxPeriod = LS.get("fxPeriod", "1m");
// frankfurter.app이 특정 네트워크에서 막히는 경우를 대비해 Yahoo Finance(USDKRW=X)로 환율+차트 대체 조회
function yahooFxUrls() {
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/USDKRW=X?interval=1d&range=5y`;
  const target2 = `https://query2.finance.yahoo.com/v8/finance/chart/USDKRW=X?interval=1d&range=5y`;
  return [[target, target2], corsProxies(target)];
}
async function fetchFxHistoryYahoo(backDate) {
  const json = await fetchFirstOk(yahooFxUrls(), 5000);
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  const closes = r && r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close;
  if (!r || !r.timestamp || !closes) throw new Error("no yahoo fx data");
  const days = [], history = [];
  r.timestamp.forEach((ts, i) => {
    const c = closes[i];
    if (c == null) return;
    const d = new Date(ts * 1000);
    if (d >= backDate) { days.push(d.toISOString().slice(0, 10)); history.push(c); }
  });
  if (!history.length) throw new Error("빈 응답");
  return { days, history };
}
// frankfurter·Yahoo가 둘 다 막힌 환경용 마지막 수단: jsDelivr CDN(진단에서 유일하게 확실히 열려 있던 호스트)에
// 날짜별로 올라가 있는 환율 파일(@fawazahmed0/currency-api@YYYY-MM-DD)을 하루씩 모아 차트를 만든다.
// 파일 하나가 하루치라 기간이 길면 요청이 많아지므로 최대 ~60개 지점만 샘플링.
async function fetchFxHistoryJsdelivr(backDate, today) {
  const totalDays = Math.max(1, Math.round((today - backDate) / 86400000));
  const step = Math.max(1, Math.ceil(totalDays / 60));
  const dates = [];
  for (let d = new Date(backDate); d <= today; d = new Date(d.getTime() + step * 86400000)) dates.push(d.toISOString().slice(0, 10));
  const todayIso = today.toISOString().slice(0, 10);
  if (dates[dates.length - 1] !== todayIso) dates.push(todayIso);
  const points = await mapWithConcurrency(dates, 6, async date => {
    try {
      const j = await fetchJSON(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.min.json`, 5000);
      const v = j && j.usd && j.usd.krw;
      return v != null ? { date, v } : null;
    } catch { return null; } // 주말·휴일 등 그 날짜 파일이 없으면 건너뜀
  });
  const ok = points.filter(Boolean);
  if (ok.length < 2) throw new Error("jsDelivr 날짜별 파일 없음");
  return { days: ok.map(p => p.date), history: ok.map(p => p.v) };
}
function fxCacheSave(data) { LS.set("fxLast", { ...data, at: Date.now() }); }
async function loadFx(force) {
  fxLoaded = true;
  const card = $("#fxCard");
  card.innerHTML = `<h2><span class="lbl">USD → KRW</span></h2><div class="status">불러오는 중…</div>`;
  try {
    const today = new Date();
    const back = new Date(today.getTime() - FX_PERIOD_DAYS[fxPeriod] * 86400000);
    const iso = d => d.toISOString().slice(0, 10);
    let rate = null, days = [], history = [], prevRate = null;
    const errs = [];
    // 1단계: 과거 기록이 있는 소스(frankfurter 기간, Yahoo FX)를 동시에 시도해 먼저 응답하는 쪽 채택.
    // 1.5초 안에 아무도 응답 못 하면(이 사용자 환경처럼 둘 다 막힌 경우) jsDelivr 날짜별 파일 조립을
    // 같이 출발시킴 — 정상 환경에선 frankfurter가 0.2초 안에 끝나 jsDelivr 요청은 아예 안 나감
    try {
      const rangeTimeout = 5000 + FX_PERIOD_DAYS[fxPeriod] * 5; // 기간이 길수록(최대 3년) 응답이 커서 느릴 수 있어 타임아웃을 넉넉히 둠
      let settled = false;
      const r = await raceOk([
        async () => {
          await new Promise(res => setTimeout(res, 1500));
          if (settled) throw new Error("skip");
          return fetchFxHistoryJsdelivr(back, today);
        },
        async () => {
          const series = await fetchJSON(`https://api.frankfurter.app/${iso(back)}..${iso(today)}?from=USD&to=KRW`, rangeTimeout);
          const d = Object.keys(series.rates || {}).sort();
          const h = d.map(x => series.rates[x].KRW);
          if (!h.length) throw new Error("빈 응답");
          return { days: d, history: h };
        },
        async () => {
          const yf = await fetchFxHistoryYahoo(back);
          if (!yf.history.length) throw new Error("빈 응답");
          return yf;
        }
      ]).finally(() => { settled = true; });
      days = r.days; history = r.history;
      rate = history[history.length - 1];
      prevRate = history.length > 1 ? history[history.length - 2] : null;
    } catch (e) { errs.push("기간 조회: " + e.message); }
    // 2단계: 1단계가 모두 실패했을 때만, 현재가만이라도 동시에 여러 소스에서 시도
    if (rate == null) {
      try {
        rate = await raceOk([
          async () => { const cur = await fetchJSON(`https://api.frankfurter.app/latest?from=USD&to=KRW`); const v = cur.rates && cur.rates.KRW; if (v == null) throw new Error("빈 응답"); return v; },
          async () => { const alt = await fetchJSON(`https://open.er-api.com/v6/latest/USD`); const v = alt.rates && alt.rates.KRW; if (v == null) throw new Error("빈 응답"); return v; },
          async () => { const alt2 = await fetchJSON(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json`); const v = alt2.usd && alt2.usd.krw; if (v == null) throw new Error("빈 응답"); return v; }
        ]);
      } catch (e) { errs.push("현재가 조회: " + e.message); }
    }
    if (rate == null) { const err = new Error("환율 조회 실패"); err.detail = errs.join(" / "); throw err; }
    const data = { rate, days, history, prevRate, period: fxPeriod };
    fxCacheSave(data);
    renderFx(card, data, "");
    setUpdated(nowLabel() + " 업데이트");
  } catch (e) {
    // 전부 실패해도 마지막으로 성공했던 값이 있으면 그걸 보여줌(빈 화면보다 낫다)
    const cached = LS.get("fxLast", null);
    if (cached && cached.rate != null) {
      const ago = Math.round((Date.now() - cached.at) / 60000);
      const agoText = ago < 60 ? ago + "분 전" : ago < 1440 ? Math.round(ago / 60) + "시간 전" : Math.round(ago / 1440) + "일 전";
      renderFx(card, cached, `지금은 조회가 안 돼서 마지막 성공값(${agoText}, ${FX_PERIOD_LABELS[cached.period] || ""} 기준)을 보여드려요. 새로고침으로 다시 시도.`);
      toast("환율 실시간 조회 실패 — 마지막 값 표시");
      return;
    }
    card.innerHTML = `
      <h2><span class="lbl">USD → KRW</span></h2>
      <div class="status err">환율 조회 실패. 네트워크를 확인하고 새로고침 해주세요.</div>
      ${e.detail ? `<div class="small" style="margin-top:8px;word-break:break-all">실패 원인: ${escapeHtml(e.detail)}</div>` : ""}
    `;
    toast("환율 조회 실패");
  }
}
function renderFx(card, { rate, days, history, prevRate, period }, staleNote) {
  fxRate = rate;
  const periodLabel = FX_PERIOD_LABELS[period] || FX_PERIOD_LABELS[fxPeriod];
  const chg = prevRate != null ? rate - prevRate : null;
  const chgPct = prevRate != null ? (chg / prevRate) * 100 : null;
  const hasChart = history.length > 2;
  const hi = hasChart ? Math.max(...history) : null;
  const lo = hasChart ? Math.min(...history) : null;
  const periodChg = hasChart ? ((history[history.length - 1] - history[0]) / history[0]) * 100 : null;
  card.innerHTML = `
    <h2><span class="lbl">USD → KRW</span></h2>
    ${staleNote ? `<div class="status err" style="margin-bottom:6px">${escapeHtml(staleNote)}</div>` : ""}
    <div class="fxRate">
      <span class="num">₩${fmt(rate)}</span>
      ${chg != null ? `<span class="chg ${chg >= 0 ? "pos" : "neg"}">${chg >= 0 ? "▲" : "▼"} ${fmt(Math.abs(chg))} (${fmt(Math.abs(chgPct))}%) 전일대비</span>` : ""}
    </div>
    <div class="fxSub">1 USD 기준 · 중간시장가 참고용</div>
    <div class="segrow" id="fxPeriodRow">
      ${FX_PERIODS.map(p => `<button class="seg" data-p="${p}" aria-pressed="${p === fxPeriod}">${FX_PERIOD_LABELS[p]}</button>`).join("")}
    </div>
    ${hasChart ? `
      <div class="chartMeta">
        <span>고 ₩${fmt(hi)}</span>
        <span class="${periodChg >= 0 ? "pos" : "neg"}">${periodLabel} ${periodChg >= 0 ? "▲" : "▼"} ${fmt(Math.abs(periodChg))}%</span>
        <span>저 ₩${fmt(lo)}</span>
      </div>
      ${sparkSVG(history, 320, 110)}
      <div class="chartDates"><span>${fmtDateShort(days[0])}</span><span>${fmtDateShort(days[days.length - 1])}</span></div>
    ` : `<div class="small" style="margin-top:8px">차트 데이터를 가져오지 못했습니다.</div>`}
  `;
  $$("#fxPeriodRow .seg").forEach(b => b.addEventListener("click", () => {
    fxPeriod = b.dataset.p;
    LS.set("fxPeriod", fxPeriod);
    loadFx(true);
  }));
  convertFrom("usd"); convertFrom("krw");
}

// =========================================================
// 2) ETF 시세 (Yahoo Finance chart API, 무키 — 실패 시 대체 경로)
// =========================================================
const DEFAULT_ETFS = [
  "BST", "GLDM", "GOOGL", "IAU", "LLY", "MGK", "MSFT", "NVDA", "QQQ", "QQQM",
  "SCHP", "SGOV", "SMH", "SUB", "TSLA", "VOO", "VTES", "VXUS",
  "ARKG", "BOTZ", "CQQQ", "IXN", "MCHI", "SIVR", "SPCX", "XOVR"
];
// 기본 종목 목록을 실제 보유 종목으로 교체(2026-10-19) — 이미 저장된 사용자 데이터를 한 번만 덮어씀
const ETF_DEFAULTS_VERSION = 2;
if (LS.get("etfDefaultsVersion", 1) !== ETF_DEFAULTS_VERSION) {
  LS.set("etfSymbols", DEFAULT_ETFS);
  LS.set("etfDefaultsVersion", ETF_DEFAULTS_VERSION);
}
// 피델리티 포지션 화면(Qty/Avg. Cost)에서 받은 실제 보유수량·매수단가 시딩(2026-10-21)
// 계좌 2개에 겹치는 종목은 수량 합산 + 총매입금액 기준 가중평균단가로 합쳐 하나의 보유현황으로 표시.
const DEFAULT_ETF_QTY = {
  BST: 345.107, GLDM: 800, GOOGL: 165.65, IAU: 660.171, LLY: 35.199, MGK: 418.066,
  MSFT: 240.118, NVDA: 460.166, QQQ: 50.61, QQQM: 308.296, SCHP: 2000, SGOV: 3000,
  SMH: 150.546, SUB: 308, TSLA: 324.174, VOO: 129.637, VTES: 700, VXUS: 310,
  ARKG: 610, BOTZ: 223, CQQQ: 346, IXN: 93, MCHI: 937, SIVR: 375, SPCX: 132, XOVR: 646
};
const DEFAULT_ETF_COST = {
  BST: 48.60, GLDM: 86.08, GOOGL: 329.62, IAU: 82.66, LLY: 1116.20, MGK: 92.16,
  MSFT: 478.42, NVDA: 196.72, QQQ: 720.56, QQQM: 304.79, SCHP: 25.71, SGOV: 100.61,
  SMH: 597.18, SUB: 104.58, TSLA: 392.58, VOO: 707.02, VTES: 98.59, VXUS: 87.13,
  ARKG: 32.88, BOTZ: 37.60, CQQQ: 52.04, IXN: 139.49, MCHI: 62.45, SIVR: 73.23, SPCX: 176.86, XOVR: 20.14
};
const ETF_POSITIONS_VERSION = 2;
if (LS.get("etfPositionsVersion", 0) !== ETF_POSITIONS_VERSION) {
  LS.set("etfQty", DEFAULT_ETF_QTY);
  LS.set("etfCost", DEFAULT_ETF_COST);
  LS.set("etfPositionsVersion", ETF_POSITIONS_VERSION);
}
const INDEX_TICKERS = [{ sym: "^GSPC", label: "S&P 500" }, { sym: "^IXIC", label: "나스닥" }];
let etfLoadedOnce = false;
const paneEtf = $("#pane-etf");
function etfSkeleton() {
  const syms = LS.get("etfSymbols", DEFAULT_ETFS);
  paneEtf.innerHTML = `
    <div class="card">
      <h2><span class="lbl">주요 지수</span></h2>
      <div id="indexList"></div>
    </div>
    <div class="card">
      <h2><span class="lbl">주요 미국 ETF</span></h2>
      <div id="etfList"></div>
      <div class="small" id="etfSourceNote" style="margin-top:8px"></div>
      <div class="etfAdd">
        <input id="etfInput" placeholder="예: ARKK" maxlength="6">
        <button class="btn sm" id="etfAddBtn">추가</button>
      </div>
    </div>
    <div class="row"><button class="btn sm" id="etfRefresh">새로고침</button></div>
    <p class="disclaim">15~20분 지연 시세일 수 있으며 참고용입니다. 실제 체결가는 피델리티 앱에서 확인하세요. 보유수량·매수단가를 입력하면 평가액·누적손익이 자동 계산되고, 배당수익률·최근 배당지급 내역도 함께 보여드립니다.</p>
  `;
  renderEtfRows(syms, {});
  renderIndexRows({});
  $("#etfRefresh").addEventListener("click", () => loadEtf(true));
  $("#etfAddBtn").addEventListener("click", addEtfSymbol);
  $("#etfInput").addEventListener("keydown", e => { if (e.key === "Enter") addEtfSymbol(); });
}
// 대체 소스는 전일대비를 안 주는 경우가 있어 null이면 "—"로 표시
function pctCell(pct) {
  if (pct == null || !isFinite(pct)) return `<div class="pc" style="color:var(--muted)">—</div>`;
  const pos = pct >= 0;
  return `<div class="pc ${pos ? "pos" : "neg"}">${pos ? "▲" : "▼"} ${fmt(Math.abs(pct))}%</div>`;
}
function renderIndexRows(data) {
  const box = $("#indexList");
  if (!box) return;
  box.innerHTML = INDEX_TICKERS.map(({ sym, label }, i) => {
    const d = data[sym];
    const base = `style="grid-template-columns:1fr auto auto;${i === 0 ? "border-top:0" : ""}"`;
    if (!d) return `<div class="etfRow" ${base}><div class="sym">${label}</div><div class="px">…</div><div></div></div>`;
    if (d.error) return `<div class="etfRow" ${base}><div class="sym">${label}</div><div class="err">조회 실패</div><div></div></div>`;
    return `<div class="etfRow" ${base}>
      <div class="sym">${label}</div>
      <div class="px">${fmt(d.price)}</div>
      ${pctCell(d.pct)}
    </div>`;
  }).join("");
}
function addEtfSymbol() {
  const inp = $("#etfInput");
  const sym = (inp.value || "").trim().toUpperCase();
  if (!sym || !/^[A-Z0-9.\-]{1,10}$/.test(sym)) { toast("올바른 티커를 입력하세요"); return; }
  const syms = LS.get("etfSymbols", DEFAULT_ETFS);
  if (syms.includes(sym)) { toast("이미 있습니다"); return; }
  syms.push(sym);
  LS.set("etfSymbols", syms);
  inp.value = "";
  inp.blur();
  toast(sym + " 추가됨 — 시세 조회 중");
  loadEtf(true).then(() => {
    const row = $(`#etfList .etfRow[data-sym="${sym}"]`);
    if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}
function removeEtfSymbol(sym) {
  const syms = LS.get("etfSymbols", DEFAULT_ETFS).filter(s => s !== sym);
  LS.set("etfSymbols", syms);
  loadEtf(true);
}
function getEtfQty(sym) { return (LS.get("etfQty", {}) || {})[sym] || ""; }
function setEtfQty(sym, val) {
  const q = LS.get("etfQty", {}) || {};
  const n = parseFloat(val);
  if (val === "" || !isFinite(n)) delete q[sym]; else q[sym] = n;
  LS.set("etfQty", q);
}
function getEtfCost(sym) { return (LS.get("etfCost", {}) || {})[sym] || ""; }
function setEtfCost(sym, val) {
  const c = LS.get("etfCost", {}) || {};
  const n = parseFloat(val);
  if (val === "" || !isFinite(n)) delete c[sym]; else c[sym] = n;
  LS.set("etfCost", c);
}
function renderEtfRows(syms, data) {
  const box = $("#etfList");
  if (!box) return;
  box.innerHTML = syms.map(sym => {
    const s = escapeHtml(sym);
    const d = data[sym];
    const qty = getEtfQty(sym);
    const cost = getEtfCost(sym);
    const qtyRow = `<div class="qtyRow">
      <input class="qtyInput" data-qty="${s}" type="number" step="any" inputmode="decimal" placeholder="보유수량" value="${qty}">
      <input class="qtyInput" data-cost="${s}" type="number" step="any" inputmode="decimal" placeholder="매수단가" value="${cost}">
    </div>`;
    if (!d) return `<div class="etfRow" data-sym="${s}"><div class="sym">${s}</div><div class="px">…</div><div></div>${qtyRow}</div>`;
    if (d.error) return `<div class="etfRow" data-sym="${s}"><div class="sym">${s}</div><div class="err">조회 실패</div><button class="delbtn" data-del="${s}">삭제</button>${qtyRow}</div>`;
    const parts = [];
    if (qty) parts.push(`평가액 $${fmtInt(qty * d.price)}`);
    if (qty && cost) {
      const gain = (d.price - cost) * qty;
      const gainPct = (d.price - cost) / cost * 100;
      parts.push(`누적손익 <span style="color:${gain >= 0 ? "var(--up)" : "var(--down)"}">${gain >= 0 ? "+" : ""}$${fmtInt(gain)} (${gain >= 0 ? "+" : ""}${fmt(gainPct)}%)</span>`);
    }
    if (d.div && d.div.yield != null) parts.push(`배당 ${fmt(d.div.yield)}%${d.div.rate != null ? ` ($${fmt(d.div.rate)}/주)` : ""}`);
    if (qty && d.div && d.div.rate != null) parts.push(`연배당 예상 $${fmtInt(qty * d.div.rate)}`);
    if (d.divHistory && d.divHistory.length) parts.push(`최근 배당 ${d.divHistory[0].date} $${fmt(d.divHistory[0].amount, 3)}/주`);
    return `<div class="etfRow" data-sym="${s}">
      <div class="sym">${s}<button class="delbtn" data-del="${s}" style="margin-left:6px">삭제</button></div>
      <div class="px">$${fmt(d.price)}</div>
      ${pctCell(d.pct)}
      <div class="info">
        <div class="nm">${escapeHtml(d.name || "")}</div>
        ${parts.length ? `<div class="nm" style="color:var(--accent)">${parts.join(" · ")}</div>` : ""}
      </div>
      ${finHtml(d.fin)}
      ${qtyRow}
    </div>`;
  }).join("");
  $$("[data-del]", box).forEach(b => b.addEventListener("click", () => removeEtfSymbol(b.dataset.del)));
  $$("[data-qty]", box).forEach(inp => inp.addEventListener("change", () => {
    setEtfQty(inp.dataset.qty, inp.value);
    renderEtfRows(LS.get("etfSymbols", DEFAULT_ETFS), lastEtfData);
  }));
  $$("[data-cost]", box).forEach(inp => inp.addEventListener("change", () => {
    setEtfCost(inp.dataset.cost, inp.value);
    renderEtfRows(LS.get("etfSymbols", DEFAULT_ETFS), lastEtfData);
  }));
}
let lastEtfData = {};
// ETF는 심볼 여러 개를 동시에 조회하므로 query1/query2를 둘 다 쏘면 호스트당 연결 수가
// 두 배로 늘어 다른 요청이 줄서는 문제가 재발함 — 여기선 직접호출 1개 + 실패 시 프록시 2개만 race
function yahooUrls(symbol) {
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y&events=div`;
  return [[target], corsProxies(target)];
}
async function fetchQuote(symbol) {
  const json = await fetchFirstOk(yahooUrls(symbol), 5000);
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  if (!r || !r.meta) throw new Error("no data");
  const price = r.meta.regularMarketPrice;
  const prev = r.meta.chartPreviousClose ?? r.meta.previousClose;
  if (price == null || prev == null) throw new Error("no price");
  const divEvents = (r.events && r.events.dividends) ? Object.values(r.events.dividends) : [];
  const divHistory = divEvents
    .map(e => ({ date: new Date(e.date * 1000).toISOString().slice(0, 10), amount: e.amount }))
    .sort((a, b) => b.date.localeCompare(a.date)); // 지난 1년 전체 — 배당 탭의 월별 예상 계산에 씀
  return { price, pct: ((price - prev) / prev) * 100, name: r.meta.longName || r.meta.shortName || "", divHistory, fin: pickFin(r.meta) };
}
function quoteSummaryUrls(symbol) {
  const target = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=summaryDetail`;
  return [[target], corsProxies(target)];
}
async function fetchDividend(symbol) {
  const json = await fetchFirstOk(quoteSummaryUrls(symbol), 5000);
  const sd = json && json.quoteSummary && json.quoteSummary.result && json.quoteSummary.result[0] && json.quoteSummary.result[0].summaryDetail;
  if (!sd) throw new Error("no dividend data");
  const y = sd.dividendYield && sd.dividendYield.raw;
  const r = sd.dividendRate && sd.dividendRate.raw;
  const raw = {};
  Object.keys(sd).forEach(k => { raw[k] = sd[k] && typeof sd[k] === "object" && "raw" in sd[k] ? sd[k].raw : sd[k]; });
  const fin = pickFin(raw);
  if (y == null && r == null && !fin) throw new Error("no dividend");
  return { yield: y != null ? y * 100 : null, rate: r != null ? r : null, fin };
}
// 배당 탭도 같은 조회 결과를 쓰므로, 진행 중인 조회 promise를 공유해 두 번 조회하지 않게 함
let etfLoadPromise = null;
function loadEtf() { etfLoadPromise = loadEtfInner(); return etfLoadPromise; }
function ensureEtfLoaded() { return etfLoadPromise || loadEtf(); }
// ---------- Yahoo가 막힌 환경용 대체 시세 소스 ----------
// 이 사용자 환경에선 Yahoo Finance가 직접호출·프록시 모두 실패하는 것으로 보임(ETF·지수·국채 전부 동시 실패).
// CNBC 공개 시세 API(한 번에 여러 심볼, 전일대비·배당률 포함) → Stooq CSV(가격만, 당일 시가 대비) 순으로 시도.
const CNBC_MAP = { "^GSPC": ".SPX", "^IXIC": ".IXIC", "^IRX": "US3M", "^FVX": "US5Y", "^TNX": "US10Y", "^TYX": "US30Y" };
const STOOQ_MAP = { "^GSPC": "^spx", "^IXIC": "^ndq" };
function numLoose(s) { if (s == null) return null; const n = parseFloat(String(s).replace(/[,%+\s]/g, "")); return isFinite(n) ? n : null; }
// 시세 응답에 같이 오는 재무정보 — 소스마다 키 이름이 달라 후보를 넓게 잡음(없으면 null)
function firstVal(obj, keys) { for (const k of keys) { if (obj && obj[k] != null && obj[k] !== "") return obj[k]; } return null; }
function pickFin(q) {
  const fin = {
    hi52: numLoose(firstVal(q, ["yrhiprice", "fiftyTwoWeekHigh", "52WeekHigh", "high52", "yearHigh"])),
    lo52: numLoose(firstVal(q, ["yrloprice", "fiftyTwoWeekLow", "52WeekLow", "low52", "yearLow"])),
    pe: numLoose(firstVal(q, ["pe", "peRatio", "trailingPE", "PE", "pe_ratio"])),
    eps: numLoose(firstVal(q, ["eps", "EPS", "epsTTM", "TTMEPSXCLX"])),
    beta: numLoose(firstVal(q, ["beta", "Beta"])),
    mktcap: firstVal(q, ["mktcapView", "marketCapView", "mktcap", "marketCap", "market_cap"]),
    vol: firstVal(q, ["volume", "regularMarketVolume", "vol"]),
    open: numLoose(firstVal(q, ["open", "regularMarketOpen"])),
    dayHi: numLoose(firstVal(q, ["high", "dayHigh", "regularMarketDayHigh"])),
    dayLo: numLoose(firstVal(q, ["low", "dayLow", "regularMarketDayLow"]))
  };
  if (fin.mktcap != null && typeof fin.mktcap === "object" && "raw" in fin.mktcap) fin.mktcap = fin.mktcap.raw;
  if (fin.vol != null && typeof fin.vol === "object" && "raw" in fin.vol) fin.vol = fin.vol.raw;
  return Object.values(fin).some(v => v != null) ? fin : null;
}
function mergeFin(a, b) {
  const out = { ...(a || {}) };
  Object.entries(b || {}).forEach(([k, v]) => { if (v != null) out[k] = v; }); // null로 기존 값을 지우지 않음
  return Object.keys(out).length ? out : null;
}
function fmtBig(v) {
  if (v == null || v === "") return null;
  if (typeof v === "string" && !/^\s*[\d,.]+\s*$/.test(v)) return v; // "1.23T" 같은 이미 포맷된 문자열
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  if (!isFinite(n)) return null;
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "K";
  return String(n);
}
function finHtml(fin) {
  if (!fin) return "";
  const lines = [];
  if (fin.lo52 != null && fin.hi52 != null) lines.push(`52주 ${fmt(fin.lo52)}–${fmt(fin.hi52)}`);
  const a = [];
  if (fin.mktcap != null && fmtBig(fin.mktcap)) a.push(`시총 $${fmtBig(fin.mktcap)}`);
  if (fin.pe != null) a.push(`PER ${fmt(fin.pe, 1)}`);
  if (a.length) lines.push(a.join(" · "));
  const b = [];
  if (fin.eps != null) b.push(`EPS ${fmt(fin.eps)}`);
  if (fin.beta != null) b.push(`β ${fmt(fin.beta)}`);
  if (fin.vol != null && fmtBig(fin.vol)) b.push(`거래량 ${fmtBig(fin.vol)}`);
  if (b.length) lines.push(b.join(" · "));
  if (fin.dayLo != null && fin.dayHi != null) lines.push(`당일 ${fmt(fin.dayLo)}–${fmt(fin.dayHi)}`);
  return lines.length ? `<div class="fin">${lines.map(escapeHtml).join("<br>")}</div>` : "";
}
async function fetchQuotesCnbc(symbols) {
  const list = symbols.map(s => CNBC_MAP[s] || s);
  const target = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(list.join("|"))}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json`;
  const json = await fetchFirstOk([[target], corsProxies(target)], 8000);
  let arr = json && json.FormattedQuoteResult && json.FormattedQuoteResult.FormattedQuote;
  if (!arr) throw new Error("CNBC 응답 형식 오류");
  if (!Array.isArray(arr)) arr = [arr];
  const out = {};
  symbols.forEach((orig, i) => {
    const q = arr.find(x => x && x.symbol && String(x.symbol).toUpperCase() === list[i].toUpperCase()) || (arr.length === symbols.length ? arr[i] : null);
    const price = q && numLoose(q.last);
    if (price == null) return;
    const rate = numLoose(q.dividend ?? q.dividend_amount ?? q.annual_dividend);
    const yld = numLoose(q.dividendyield ?? q.dividend_yield ?? q.yield);
    out[orig] = { price, pct: numLoose(q.change_pct), name: q.name || "", divHistory: [], src: "CNBC", fin: pickFin(q) };
    if (rate != null || yld != null) out[orig].div = { rate, yield: yld };
  });
  if (!Object.keys(out).length) throw new Error("CNBC 시세 없음");
  return out;
}
async function fetchQuotesStooq(symbols) {
  const list = symbols.map(s => STOOQ_MAP[s] || (s.toLowerCase() + ".us"));
  const target = `https://stooq.com/q/l/?s=${encodeURIComponent(list.join("+"))}&f=sd2t2ohlcv&h&e=csv`;
  const csv = await fetchFirstOkText([[target], corsProxies(target)], 8000);
  const rows = csv.trim().split(/\r?\n/).slice(1).map(l => l.split(","));
  const out = {};
  symbols.forEach((orig, i) => {
    const row = rows.find(r => (r[0] || "").trim().toLowerCase() === list[i].toLowerCase());
    if (!row) return;
    const open = parseFloat(row[3]), close = parseFloat(row[6]);
    if (!isFinite(close)) return;
    out[orig] = { price: close, pct: isFinite(open) && open ? (close - open) / open * 100 : null, name: "", divHistory: [], src: "Stooq(당일 시가 대비)" };
  });
  if (!Object.keys(out).length) throw new Error("Stooq 시세 없음");
  return out;
}
async function fetchQuotesFallback(symbols) {
  const errs = [];
  for (const fn of [fetchQuotesCnbc, fetchQuotesStooq]) {
    try { return await fn(symbols); } catch (e) { errs.push(e.message); }
  }
  throw new Error(errs.join(" / "));
}
let yahooBlocked = false;
let etfSource = "";
function renderEtfSource() { const el = $("#etfSourceNote"); if (el) el.textContent = etfSource ? "시세 출처: " + etfSource : ""; }
async function loadEtfInner() {
  etfLoadedOnce = true;
  const syms = LS.get("etfSymbols", DEFAULT_ETFS);
  renderEtfRows(syms, {});
  renderIndexRows({});
  const data = {};
  const idata = {};
  lastEtfData = data;
  etfSource = ""; renderEtfSource();
  // Yahoo가 아예 막힌 환경에서 26개를 하나씩 10초씩 실패시키지 않도록 첫 종목 하나로 먼저 탐침하고,
  // 대체 소스(CNBC 배치 1회) 조회는 탐침과 동시에 출발시켜 Yahoo가 막혀 있어도 기다리지 않게 함
  const allSyms = [...syms, ...INDEX_TICKERS.map(t => t.sym)];
  const fallbackPromise = fetchQuotesFallback(allSyms).then(g => {
    // 탐침(Yahoo)이 아직 안 끝났으면 대체 소스 값을 먼저 그려서 빈 화면으로 기다리지 않게 함
    let shown = false;
    syms.forEach(s => { if (!data[s] && g[s]) { data[s] = g[s]; shown = true; } });
    INDEX_TICKERS.forEach(t => { if (!idata[t.sym] && g[t.sym]) { idata[t.sym] = g[t.sym]; shown = true; } });
    if (shown) { renderEtfRows(syms, data); renderIndexRows(idata); etfSource = etfSource || [...new Set(Object.values(g).map(x => x.src))].join("/"); renderEtfSource(); }
    return g;
  }).catch(e => ({ __error: e.message }));
  let yahooOk = false;
  if (syms.length) {
    try { data[syms[0]] = await fetchQuote(syms[0]); yahooOk = true; renderEtfRows(syms, data); } catch {}
  }
  yahooBlocked = !yahooOk;
  if (yahooOk) {
    etfSource = "Yahoo";
    await Promise.all([
      mapWithConcurrency(syms.slice(1), 4, async sym => {
        try { data[sym] = await fetchQuote(sym); }
        catch { data[sym] = { error: true }; renderEtfRows(syms, data); return; }
        renderEtfRows(syms, data);
        try { const dv = await fetchDividend(sym); data[sym].div = dv; data[sym].fin = mergeFin(data[sym].fin, dv.fin); renderEtfRows(syms, data); } catch {}
      }),
      mapWithConcurrency(INDEX_TICKERS, 2, async ({ sym }) => {
        try { idata[sym] = await fetchQuote(sym); }
        catch { idata[sym] = { error: true }; }
        renderIndexRows(idata);
      }),
      (async () => { try { const dv = await fetchDividend(syms[0]); data[syms[0]].div = dv; data[syms[0]].fin = mergeFin(data[syms[0]].fin, dv.fin); renderEtfRows(syms, data); } catch {} })()
    ]);
  }
  const failedSyms = syms.filter(s => !data[s] || data[s].error);
  const failedIdx = INDEX_TICKERS.map(t => t.sym).filter(s => !idata[s] || idata[s].error);
  if (failedSyms.length || failedIdx.length) {
    const got = await fallbackPromise;
    if (got.__error) {
      failedSyms.forEach(s => { data[s] = { error: true }; });
      failedIdx.forEach(s => { idata[s] = { error: true }; });
      etfSource = (etfSource ? etfSource + " · " : "") + "대체 소스도 실패: " + got.__error;
    } else {
      failedSyms.forEach(s => { data[s] = got[s] || { error: true }; });
      failedIdx.forEach(s => { idata[s] = got[s] || { error: true }; });
      const srcs = [...new Set(Object.values(got).map(g => g.src))].join("/");
      etfSource = etfSource ? `${etfSource} + ${srcs}(일부)` : srcs;
    }
    renderEtfRows(syms, data);
    renderIndexRows(idata);
  }
  renderEtfSource();
  setUpdated(nowLabel() + " 업데이트");
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// =========================================================
// 3) 미국채 벤치마크 (Yahoo Finance 지수: 3개월/5년/10년/30년) — 지방채·CD·금리 탭 공용
// 브로커드 CD·지방채 개별 매물은 로그인 전용이라 전체목록을 가져올 무료 API가 없음.
// 대신 같은 만기대의 미국채 수익률을 자동으로 가져와 "지금 사도 될 수준인지" 기준을 계산.
// =========================================================
const BENCH_SERIES = [
  { key: "irx", ticker: "^IRX", label: "3개월" },
  { key: "fvx", ticker: "^FVX", label: "5년" },
  { key: "tnx", ticker: "^TNX", label: "10년" },
  { key: "tyx", ticker: "^TYX", label: "30년" }
];
const benchLoadedFor = { muni: false };
let bench = { irx: null, fvx: null, tnx: null, tyx: null, loadedAt: 0 };
async function loadBenchmark(force) {
  if (bench.loadedAt && !force && Date.now() - bench.loadedAt < 5 * 60000) return bench;
  // 4개를 한꺼번에 쏘면(특히 직접호출이 막혀 전부 프록시로 넘어갈 때) CD 탭의 다른 프록시
  // 요청(CD 금리 스크래핑)과 겹쳐 무료 프록시 서비스 쪽에서 과부하로 같이 실패하기 쉬워
  // 동시 처리 개수를 제한
  const next = { loadedAt: Date.now() };
  if (!yahooBlocked) {
    const results = await mapWithConcurrency(BENCH_SERIES, 2, async s => {
      try { return { status: "fulfilled", value: await fetchQuote(s.ticker) }; }
      catch (e) { return { status: "rejected", reason: e }; }
    });
    BENCH_SERIES.forEach((s, i) => { next[s.key] = results[i].status === "fulfilled" ? results[i].value.price : null; });
  }
  // Yahoo가 막혔거나 일부 실패하면 CNBC(US3M/US5Y/US10Y/US30Y)로 보충
  const missing = BENCH_SERIES.filter(s => next[s.key] == null);
  if (missing.length) {
    try {
      const got = await fetchQuotesCnbc(missing.map(s => s.ticker));
      missing.forEach(s => { next[s.key] = got[s.ticker] ? got[s.ticker].price : null; });
    } catch { missing.forEach(s => { next[s.key] = null; }); }
  }
  bench = next;
  return bench;
}

// =========================================================
// 4) 비과세 지방채: "지금 사도 될 만한 수익률인가" 자동 기준선 계산기
// =========================================================
const paneMuni = $("#pane-muni");
// 실제 보유 지방채(2026-10-19 피델리티 포지션 화면에서 받은 데이터로 시딩)
const DEFAULT_MUNI_HOLDINGS = [
  { cusip: "09182TGW1", name: "BLACK BELT ENERGY GAS DIST", coupon: 5.000, maturity: "2035-12-01", face: 85000, price: 100.534 },
  { cusip: "213345MB4", name: "COOK CNTY ILL SCH DIST NO 02", coupon: 5.000, maturity: "2037-12-15", face: 35000, price: 103.54 },
  { cusip: "46247EPP4", name: "IOWA FIN AUTH SINGLE FAMILY", coupon: 4.150, maturity: "2037-07-01", face: 10000, price: 94.738 },
  { cusip: "61212WL29", name: "MONTANA ST BRD HSG SINGLE F", coupon: 4.150, maturity: "2037-06-01", face: 20000, price: 94.438 },
  { cusip: "880443JM9", name: "TENNESSEE ENERGY ACQUISITI", coupon: 5.000, maturity: "2035-12-01", face: 30000, price: 100.534 },
  { cusip: "914729WA2", name: "UNIVERSITY NORTH TEX UNIV R", coupon: 5.000, maturity: "2036-04-15", face: 5000, price: 104.005 }
];
const MUNI_HOLDINGS_VERSION = 1;
if (LS.get("muniHoldingsVersion", 0) !== MUNI_HOLDINGS_VERSION) {
  LS.set("muniHoldings", DEFAULT_MUNI_HOLDINGS);
  LS.set("muniHoldingsVersion", MUNI_HOLDINGS_VERSION);
}
// 지방채·국채 보유현황 공용 컨트롤러 (CUSIP 기준 저장/수정/삭제)
function createBondHoldings(storageKey, defaultData) {
  const load = () => LS.get(storageKey, defaultData);
  return {
    load,
    setPrice(cusip, val) {
      const list = load();
      const h = list.find(x => x.cusip === cusip);
      const n = parseFloat(val);
      if (h && isFinite(n)) { h.price = n; LS.set(storageKey, list); }
    },
    delete(cusip) { LS.set(storageKey, load().filter(x => x.cusip !== cusip)); },
    add(h) { const list = load(); list.push(h); LS.set(storageKey, list); }
  };
}
const muniBonds = createBondHoldings("muniHoldings", DEFAULT_MUNI_HOLDINGS);
// 보유 미국채(국채) — 지방채와 달리 과세대상. 피델리티 포지션 화면에서 받은 데이터로 시딩(2026-10-21)
const DEFAULT_GOV_BOND_HOLDINGS = [
  { cusip: "912810TW8", name: "UNITED STATES TREAS SER BON", coupon: 4.750, maturity: "2043-11-15", face: 230000, price: 92.371 },
  { cusip: "912810TZ1", name: "UNITED STATES TREAS SER BON", coupon: 4.500, maturity: "2044-02-15", face: 107000, price: 89.34 },
  { cusip: "912810UN6", name: "UNITED STATES TREAS SER BON", coupon: 4.875, maturity: "2045-08-15", face: 10000, price: 92.867 }
];
const GOV_BOND_VERSION = 1;
if (LS.get("govBondVersion", 0) !== GOV_BOND_VERSION) {
  LS.set("govBondHoldings", DEFAULT_GOV_BOND_HOLDINGS);
  LS.set("govBondVersion", GOV_BOND_VERSION);
}
const govBonds = createBondHoldings("govBondHoldings", DEFAULT_GOV_BOND_HOLDINGS);
function isoDate(d) { return d.toISOString().slice(0, 10); }
function daysUntil(d) { const t0 = new Date(); const t = new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth(), t0.getUTCDate())); return Math.round((d.getTime() - t.getTime()) / 86400000); }
// 공시된 다음 쿠폰일이 없을 때, 만기 월/일 기준 6개월 간격 지급을 가정해 다음 지급일을 추정
function nextCouponDate(maturityISO) {
  const [, mmStr, mdStr] = maturityISO.split("-");
  const mm = parseInt(mmStr, 10), md = parseInt(mdStr, 10);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const candidates = [];
  for (let yOff = -1; yOff <= 1; yOff++) {
    const y = now.getUTCFullYear() + yOff;
    [[mm, y], [((mm + 5) % 12) + 1, mm + 6 > 12 ? y + 1 : y]].forEach(([m, yy]) => candidates.push(new Date(Date.UTC(yy, m - 1, md))));
  }
  const future = candidates.filter(d => d.getTime() > today.getTime()).sort((a, b) => a - b);
  return future[0] || null;
}
function renderBondHoldings(boxId, ctrl, emptyLabel) {
  const box = $("#" + boxId);
  if (!box) return;
  const list = ctrl.load();
  if (!list.length) { box.innerHTML = `<div class="empty2">${emptyLabel}</div>`; return; }
  const enriched = list.map(h => {
    const nc = nextCouponDate(h.maturity);
    return { ...h, nc, amt: h.face * h.coupon / 100 / 2, mv: h.face * h.price / 100 };
  }).sort((a, b) => (a.nc ? a.nc.getTime() : Infinity) - (b.nc ? b.nc.getTime() : Infinity));
  const totalMv = enriched.reduce((s, h) => s + h.mv, 0);
  const totalAnnual = enriched.reduce((s, h) => s + h.amt * 2, 0);
  box.innerHTML = `
    <div class="bondStats" style="margin:0 0 12px">
      <div><span class="k">연 이자 합계 (세전)</span><span class="v hl">$${fmtInt(totalAnnual)}</span></div>
      <div><span class="k">평가총액 (최근 입력가)</span><span class="v">$${fmtInt(totalMv)}</span></div>
    </div>
    ${enriched.map(h => `
      <div class="bondCard">
        <div class="bondName">${escapeHtml(h.name)}</div>
        <div class="small">CUSIP ${escapeHtml(h.cusip)} · 쿠폰 ${fmt(h.coupon, 3)}% · 만기 ${h.maturity}</div>
        <div class="bondStats">
          <div><span class="k">다음 쿠폰</span><span class="v hl">${h.nc ? fmtDateShort(isoDate(h.nc)) : "-"}${h.nc ? ` (D-${daysUntil(h.nc)})` : ""}</span></div>
          <div><span class="k">쿠폰금액 (반기)</span><span class="v hl">$${fmt(h.amt, 2)}</span></div>
          <div><span class="k">연 이자</span><span class="v hl">$${fmt(h.amt * 2, 2)}</span></div>
          <div><span class="k">평가액</span><span class="v">$${fmtInt(h.mv)}</span></div>
        </div>
        <div class="bondFoot">
          <span class="small">액면 $${fmtInt(h.face)} · 가격</span>
          <input class="qtyInput" data-price="${escapeHtml(h.cusip)}" type="number" step="0.001" value="${h.price}">
          <button class="delbtn" data-del="${escapeHtml(h.cusip)}" style="margin-left:auto">삭제</button>
        </div>
      </div>
    `).join("")}
    <p class="note">쿠폰 지급일은 만기 월·일 기준 6개월 간격 지급을 가정한 추정값입니다(실제와 다를 수 있음). 이자 = 액면가 × 쿠폰금리(세전). 가격은 자동조회가 안 돼서 직접 확인해 가끔 업데이트해주세요.</p>
  `;
  $$("[data-price]", box).forEach(inp => inp.addEventListener("change", () => { ctrl.setPrice(inp.dataset.price, inp.value); renderBondHoldings(boxId, ctrl, emptyLabel); }));
  $$("[data-del]", box).forEach(b => b.addEventListener("click", () => { ctrl.delete(b.dataset.del); renderBondHoldings(boxId, ctrl, emptyLabel); }));
  renderBondIncome();
}
function renderMuniHoldings() { renderBondHoldings("muniHoldBox", muniBonds, "등록된 보유 지방채가 없습니다"); }
function renderGovBondHoldings() { renderBondHoldings("govHoldBox", govBonds, "등록된 보유 국채가 없습니다"); }
// ---- 머니마켓펀드(MMF): 잔액 × 7일 수익률(연)로 월 이자 계산, 월말 지급 가정 ----
// 피델리티 MMF 계좌 캡처(2026-10-22)의 MJMXX 잔액으로 시딩. 수익률은 CNBC 자동 조회 → 실패 시 직접 입력.
const DEFAULT_MMF = { ticker: "MJMXX", name: "JPMorgan Municipal Money Market (Morgan)", balance: 1270013.88, yield: null };
const MMF_VERSION = 1;
if (LS.get("mmfVersion", 0) !== MMF_VERSION) { LS.set("mmf", DEFAULT_MMF); LS.set("mmfVersion", MMF_VERSION); }
let mmfAutoYield = null;
function mmfGet() { return { ...DEFAULT_MMF, ...(LS.get("mmf", {}) || {}) }; }
function mmfYield() { const m = mmfGet(); return Number.isFinite(m.yield) && m.yield > 0 ? m.yield : mmfAutoYield; }
function renderMmf() {
  const card = $("#mmfCard");
  if (!card) return;
  const m = mmfGet();
  const y = mmfYield();
  const manual = Number.isFinite(m.yield) && m.yield > 0;
  const monthly = y != null ? m.balance * y / 100 / 12 : null;
  card.innerHTML = `
    <h2><span class="lbl">머니마켓펀드 (MMF)</span></h2>
    <div class="bondName">${escapeHtml(m.ticker)} <span class="small" style="font-weight:400">${escapeHtml(m.name)}</span></div>
    <div class="bondStats">
      <div><span class="k">월 이자 예상</span><span class="v hl">${monthly != null ? "$" + fmtInt(monthly) : "—"}</span></div>
      <div><span class="k">연 이자 예상</span><span class="v hl">${monthly != null ? "$" + fmtInt(monthly * 12) : "—"}</span></div>
      <div><span class="k">잔액 ($)</span><input class="qtyInput" id="mmfBalance" type="number" step="0.01" inputmode="decimal" value="${m.balance}"></div>
      <div><span class="k">7일 수익률 (연 %)</span><input class="qtyInput" id="mmfYield" type="number" step="0.01" inputmode="decimal" placeholder="${mmfAutoYield != null ? "자동 " + fmt(mmfAutoYield) : "직접 입력"}" value="${manual ? m.yield : ""}"></div>
    </div>
    <p class="note">${y == null ? "수익률을 자동으로 못 가져왔어요 — 피델리티 MMF 화면의 7-day yield를 입력해주세요." : (manual ? "직접 입력한 수익률 기준." : "CNBC에서 가져온 수익률 기준(직접 입력하면 그 값을 우선).")} 이자는 매일 쌓여 월말에 지급된다고 가정. 지방채 MMF라 연방세 면제.</p>
  `;
  $("#mmfBalance").addEventListener("change", e => { const v = parseFloat(e.target.value); if (isFinite(v) && v >= 0) { LS.set("mmf", { ...mmfGet(), balance: v }); renderMmf(); renderBondIncome(); } });
  $("#mmfYield").addEventListener("change", e => { const v = parseFloat(e.target.value); LS.set("mmf", { ...mmfGet(), yield: isFinite(v) && v > 0 ? v : null }); renderMmf(); renderBondIncome(); });
}
// ---- 받은 이자(월별): 보유 시작일 이후 지급일이 지난 쿠폰·MMF 이자를 "받은 것"으로 집계 ----
function bondIncomeEvents(start, end) {
  const events = [];
  [[muniBonds, "muni"], [govBonds, "gov"]].forEach(([ctrl, kind]) => ctrl.load().forEach(h => {
    const half = h.face * h.coupon / 100 / 2;
    couponDatesInWindow(h.maturity, start, end).forEach(d => events.push({ date: d, amount: half, kind, label: h.name }));
  }));
  const y = mmfYield();
  const m = mmfGet();
  if (y != null && m.balance > 0) {
    for (let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)); d < end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0))) {
      if (d >= start) events.push({ date: d, amount: m.balance * y / 100 / 12, kind: "mmf", label: m.ticker });
    }
  }
  return events.sort((a, b) => a.date - b.date);
}
function renderBondIncome() {
  const card = $("#bondIncomeCard");
  if (!card) return;
  const start = holdStartDate();
  const today = todayUTC();
  const yearEnd = new Date(Date.UTC(today.getUTCFullYear() + 1, 0, 1));
  const end = yearEnd > start ? yearEnd : addMonthsUTC(start, 12);
  const events = bondIncomeEvents(start, end);
  const thisYear = today.getUTCFullYear();
  const recYear = events.filter(e => e.date <= today && e.date.getUTCFullYear() === thisYear).reduce((s, e) => s + e.amount, 0);
  const upYear = events.filter(e => e.date > today && e.date.getUTCFullYear() === thisYear).reduce((s, e) => s + e.amount, 0);
  const months = [];
  for (let m = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); m < end; m = addMonthsUTC(m, 1)) {
    const key = monthKey(m);
    const evs = events.filter(e => monthKey(e.date) === key);
    months.push({ key, future: m > today, total: evs.reduce((s, e) => s + e.amount, 0), events: evs });
  }
  const max = Math.max(1, ...months.map(x => x.total));
  const kindLabel = { muni: "지방채", gov: "국채", mmf: "MMF" };
  card.innerHTML = `
    <h2><span class="lbl">받은 이자 (월별, 세전)</span></h2>
    <div class="incGrid">
      <div><span class="k">${thisYear}년 받은 누계</span><span class="v" style="color:var(--accent);font-weight:700">$${fmtInt(recYear)}</span></div>
      <div><span class="k">${thisYear}년 남은 예정</span><span class="v">$${fmtInt(upYear)}</span></div>
      <div><span class="k">${thisYear}년 합계</span><span class="v">$${fmtInt(recYear + upYear)}</span></div>
    </div>
    <div class="row" style="margin:10px 0 4px;align-items:center;gap:8px"><span class="small">보유 시작일</span><input class="qtyInput" id="holdStartInput" type="date" value="${holdStartISO()}"></div>
    ${months.map(x => `<div class="incRow"${x.future ? ' style="opacity:.6"' : ""}>
      <div class="m">${x.key}${x.future ? `<br><span style="font-size:10px">예정</span>` : ""}</div>
      <div class="incBar"><i style="width:${Math.round(x.total / max * 100)}%"></i></div>
      <div class="amt">$${fmtInt(x.total)}</div>
      ${x.events.length ? `<div class="incSub">${x.events.map(e => `${fmtDateShort(isoDate(e.date)).slice(5)} ${kindLabel[e.kind]} ${escapeHtml(e.label)} $${fmtInt(e.amount)}`).join(" · ")}</div>` : ""}
    </div>`).join("")}
    <p class="note">실제 입금 내역이 아니라 쿠폰 일정(만기 월·일 기준 반기 지급 가정)과 MMF 월말 지급 가정으로 계산한 값입니다. 보유 시작일 이후 지급일이 지난 건을 "받은 것"으로 칩니다.</p>
  `;
  $("#holdStartInput").addEventListener("change", e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { LS.set("holdStart", e.target.value); renderBondIncome(); } });
}
function muniSkeleton() {
  paneMuni.innerHTML = `
    <div class="card">
      <h2>보유 지방채</h2>
      <div id="muniHoldBox"></div>
      <div class="row" style="margin-top:10px"><button class="btn sm" id="muniHoldAddBtn">+ 종목 추가</button></div>
      <div class="logform" id="muniHoldForm">
        <input id="hName" placeholder="종목명">
        <div class="two">
          <input id="hCusip" placeholder="CUSIP" maxlength="9" style="text-transform:uppercase">
          <input id="hMaturity" type="date" placeholder="만기일">
        </div>
        <div class="two">
          <input id="hCoupon" type="number" step="0.001" placeholder="쿠폰금리(%)">
          <input id="hFace" type="number" step="1" placeholder="액면가($)">
        </div>
        <div class="two">
          <input id="hPrice" type="number" step="0.001" placeholder="현재가(100당)">
          <button class="btn sm primary" id="hSave">저장</button>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>보유 국채 (미국채, 과세대상)</h2>
      <div id="govHoldBox"></div>
      <div class="row" style="margin-top:10px"><button class="btn sm" id="govHoldAddBtn">+ 종목 추가</button></div>
      <div class="logform" id="govHoldForm">
        <input id="gName" placeholder="종목명">
        <div class="two">
          <input id="gCusip" placeholder="CUSIP" maxlength="9" style="text-transform:uppercase">
          <input id="gMaturity" type="date" placeholder="만기일">
        </div>
        <div class="two">
          <input id="gCoupon" type="number" step="0.001" placeholder="쿠폰금리(%)">
          <input id="gFace" type="number" step="1" placeholder="액면가($)">
        </div>
        <div class="two">
          <input id="gPrice" type="number" step="0.001" placeholder="현재가(100당)">
          <button class="btn sm primary" id="gSave">저장</button>
        </div>
      </div>
      <p class="note">지방채와 달리 이자소득이 연방·주 소득세 모두 과세대상입니다(주세는 면제인 경우가 많음).</p>
    </div>
    <div class="card" id="mmfCard"></div>
    <div class="card" id="bondIncomeCard"></div>
    <div class="card" id="muniRateCard">
      <h2><span class="lbl">지방채 ETF 수익률</span></h2>
      <div class="status">불러오는 중…</div>
    </div>
    <div class="card" id="treasCard">
      <h2><span class="lbl">국채 고시 금리</span></h2>
      <div class="status">불러오는 중…</div>
    </div>
    <div class="row"><button class="btn sm" id="muniRefresh">금리 새로고침</button></div>
    <p class="disclaim">국채 금리는 미 재무부가 매 영업일 고시하는 수익률 곡선, 지방채 수익률은 딜러 공개 자료 기준입니다. 개별 지방채 매물은 <a href="https://www.fidelity.com/fixed-income-bonds/municipal-bonds" target="_blank" rel="noopener">피델리티 지방채 화면 ↗</a>에서 확인해주세요.</p>
  `;
  $("#muniRefresh").addEventListener("click", () => loadMuniBench(true));
  $("#muniHoldAddBtn").addEventListener("click", () => $("#muniHoldForm").classList.toggle("open"));
  $("#hSave").addEventListener("click", () => {
    const name = $("#hName").value.trim();
    const cusip = $("#hCusip").value.trim().toUpperCase();
    const coupon = parseFloat($("#hCoupon").value);
    const face = parseFloat($("#hFace").value);
    const price = parseFloat($("#hPrice").value);
    const maturity = $("#hMaturity").value;
    if (!name || !cusip || !isFinite(coupon) || !isFinite(face) || !isFinite(price) || !maturity) {
      toast("모든 항목을 입력하세요"); return;
    }
    muniBonds.add({ cusip, name, coupon, maturity, face, price });
    ["hName", "hCusip", "hMaturity", "hCoupon", "hFace", "hPrice"].forEach(id => $("#" + id).value = "");
    $("#muniHoldForm").classList.remove("open");
    renderMuniHoldings();
  });
  $("#govHoldAddBtn").addEventListener("click", () => $("#govHoldForm").classList.toggle("open"));
  $("#gSave").addEventListener("click", () => {
    const name = $("#gName").value.trim();
    const cusip = $("#gCusip").value.trim().toUpperCase();
    const coupon = parseFloat($("#gCoupon").value);
    const face = parseFloat($("#gFace").value);
    const price = parseFloat($("#gPrice").value);
    const maturity = $("#gMaturity").value;
    if (!name || !cusip || !isFinite(coupon) || !isFinite(face) || !isFinite(price) || !maturity) {
      toast("모든 항목을 입력하세요"); return;
    }
    govBonds.add({ cusip, name, coupon, maturity, face, price });
    ["gName", "gCusip", "gMaturity", "gCoupon", "gFace", "gPrice"].forEach(id => $("#" + id).value = "");
    $("#govHoldForm").classList.remove("open");
    renderGovBondHoldings();
  });
  renderMuniHoldings();
  renderGovBondHoldings();
  renderMmf();
  renderBondIncome();
}
// 미 재무부 고시 일별 수익률 곡선(CSV, 최신 영업일이 첫 줄). 막히면 Yahoo/CNBC 벤치마크(3개월·5년·10년·30년)로 대체
const TREASURY_TENORS = [["1 Mo", "1개월"], ["3 Mo", "3개월"], ["6 Mo", "6개월"], ["1 Yr", "1년"], ["2 Yr", "2년"], ["5 Yr", "5년"], ["10 Yr", "10년"], ["20 Yr", "20년"], ["30 Yr", "30년"]];
async function fetchTreasuryOfficial() {
  const y = new Date().getUTCFullYear();
  for (const year of [y, y - 1]) { // 연초엔 올해 파일이 비어 있을 수 있어 작년도 시도
    const target = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
    let csv;
    try { csv = await fetchFirstOkText([[target], corsProxies(target)], 8000); } catch (e) { if (year === y - 1) throw e; continue; }
    const lines = csv.trim().split(/\r?\n/);
    if (lines.length < 2) continue;
    const clean = l => l.split(",").map(x => x.replace(/"/g, "").trim());
    const header = clean(lines[0]);
    const row = clean(lines[1]);
    const rates = {};
    header.forEach((h, i) => { const v = parseFloat(row[i]); if (i > 0 && isFinite(v)) rates[h] = v; });
    if (!Object.keys(rates).length) continue;
    return { date: row[0], rates, src: "미 재무부 고시" };
  }
  throw new Error("재무부 금리표 없음");
}
// 지방채는 국채처럼 정부가 고시하는 금리가 없음(딜러 공개 AAA 곡선 스크래핑은 사용자 환경에서 타임아웃돼 제거).
// 사용자 요청대로 처음부터 대표 지방채 ETF의 분배율(지난 12개월 분배금 ÷ 가격)을 보여줌 — ETF 탭과 같은 시세 경로.
const MUNI_ETFS = [
  { sym: "SUB", label: "단기 국가 지방채 (iShares)" },
  { sym: "VTES", label: "단기 비과세 채권 (Vanguard)" },
  { sym: "MUB", label: "국가 지방채 전체 (iShares)" },
  { sym: "VTEB", label: "비과세 채권 전체 (Vanguard)" },
  { sym: "HYD", label: "하이일드 지방채 (VanEck)" }
];
let muniEtfData = null, muniEtfErr = "";
async function fetchMuniEtfYields() {
  const syms = MUNI_ETFS.map(m => m.sym);
  let got = {};
  if (!yahooBlocked) { // Yahoo가 되는 환경이면 종목별 조회(배당률은 quoteSummary) 시도
    await mapWithConcurrency(syms, 2, async s => {
      try { const q = await fetchQuote(s); try { q.div = await fetchDividend(s); } catch {} got[s] = q; } catch {}
    });
  }
  const missing = syms.filter(s => !got[s] || !got[s].div);
  if (missing.length) {
    try { const alt = await fetchQuotesFallback(missing); missing.forEach(s => { if (alt[s]) got[s] = alt[s]; }); } catch (e) { if (!Object.keys(got).length) throw e; }
  }
  const rows = MUNI_ETFS.map(m => ({ ...m, q: got[m.sym] })).filter(r => r.q);
  if (!rows.length) throw new Error("지방채 ETF 시세 없음");
  return rows;
}
function renderMuniCurve() {
  const card = $("#muniRateCard");
  if (!card) return;
  if (!muniEtfData) {
    card.innerHTML = `<h2><span class="lbl">지방채 ETF 수익률</span></h2><div class="status err">가져오지 못했습니다${muniEtfErr ? ` (${escapeHtml(muniEtfErr)})` : ""}. 새로고침 해주세요.</div>`;
    return;
  }
  card.innerHTML = `
    <h2><span class="lbl">지방채 ETF 수익률</span></h2>
    <div class="small" style="margin-bottom:4px">지난 12개월 분배금 ÷ 현재가 · 연 %, 연방세 면제</div>
    ${muniEtfData.map((r, i) => `<div class="etfRow" style="grid-template-columns:1fr auto;${i === 0 ? "border-top:0" : ""}">
      <div><div class="sym">${r.sym}</div><div class="nm">${escapeHtml(r.label)} · $${fmt(r.q.price)}</div></div>
      <div class="px">${r.q.div && r.q.div.yield != null ? fmt(r.q.div.yield) + "%" : "—"}</div>
    </div>`).join("")}
    <p class="note">지방채는 국채처럼 정부가 고시하는 금리가 없어서, 대표 지방채 ETF의 분배율을 기준으로 보여줍니다. 만기수익률(YTM)과는 다른 참고치이고, 개별 매물 수익률은 등급·발행처에 따라 다릅니다.</p>
  `;
}
let treasuryData = null;
function renderTreasury() {
  const card = $("#treasCard");
  if (!card) return;
  if (!treasuryData) {
    card.innerHTML = `<h2><span class="lbl">국채 고시 금리</span></h2><div class="status err">금리를 가져오지 못했습니다. 새로고침 해주세요.</div>`;
    return;
  }
  const rows = treasuryData.rows.filter(r => r.val != null);
  card.innerHTML = `
    <h2><span class="lbl">국채 고시 금리</span></h2>
    <div class="small" style="margin-bottom:4px">${escapeHtml(treasuryData.src)}${treasuryData.date ? ` · ${escapeHtml(treasuryData.date)} 기준` : ""} · 연 %</div>
    ${rows.map((r, i) => `<div class="etfRow" style="grid-template-columns:1fr auto;${i === 0 ? "border-top:0" : ""}"><div class="sym">${r.label}</div><div class="px">${fmt(r.val)}%</div></div>`).join("")}
  `;
}
async function loadMuniBench(force) {
  benchLoadedFor.muni = true;
  fetchMuniEtfYields().then(rows => { muniEtfData = rows; muniEtfErr = ""; renderMuniCurve(); }).catch(e => { muniEtfData = null; muniEtfErr = e.message; renderMuniCurve(); });
  // MMF 7일 수익률 자동 조회(CNBC의 dividendyield) — 재무부 금리표와 동시에 진행
  fetchQuotesCnbc([mmfGet().ticker]).then(q => {
    const d = q[mmfGet().ticker] && q[mmfGet().ticker].div;
    if (d && d.yield != null && d.yield > 0) { mmfAutoYield = d.yield; renderMmf(); renderBondIncome(); }
  }).catch(() => {});
  try {
    const t = await fetchTreasuryOfficial();
    treasuryData = { src: t.src, date: t.date, rows: TREASURY_TENORS.map(([k, label]) => ({ label, val: t.rates[k] ?? null })) };
  } catch {
    try {
      const b = await loadBenchmark(force);
      const rows = BENCH_SERIES.map(s => ({ label: s.label, val: b[s.key] }));
      treasuryData = rows.some(r => r.val != null) ? { src: "시세 소스(Yahoo/CNBC) 기준", date: "", rows } : null;
    } catch { treasuryData = null; }
  }
  renderTreasury();
  setUpdated(nowLabel() + " 업데이트");
}

// =========================================================
// 5) 배당 현황: 보유 주식·ETF 배당만(지난 1년 실제 지급 내역 기준 예상). 채권 이자는 채권 탭에서 계산.
// =========================================================
const paneIncome = $("#pane-income");
const DEFAULT_HOLD_START = "2026-09-01"; // 사용자: "올해 9월부터 보유했다고 가정"
function holdStartISO() { return LS.get("holdStart", DEFAULT_HOLD_START); }
function holdStartDate() { const [y, m, d] = holdStartISO().split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function todayUTC() { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())); }
function monthKey(d) { return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`; }
function addMonthsUTC(d, n) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate())); }
// 만기 월/일 기준 6개월 간격 쿠폰일 중 [start, end) 구간에 드는 날짜들(만기 이후는 제외)
function couponDatesInWindow(maturityISO, start, end) {
  const [my, mm, md] = maturityISO.split("-").map(Number);
  const maturity = new Date(Date.UTC(my, mm - 1, md));
  const out = [];
  for (let y = start.getUTCFullYear() - 1; y <= end.getUTCFullYear() + 1; y++) {
    [mm, ((mm + 5) % 12) + 1].forEach(m => {
      const d = new Date(Date.UTC(y, m - 1, md));
      if (d >= start && d < end && d <= maturity) out.push(d);
    });
  }
  return out.sort((a, b) => a - b);
}
function incomeSkeleton() {
  paneIncome.innerHTML = `
    <div class="card" id="incSummary"><h2><span class="lbl">보유 주식·ETF 예상 배당 (세전)</span></h2><div class="status">불러오는 중…</div></div>
    <div class="card" id="incMonths"><h2><span class="lbl">앞으로 12개월 월별 예상</span></h2><div class="status">불러오는 중…</div></div>
    <div class="card" id="incSources"><h2><span class="lbl">종목별 연간 예상</span></h2><div class="status">불러오는 중…</div></div>
    <div class="row"><button class="btn sm" id="incRefresh">새로고침</button></div>
    <p class="disclaim">지난 1년 실제 배당 지급 내역(날짜·주당 금액)이 다음 1년에도 그대로 반복된다고 가정하고 보유수량을 곱한 추정치입니다(세전). 지급 내역을 못 가져온 종목은 연배당률을 12개월로 나눠 추정. 수량은 ETF 탭에서 고칠 수 있고, 채권 이자는 채권 탭에서 따로 계산합니다.</p>
  `;
  $("#incRefresh").addEventListener("click", () => loadIncome(true));
}
function computeIncome(etfData) {
  const today = todayUTC();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const end = addMonthsUTC(start, 12);
  const holdStart = holdStartDate();
  const events = [];
  const sources = [];
  let etfFailed = 0, noHistory = 0, receivedYear = 0;
  LS.get("etfSymbols", DEFAULT_ETFS).forEach(sym => {
    const qty = parseFloat(getEtfQty(sym));
    if (!qty) return;
    const d = etfData[sym];
    if (!d || d.error) { etfFailed++; return; }
    const hist = (d.divHistory || []).filter(e => e.amount > 0);
    if (hist.length) {
      hist.forEach(e => {
        const [y, m, dd] = e.date.split("-").map(Number);
        const paid = new Date(Date.UTC(y, m - 1, dd));
        if (paid >= holdStart && paid <= today && paid.getUTCFullYear() === today.getUTCFullYear()) receivedYear += e.amount * qty;
        const proj = new Date(Date.UTC(y + 1, m - 1, dd));
        if (proj >= start && proj < end) events.push({ date: proj, amount: e.amount * qty, label: sym });
      });
      const perShare = hist.reduce((s, e) => s + e.amount, 0);
      const n = hist.length;
      const freq = n >= 11 ? "월배당" : n >= 4 ? "분기배당" : n === 2 ? "반기배당" : n === 1 ? "연 1회" : `연 ${n}회`;
      sources.push({ label: sym, annual: perShare * qty, detail: `${freq} · 주당 연 $${fmt(perShare, 3)} × ${qty}주` });
    } else if (d.div && d.div.rate) {
      noHistory++;
      for (let i = 0; i < 12; i++) events.push({ date: addMonthsUTC(start, i), amount: d.div.rate * qty / 12, label: sym });
      sources.push({ label: sym, annual: d.div.rate * qty, detail: `연배당 $${fmt(d.div.rate)}/주 × ${qty}주 (월 균등 추정)` });
    }
  });
  const months = [];
  for (let i = 0; i < 12; i++) {
    const key = monthKey(addMonthsUTC(start, i));
    const evs = events.filter(e => monthKey(e.date) === key).sort((a, b) => a.date - b.date);
    months.push({ key, total: evs.reduce((s, e) => s + e.amount, 0), events: evs });
  }
  return { months, sources: sources.filter(s => s.annual > 0).sort((a, b) => b.annual - a.annual), etfFailed, noHistory, receivedYear };
}
// ---- 배당 지급 내역 대체 소스(Yahoo가 막힌 환경용): stockanalysis.com 배당 페이지(정적 HTML, 프록시 경유), 7일 캐시 ----
function parseDateLoose(s) {
  const d = new Date(String(s).trim());
  if (isNaN(d)) return null;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
}
function parseDividendTable(html) {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(html))) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => c[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim());
    if (cells.length < 2) continue;
    const exDate = parseDateLoose(cells[0]);
    if (!exDate) continue;
    const amtCell = cells.find((c, i) => i > 0 && /^\$?\d[\d,]*\.?\d*$/.test(c));
    const amount = amtCell ? parseFloat(amtCell.replace(/[$,]/g, "")) : NaN;
    if (!isFinite(amount) || amount <= 0) continue;
    const payDate = cells.slice(1).map(parseDateLoose).filter(Boolean).pop(); // 마지막 날짜 칸이 지급일(있으면)
    rows.push({ date: payDate || exDate, amount });
  }
  return rows;
}
async function fetchDividendHistoryAlt(sym) {
  const cacheKey = "divHist." + sym;
  const c = LS.get(cacheKey, null);
  if (c && Date.now() - c.at < 7 * 86400000) return c.rows;
  const s = sym.toLowerCase();
  let rows = null, lastErr = null, fetched = false;
  for (const path of [`etf/${s}`, `stocks/${s}`]) {
    const target = `https://stockanalysis.com/${path}/dividend/`;
    try {
      const html = await fetchFirstOkText([corsProxies(target)], 10000);
      fetched = true;
      const r = parseDividendTable(html);
      if (r.length) { rows = r; break; }
    } catch (e) { lastErr = e; }
  }
  if (!rows) {
    if (!fetched) throw lastErr || new Error("배당 내역 없음");
    rows = []; // 페이지는 받았는데 배당표가 없음 = 무배당 종목(금 ETF 등)으로 간주, 실패 아님
  }
  const cutoff = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  rows = rows.filter(r => r.date >= cutoff).sort((a, b) => b.date.localeCompare(a.date));
  LS.set(cacheKey, { at: Date.now(), rows });
  return rows;
}
// 시세가 대체 소스(CNBC/Stooq)에서 온 종목은 지급 내역이 없으므로 stockanalysis에서 채움
let divAltStatus = { done: 0, total: 0, failed: [], running: false };
async function fillDividendHistoryAlt(etfData, onProgress) {
  const syms = LS.get("etfSymbols", DEFAULT_ETFS).filter(s => parseFloat(getEtfQty(s)) && etfData[s] && !etfData[s].error && etfData[s].src && !(etfData[s].divHistory || []).length);
  divAltStatus = { done: 0, total: syms.length, failed: [], running: syms.length > 0 };
  if (!syms.length) return;
  await mapWithConcurrency(syms, 3, async sym => {
    try {
      const rows = await fetchDividendHistoryAlt(sym);
      const yearAgo = new Date(Date.now() - 366 * 86400000).toISOString().slice(0, 10);
      etfData[sym].divHistory = rows.filter(r => r.date >= yearAgo);
      etfData[sym].divSrc = "stockanalysis";
    } catch (e) { divAltStatus.failed.push(`${sym}: ${e.message}`); }
    divAltStatus.done++;
    onProgress();
  });
  divAltStatus.running = false;
  onProgress();
}
function renderIncome(etfData, pending) {
  const r = computeIncome(etfData);
  const total12 = r.months.reduce((s, m) => s + m.total, 0);
  const notes = [];
  if (pending) notes.push("시세·배당 정보 불러오는 중…");
  if (divAltStatus.running) notes.push(`배당 지급 내역 조회 중… ${divAltStatus.done}/${divAltStatus.total} (stockanalysis)`);
  if (!pending && r.etfFailed) notes.push(`<span style="color:var(--danger)">${r.etfFailed}개 종목 시세 조회 실패 — 그 종목 배당은 빠져 있어요.</span>`);
  if (!pending && !divAltStatus.running && r.noHistory) notes.push(`${r.noHistory}개 종목은 지급 내역을 못 가져와 연배당률 ÷ 12로 추정했어요.`);
  if (!divAltStatus.running && divAltStatus.failed.length) notes.push(`<span style="color:var(--danger)">배당 내역 조회 실패 ${divAltStatus.failed.length}개: ${escapeHtml(divAltStatus.failed.slice(0, 3).join(" / "))}${divAltStatus.failed.length > 3 ? " …" : ""}</span>`);
  if (!pending && !divAltStatus.running && !r.sources.length && !r.etfFailed) notes.push(`<span style="color:var(--danger)">배당 데이터를 하나도 못 가져왔어요. 시세 출처: ${escapeHtml(etfSource || "없음")}</span>`);
  $("#incSummary").innerHTML = `
    <h2><span class="lbl">보유 주식·ETF 예상 배당 (세전)</span></h2>
    <div class="incBig">$${fmtInt(total12 / 12)}<span class="small" style="margin-left:6px;color:var(--muted)">/월 평균</span></div>
    <div class="incGrid">
      <div><span class="k">12개월 합계</span><span class="v">$${fmtInt(total12)}</span></div>
      <div><span class="k">이번 달</span><span class="v">$${fmtInt(r.months[0].total)}</span></div>
      <div><span class="k">다음 달</span><span class="v">$${fmtInt(r.months[1].total)}</span></div>
    </div>
    <div class="incGrid" style="grid-template-columns:1fr">
      <div><span class="k">올해 받은 배당 (${fmtDateShort(holdStartISO())} 보유 시작 가정, 지급 내역 기준)</span><span class="v">$${fmtInt(r.receivedYear)}</span></div>
    </div>
    ${notes.length ? `<div class="small" style="margin-top:8px">${notes.join("<br>")}</div>` : ""}
  `;
  const max = Math.max(1, ...r.months.map(m => m.total));
  $("#incMonths").innerHTML = `
    <h2><span class="lbl">앞으로 12개월 월별 예상</span></h2>
    ${r.months.map(m => `<div class="incRow">
        <div class="m">${m.key}</div>
        <div class="incBar"><i style="width:${Math.round(m.total / max * 100)}%"></i></div>
        <div class="amt">$${fmtInt(m.total)}</div>
        ${m.events.length ? `<div class="incSub">${m.events.map(e => `${escapeHtml(e.label)} $${fmtInt(e.amount)}`).join(" · ")}</div>` : ""}
      </div>`).join("")}
  `;
  $("#incSources").innerHTML = `
    <h2><span class="lbl">종목별 연간 예상</span></h2>
    ${r.sources.length ? r.sources.map((s, i) => `<div class="etfRow" style="grid-template-columns:1fr auto;${i === 0 ? "border-top:0" : ""}">
      <div><div class="sym">${escapeHtml(s.label)}</div><div class="nm">${escapeHtml(s.detail)}</div></div>
      <div class="px" style="text-align:right">$${fmtInt(s.annual)}<div class="small">월 $${fmtInt(s.annual / 12)}</div></div>
    </div>`).join("") : `<div class="small">${pending ? "불러오는 중…" : "배당 정보가 있는 보유 종목이 없습니다. ETF 탭에서 보유수량을 확인해주세요."}</div>`}
  `;
}
let divAltPromise = null, divAltFor = null;
async function loadIncome(force) {
  if (!etfLoadedOnce || force) renderIncome(lastEtfData, true);
  try { await (force ? loadEtf() : ensureEtfLoaded()); } catch {}
  if (force) LS.get("etfSymbols", DEFAULT_ETFS).forEach(s => LS.set("divHist." + s, null));
  const data = lastEtfData;
  if (!divAltPromise || divAltFor !== data) { // 시세가 새로 조회됐으면(새 data 객체) 배당 내역도 다시 채움
    divAltFor = data;
    divAltPromise = fillDividendHistoryAlt(data, () => { renderIncome(data, false); renderEtfRows(LS.get("etfSymbols", DEFAULT_ETFS), data); });
  }
  renderIncome(data, false); // fillDividendHistoryAlt가 진행 상태를 먼저 세팅하므로 "조회 중" 안내가 바로 보임
  await divAltPromise;
  setUpdated(nowLabel() + " 업데이트");
}

// =========================================================
// 6) 주요 뉴스 피드 (RSS, CORS 프록시 경유)
// =========================================================
const NEWS_FEEDS = [
  { name: "CNBC", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
  { name: "MarketWatch", url: "https://feeds.marketwatch.com/marketwatch/topstories/" },
  { name: "Yahoo Finance", url: "https://finance.yahoo.com/news/rssindex" }
];
const paneNews = $("#pane-news");
const NEWS_LIMIT = 15;
function newsSkeleton() {
  paneNews.innerHTML = `
    <div class="card"><h2><span class="lbl">주요 경제·시장 뉴스</span></h2><div id="newsList"><div class="status">불러오는 중…</div></div></div>
    <div class="row"><button class="btn sm" id="newsRefresh">새로고침</button></div>
    <p class="disclaim">CNBC·MarketWatch·Yahoo Finance의 공개 RSS 피드를 모아 한글로 요약·번역해 보여줍니다(자동번역, 부정확할 수 있음). 원문이 궁금하면 "원문" 링크를 누르세요.</p>
  `;
  $("#newsRefresh").addEventListener("click", () => loadNews(true));
}
async function fetchFeed(url, ms = 5000) {
  const tiers = [[url], corsProxies(url)];
  const xml = await fetchFirstOkText(tiers, ms);
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("feed parse error");
  return doc;
}
function stripHtml(s) { return s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function parseRssItems(doc, sourceName, limit = 10) {
  return Array.from(doc.querySelectorAll("item")).slice(0, limit).map(item => ({
    title: (item.querySelector("title")?.textContent || "").trim(),
    description: stripHtml(item.querySelector("description")?.textContent || "").slice(0, 220),
    link: (item.querySelector("link")?.textContent || "#").trim(),
    pubDate: (item.querySelector("pubDate")?.textContent || "").trim(),
    source: sourceName
  })).filter(it => it.title);
}
function timeAgo(pubDateStr) {
  const d = new Date(pubDateStr);
  if (isNaN(d)) return "";
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return diffMin + "분 전";
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return diffH + "시간 전";
  return Math.round(diffH / 24) + "일 전";
}
// 번역 소스 두 곳(구글 비공식 엔드포인트 + MyMemory, 둘 다 무료/무키/CORS 허용)을 동시에 시도하고,
// 둘 다 직접호출이 막혔을 때만 구글 쪽을 프록시로 재시도
async function translateToKo(text) {
  if (!text) return "";
  const gTarget = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&q=${encodeURIComponent(text)}`;
  const mTarget = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|ko`;
  const parseGoogle = json => { if (!Array.isArray(json) || !Array.isArray(json[0])) throw new Error("구글 번역 응답 형식 오류"); return json[0].map(seg => seg[0]).join(""); };
  const parseMyMemory = json => { const t = json && json.responseData && json.responseData.translatedText; if (!t) throw new Error("MyMemory 응답 형식 오류"); return t; };
  try {
    return await raceOk([
      () => fetchJSON(gTarget, 6000).then(parseGoogle),
      () => fetchJSON(mTarget, 6000).then(parseMyMemory)
    ]);
  } catch (e) {
    return await raceOk(corsProxies(gTarget).map(u => () => fetchJSON(u, 6000).then(parseGoogle)));
  }
}
function newsCardHtml(it, idx) {
  return `
    <div class="newsCard" id="newsCard${idx}">
      <div class="newsKo" id="newsKo${idx}">번역 중…</div>
      <div class="newsEn">${escapeHtml(it.title)}</div>
      ${it.description ? `<div class="newsDesc" id="newsDesc${idx}" hidden></div>` : ""}
      <div class="newsMeta">${escapeHtml(it.source)} · ${timeAgo(it.pubDate)} · <a href="${escapeHtml(it.link)}" target="_blank" rel="noopener">원문 ↗</a></div>
    </div>
  `;
}
let newsLoadedOnce = false;
async function loadNews(force) {
  if (newsLoadedOnce && !force) return;
  newsLoadedOnce = true;
  const box = $("#newsList");
  box.innerHTML = `<div class="status">불러오는 중…</div>`;
  const results = await Promise.allSettled(NEWS_FEEDS.map(f => fetchFeed(f.url).then(doc => parseRssItems(doc, f.name))));
  let items = [];
  const errs = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") items = items.concat(r.value);
    else errs.push(NEWS_FEEDS[i].name + ": " + r.reason.message);
  });
  if (!items.length) {
    box.innerHTML = `<div class="status err">뉴스를 가져오지 못했습니다. 새로고침 해주세요.</div><div class="small" style="margin-top:6px;word-break:break-all">${escapeHtml(errs.join(" / "))}</div>`;
    return;
  }
  items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  items = items.slice(0, NEWS_LIMIT);
  box.innerHTML = items.map(newsCardHtml).join("");
  setUpdated(nowLabel() + " 업데이트");
  // 기사 수만큼 동시에 번역을 쏘면(최대 15개 x 제목/본문 2건) 같은 호스트에 연결이
  // 몰려 브라우저 연결 제한에 걸려 전부 실패하는 걸 막기 위해 동시 처리 개수를 제한
  mapWithConcurrency(items, 3, async (it, idx) => {
    try {
      const ko = await translateToKo(it.title);
      const el = $("#newsKo" + idx);
      if (el) el.textContent = ko;
    } catch { const el = $("#newsKo" + idx); if (el) el.textContent = it.title; }
    if (it.description) {
      try {
        const koDesc = await translateToKo(it.description);
        const el = $("#newsDesc" + idx);
        if (el) { el.textContent = koDesc; el.hidden = false; }
      } catch {}
    }
  });
}

// =========================================================
// 초기화
// =========================================================
fxSkeleton(); etfSkeleton(); muniSkeleton(); incomeSkeleton(); newsSkeleton();
const lastTab = LS.get("lastTab", "fx");
showTab(PANES.includes(lastTab) ? lastTab : "fx"); // 없어진 탭(cd)이 저장돼 있을 수 있음

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
})();
