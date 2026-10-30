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
const PANES = ["home", "fx", "etf", "muni", "income", "news"];
const TITLES = { home: "내 자산", fx: "환율", etf: "ETF 시세", muni: "채권", income: "배당·이자 현황", news: "뉴스" };
function showTab(tab) {
  PANES.forEach(p => { $("#pane-" + p).hidden = p !== tab; });
  $$('.tabs button').forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  $("#paneTitle").textContent = TITLES[tab];
  LS.set("lastTab", tab);
  if (tab === "fx" && !fxLoaded) loadFx();
  if (tab === "etf" && !etfLoadedOnce) loadEtf();
  if (tab === "muni" && !benchLoadedFor.muni) loadMuniBench();
  if (tab === "income") loadIncome(); // 수량·채권이 다른 탭에서 바뀔 수 있어 볼 때마다 다시 계산(조회는 재사용)
  if (tab === "home") loadHome();
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
// 개인 보유 데이터(수량·단가·계좌)는 코드에 넣지 않음 — 공개 저장소라 누구나 볼 수 있음. 모든 보유 정보는 기기의 localStorage에만 저장되고
// CSV 가져오기·직접 입력·백업 파일 복원으로 채움. 아래 기본 목록은 처음 설치 시 보여줄 일반 예시 종목일 뿐.
const DEFAULT_ETFS = ["VOO", "QQQ", "SCHD", "VTI", "VXUS", "BND"];
// 버전 플래그는 유지: 이미 데이터가 있는 기기에서는 아래 블록이 실행되지 않아 기존 데이터가 그대로 남음
const ETF_DEFAULTS_VERSION = 2;
if (LS.get("etfDefaultsVersion", 1) !== ETF_DEFAULTS_VERSION) {
  LS.set("etfSymbols", DEFAULT_ETFS);
  LS.set("etfDefaultsVersion", ETF_DEFAULTS_VERSION);
}
const ETF_POSITIONS_VERSION = 2;
if (LS.get("etfPositionsVersion", 0) !== ETF_POSITIONS_VERSION) {
  if (!LS.get("etfQty", null)) LS.set("etfQty", {});
  if (!LS.get("etfCost", null)) LS.set("etfCost", {});
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
    const lb = `<button class="symBtn" data-chart="${escapeHtml(sym)}" data-label="${escapeHtml(label)}">${label}</button>`;
    if (!d) return `<div class="etfRow" ${base}><div class="sym">${lb}</div><div class="px">…</div><div></div></div>`;
    if (d.error) return `<div class="etfRow" ${base}><div class="sym">${lb}</div><div class="err">조회 실패</div><div></div></div>`;
    return `<div class="etfRow" ${base}>
      <div class="sym">${lb}</div>
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
// ---------- 계좌 구분: 개인 계좌와 LLC 계좌가 섞여 있어 종목·채권·MMF마다 계좌를 붙이고, 소유(개인/LLC)별로 묶어 봄 ----------
const ACCOUNTS = [
  { key: "fid_p", label: "피델리티 개인", owner: "personal" },
  { key: "fid_llc", label: "피델리티 LLC", owner: "llc" },
  { key: "rh", label: "로빈후드", owner: "personal" },
  { key: "chase", label: "체이스(JPM MMF)", owner: null } // 소유자는 MMF 카드에서 선택(chaseOwner)
];
const OWNER_LABEL = { personal: "개인", llc: "LLC" };
// 현금 계좌(체이스 체킹 등): 자산 탭 카드에서 잔고·소유를 직접 입력. key는 "cash:<id>"
// 처음 설치 시 기본 행 하나만(잔고 0). 실제 잔고는 기기에만 저장.
const DEFAULT_CASH = [{ id: "cash1", label: "체킹 계좌", balance: 0, owner: "personal", apy: 0 }];
const CASH_VERSION = 3;
// 티커가 있는 현금성 계좌(SPAXX 등)는 MMF와 같은 방식으로 7일 수익률을 자동 조회(직접 입력한 이자율이 우선)
const cashAutoYield = LS.get("cashYieldAuto", {}) || {};
function cashApy(c) { if (c.apy > 0) return c.apy; const a = c.ticker && cashAutoYield[c.ticker]; return a && a.yield > 0 && Date.now() - a.at < 30 * 86400000 ? a.yield : null; }
async function loadCashYields() {
  const need = cashList().filter(c => c.ticker && !(c.apy > 0) && cashApy(c) == null);
  if (!need.length) return false;
  let changed = false;
  await Promise.all([...new Set(need.map(c => c.ticker))].map(async t => {
    try { const r = await fetchMmfYieldAuto(t); cashAutoYield[t] = { yield: r.yield, src: r.src, at: Date.now() }; changed = true; } catch {}
  }));
  if (changed) LS.set("cashYieldAuto", cashAutoYield);
  return changed;
}
if (LS.get("cashVersion", 0) !== CASH_VERSION) { // 버전이 오르면 없는 계좌만 추가(사용자가 고친 잔고는 유지)
  const cur = LS.get("cash", null) || [];
  if (!cur.length) DEFAULT_CASH.forEach(d => cur.push({ ...d }));
  LS.set("cash", cur); LS.set("cashVersion", CASH_VERSION);
}
function cashList() { return LS.get("cash", DEFAULT_CASH); }
// ---------- "언제 기준" 표시: 시세는 실시간이지만 보유수량·잔고·채권가격은 마지막으로 입력/가져온 시점 기준 ----------
// 키: "acct:<계좌>"(보유수량·단가), "bond:<CUSIP>"(채권 가격), "mmf", "cash:<id>". 처음 값은 사용자가 보낸 캡처 날짜로 시딩.
const DEFAULT_ASOF = { "acct:fid_p": "2026-10-21", "acct:fid_llc": "2026-10-21", "mmf": "2026-10-22", "cash:chase_chk": "2026-10-22", "cash:rh_cash": "2026-10-22", "cash:fid_spaxx": "2026-10-22" };
const STALE_DAYS = 7;
function asOfGet(key) {
  const v = (LS.get("asOf", {}) || {})[key];
  if (v) return v;
  const d = DEFAULT_ASOF[key];
  return d ? new Date(d + "T12:00:00").getTime() : null;
}
function markAsOf(...keys) { const a = LS.get("asOf", {}) || {}; keys.filter(Boolean).forEach(k => { a[k] = Date.now(); }); LS.set("asOf", a); }
function asOfDays(ms) { const d0 = new Date(ms); d0.setHours(0, 0, 0, 0); const d1 = new Date(); d1.setHours(0, 0, 0, 0); return Math.round((d1 - d0) / 86400000); }
// 짧은 표시: "10.21 기준 · 7일 전" (STALE_DAYS 이상이면 빨간색 + 갱신 필요)
function asOfText(ms, prefix = "") {
  if (!ms) return `<span style="color:var(--muted)">${prefix}기준일 없음</span>`;
  const d = new Date(ms), n = asOfDays(ms);
  const rel = n <= 0 ? "오늘" : n === 1 ? "어제" : n + "일 전";
  const stale = n >= STALE_DAYS;
  return `<span style="color:${stale ? "var(--danger)" : "var(--muted)"}">${prefix}${d.getMonth() + 1}.${d.getDate()} 기준 · ${rel}${stale ? " · 갱신 필요" : ""}</span>`;
}
function acctAsOfKey(key) { return key === "chase" ? "mmf" : key && key.startsWith("cash:") ? key : key && key !== "none" ? "acct:" + key : null; }
function acctOwner(key) {
  if (key && key.startsWith("cash:")) { const c = cashList().find(x => "cash:" + x.id === key); return c ? c.owner : null; }
  const a = ACCOUNTS.find(x => x.key === key); if (!a) return null; return a.owner || LS.get("chaseOwner", "personal");
}
function acctLabel(key) {
  if (key && key.startsWith("cash:")) { const c = cashList().find(x => "cash:" + x.id === key); return c ? c.label : "현금"; }
  const a = ACCOUNTS.find(x => x.key === key); return a ? a.label : "구분 없음";
}
function acctOptions(selected) { return `<option value=""${!selected ? " selected" : ""}>구분 없음</option>${ACCOUNTS.map(a => `<option value="${a.key}"${a.key === selected ? " selected" : ""}>${a.label}</option>`).join("")}`; }
// ETF·주식은 계좌별 수량/매입금액을 따로 저장(etfByAcct)하고, 기존 총수량(etfQty)·단가(etfCost)는 그 합으로 유지
function etfByAcctAll() { return LS.get("etfByAcct", {}) || {}; }
function etfByAcctGet(sym) { return etfByAcctAll()[sym] || null; }
function etfByAcctSet(sym, map) {
  const all = etfByAcctAll();
  const clean = {};
  Object.entries(map || {}).forEach(([k, p]) => { if (p && p.qty > 0) clean[k] = { qty: p.qty, costTotal: p.costTotal != null && isFinite(p.costTotal) ? p.costTotal : null }; });
  if (Object.keys(clean).length) all[sym] = clean; else delete all[sym];
  LS.set("etfByAcct", all);
}
function etfRecomputeTotals(sym) {
  const m = etfByAcctGet(sym);
  if (!m) return;
  let q = 0, c = 0, hasC = true;
  Object.values(m).forEach(p => { q += p.qty; if (p.costTotal != null) c += p.costTotal; else hasC = false; });
  setEtfQty(sym, q);
  if (hasC && q) setEtfCost(sym, Math.round(c / q * 100) / 100);
}
function etfQtyForOwner(sym, owner) {
  const m = etfByAcctGet(sym);
  if (!m) return null;
  let q = 0;
  Object.entries(m).forEach(([k, p]) => { if (acctOwner(k) === owner) q += p.qty; });
  return q;
}
function etfAcctSummary(sym) { const m = etfByAcctGet(sym); return m ? Object.entries(m).map(([k, p]) => `${acctLabel(k)} ${fmt(p.qty, 3)}`).join(" · ") : ""; }
// 총수량/단가를 손으로 고쳤을 때: 계좌가 하나면 그 계좌에 그대로 반영, 여러 개면 어느 계좌인지 알 수 없어 구분을 지움
function syncEtfSplitAfterManual(sym) {
  const m = etfByAcctGet(sym);
  if (!m) return;
  const keys = Object.keys(m);
  const q = parseFloat(getEtfQty(sym)) || 0;
  const c = parseFloat(getEtfCost(sym));
  if (keys.length === 1) etfByAcctSet(sym, q > 0 ? { [keys[0]]: { qty: q, costTotal: isFinite(c) ? c * q : null } } : null);
  else { etfByAcctSet(sym, null); toast(sym + " 계좌 구분이 지워졌어요 — CSV로 다시 가져오면 복원돼요"); }
}
function renderEtfRows(syms, data) {
  const box = $("#etfList");
  if (!box) return;
  box.innerHTML = syms.map(sym => {
    const s = escapeHtml(sym);
    const d = data[sym];
    const qty = getEtfQty(sym);
    const cost = getEtfCost(sym);
    const by = etfByAcctGet(sym);
    const keys = by ? Object.keys(by) : [];
    const acctCell = keys.length > 1
      ? `<span class="small" style="flex-basis:100%">계좌: ${escapeHtml(etfAcctSummary(sym))} <button class="delbtn" data-acct-clear="${s}">구분 지우기</button></span>`
      : `<select class="acctSel" data-acct="${s}" title="계좌">${acctOptions(keys[0] || "")}</select>`;
    const qtyRow = `<div class="qtyRow">
      <input class="qtyInput" data-qty="${s}" type="number" step="any" inputmode="decimal" placeholder="보유수량" value="${qty}">
      <input class="qtyInput" data-cost="${s}" type="number" step="any" inputmode="decimal" placeholder="매수단가" value="${cost}">
      ${acctCell}
    </div>`;
    if (!d) return `<div class="etfRow" data-sym="${s}"><div class="sym"><button class="symBtn" data-chart="${s}">${s}</button></div><div class="px">…</div><div></div>${qtyRow}</div>`;
    if (d.error) return `<div class="etfRow" data-sym="${s}"><div class="sym"><button class="symBtn" data-chart="${s}">${s}</button></div><div class="err">조회 실패</div><button class="delbtn" data-del="${s}">삭제</button>${qtyRow}</div>`;
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
      <div class="sym"><button class="symBtn" data-chart="${s}">${s}</button><button class="delbtn" data-del="${s}" style="margin-left:6px">삭제</button></div>
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
    markAsOf(...Object.keys(etfByAcctGet(inp.dataset.qty) || {}).map(k => "acct:" + k));
    syncEtfSplitAfterManual(inp.dataset.qty);
    renderEtfRows(LS.get("etfSymbols", DEFAULT_ETFS), lastEtfData);
  }));
  $$("[data-cost]", box).forEach(inp => inp.addEventListener("change", () => {
    setEtfCost(inp.dataset.cost, inp.value);
    markAsOf(...Object.keys(etfByAcctGet(inp.dataset.cost) || {}).map(k => "acct:" + k));
    syncEtfSplitAfterManual(inp.dataset.cost);
    renderEtfRows(LS.get("etfSymbols", DEFAULT_ETFS), lastEtfData);
  }));
  $$("[data-acct]", box).forEach(sel => sel.addEventListener("change", () => {
    const sym = sel.dataset.acct;
    const q = parseFloat(getEtfQty(sym)) || 0;
    const c = parseFloat(getEtfCost(sym));
    if (sel.value && q > 0) { etfByAcctSet(sym, { [sel.value]: { qty: q, costTotal: isFinite(c) ? c * q : null } }); markAsOf("acct:" + sel.value); }
    else { etfByAcctSet(sym, null); if (sel.value && !q) toast("보유수량을 먼저 입력해주세요"); }
    renderEtfRows(LS.get("etfSymbols", DEFAULT_ETFS), lastEtfData);
  }));
  $$("[data-acct-clear]", box).forEach(b => b.addEventListener("click", () => { etfByAcctSet(b.dataset.acctClear, null); renderEtfRows(LS.get("etfSymbols", DEFAULT_ETFS), lastEtfData); }));
}
let lastEtfData = {};
let lastIndexData = {};
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
function renderEtfSource() {
  const el = $("#etfSourceNote");
  if (!el) return;
  const used = new Set();
  Object.values(etfByAcctAll()).forEach(m => Object.keys(m).forEach(k => used.add(k)));
  const asof = ACCOUNTS.filter(a => used.has(a.key)).map(a => `${a.label} ${asOfText(asOfGet("acct:" + a.key))}`).join("<br>");
  el.innerHTML = (etfSource ? `시세: 실시간 (${escapeHtml(etfSource)})` : "") + (asof ? `<div style="margin-top:4px">보유수량·매수단가:<br>${asof}</div>` : "");
}
async function loadEtfInner() {
  etfLoadedOnce = true;
  const syms = LS.get("etfSymbols", DEFAULT_ETFS);
  renderEtfRows(syms, {});
  renderIndexRows({});
  const data = {};
  const idata = {};
  lastIndexData = idata;
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

// ---------- 종목 가격 추이 차트(티커를 누르면 아래에서 올라오는 시트) ----------
// CNBC 시세 API는 현재가만 주므로 과거 시세는 별도 경로: CNBC 차트 API · Stooq 일별 CSV · Yahoo chart를 동시에 시도해 먼저 오는 쪽 사용.
const CHART_PERIODS = [["1m", "1개월", 31], ["6m", "6개월", 183], ["1y", "1년", 366], ["5y", "5년", 1830]];
const chartCache = {};
function yyyymmdd(d) { return d.toISOString().slice(0, 10).replace(/-/g, ""); }
function cleanSeries(t, c, days, src) {
  const cutoff = Date.now() - days * 86400000;
  const pts = t.map((x, i) => [x, c[i]]).filter(([x, v]) => isFinite(x) && isFinite(v) && v > 0 && x >= cutoff).sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) throw new Error(src + ": 데이터 부족");
  return { t: pts.map(p => p[0]), c: pts.map(p => p[1]), src };
}
async function historyCnbc(sym, period, days) {
  const r = { "1m": "1M", "6m": "6M", "1y": "1Y", "5y": "5Y" }[period];
  const target = `https://ts-api.cnbc.com/harmony/app/charts/${r}.json?symbol=${encodeURIComponent(CNBC_MAP[sym] || sym)}`;
  const json = await fetchFirstOk([[target], corsProxies(target)], 8000);
  const bars = (json && json.barData && json.barData.priceBars) || [];
  const t = bars.map(b => {
    const ms = Number(b.tradeTimeinMills);
    if (isFinite(ms) && ms > 0) return ms;
    const m = String(b.tradeTime || "").match(/^(\d{4})(\d{2})(\d{2})/);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  });
  return cleanSeries(t, bars.map(b => parseFloat(b.close)), days, "CNBC");
}
async function historyStooq(sym, period, days) {
  const s = STOOQ_MAP[sym] || (sym.toLowerCase() + ".us");
  const now = new Date();
  const target = `https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&d1=${yyyymmdd(new Date(now - days * 86400000))}&d2=${yyyymmdd(now)}&i=${period === "5y" ? "w" : "d"}`;
  const csv = await fetchFirstOkText([corsProxies(target)], 8000);
  if (!/^\s*Date,/i.test(csv)) throw new Error("Stooq: 응답 형식 오류");
  const rows = csv.trim().split(/\r?\n/).slice(1).map(l => l.split(","));
  return cleanSeries(rows.map(r => Date.parse(r[0] + "T00:00:00Z")), rows.map(r => parseFloat(r[4])), days, "Stooq");
}
async function historyYahoo(sym, period, days) {
  const range = { "1m": "1mo", "6m": "6mo", "1y": "1y", "5y": "5y" }[period];
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${period === "5y" ? "1wk" : "1d"}`;
  const json = await fetchFirstOk([[target], corsProxies(target)], 8000);
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  const close = r && r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close;
  if (!r || !r.timestamp || !close) throw new Error("Yahoo: 데이터 없음");
  return cleanSeries(r.timestamp.map(x => x * 1000), close, days, "Yahoo");
}
async function fetchHistory(sym, period) {
  const key = sym + "|" + period;
  const hit = chartCache[key];
  if (hit && Date.now() - hit.at < 10 * 60000) return hit.data;
  const days = CHART_PERIODS.find(p => p[0] === period)[2];
  const tasks = [() => historyCnbc(sym, period, days), () => historyStooq(sym, period, days)];
  if (!yahooBlocked) tasks.push(() => historyYahoo(sym, period, days));
  const data = await raceOk(tasks);
  chartCache[key] = { at: Date.now(), data };
  return data;
}
// ref = 매수단가(가로 점선). 차트 범위에서 너무 멀면 축을 늘리지 않고 안내만 함
function chartSVG(values, ref) {
  const w = 320, h = 160;
  let min = Math.min(...values), max = Math.max(...values);
  const span0 = (max - min) || max * 0.01 || 1;
  const refShown = ref != null && ref >= min - span0 * 0.6 && ref <= max + span0 * 0.6;
  if (refShown) { min = Math.min(min, ref); max = Math.max(max, ref); }
  const pad = ((max - min) || 1) * 0.06;
  min -= pad; max += pad;
  const y = v => h - ((v - min) / (max - min)) * h;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const color = values[values.length - 1] >= values[0] ? "var(--up)" : "var(--down)";
  return {
    refShown,
    svg: `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      ${refShown ? `<line x1="0" x2="${w}" y1="${y(ref).toFixed(1)}" y2="${y(ref).toFixed(1)}" stroke="var(--accent)" stroke-width="1.2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>` : ""}
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>
      <line id="chartCursor" x1="0" x2="0" y1="0" y2="${h}" stroke="var(--muted)" stroke-width="1" vector-effect="non-scaling-stroke" visibility="hidden"/>
    </svg>`
  };
}
let chartReq = 0;
function closeChart() { $("#chartSheet").hidden = true; chartReq++; }
async function openChart(sym, label, period) {
  period = period || LS.get("chartPeriod", "6m");
  const req = ++chartReq;
  const bg = $("#chartSheet");
  const sheet = $(".sheet", bg);
  const d = lastEtfData[sym] || lastIndexData[sym] || null;
  const isIndex = !!INDEX_TICKERS.find(t => t.sym === sym);
  const cost = isIndex ? null : parseFloat(getEtfCost(sym));
  const qty = isIndex ? null : parseFloat(getEtfQty(sym));
  const money = v => (isIndex ? "" : "$") + fmt(v);
  const head = `
    <div class="sheetHead">
      <div><h3 id="chartTitle">${escapeHtml(label || sym)}</h3><div class="small">${escapeHtml(d && d.name ? d.name : sym)}</div></div>
      <button class="sheetClose" id="chartClose" aria-label="닫기">×</button>
    </div>
    ${d && !d.error ? `<div class="fxRate" style="margin-top:8px"><span class="num" style="font-size:26px">${money(d.price)}</span>${d.pct != null ? `<span class="chg ${d.pct >= 0 ? "pos" : "neg"}">${d.pct >= 0 ? "▲" : "▼"} ${fmt(Math.abs(d.pct))}% 오늘</span>` : ""}</div>` : ""}
    <div class="segrow" id="chartPeriods">${CHART_PERIODS.map(([k, l]) => `<button class="seg" data-p="${k}" aria-pressed="${k === period}">${l}</button>`).join("")}</div>`;
  sheet.innerHTML = head + `<div class="status" style="margin-top:14px">차트 불러오는 중…</div>`;
  bg.hidden = false;
  const bind = () => {
    $("#chartClose").addEventListener("click", closeChart);
    $$("#chartPeriods .seg").forEach(b => b.addEventListener("click", () => { LS.set("chartPeriod", b.dataset.p); openChart(sym, label, b.dataset.p); }));
  };
  bind();
  let hist;
  try { hist = await fetchHistory(sym, period); }
  catch (e) {
    if (req !== chartReq) return;
    sheet.innerHTML = head + `<div class="status err" style="margin-top:14px">가격 추이를 가져오지 못했어요.</div><div class="small" style="margin-top:6px;word-break:break-all">${escapeHtml(e.message)}</div>`;
    bind();
    return;
  }
  if (req !== chartReq) return;
  const c = hist.c;
  const first = c[0], last = c[c.length - 1];
  const chg = (last - first) / first * 100;
  const hi = Math.max(...c), lo = Math.min(...c);
  const ref = isFinite(cost) && cost > 0 ? cost : null;
  const nowPx = d && !d.error ? d.price : last; // 매수단가 비교는 차트 마지막 종가가 아니라 현재 시세 기준
  const ch = chartSVG(c, ref);
  const dateOf = ms => fmtDateShort(new Date(ms).toISOString().slice(0, 10));
  const plabel = CHART_PERIODS.find(p => p[0] === period)[1];
  sheet.innerHTML = head + `
    <div class="chartMeta"><span>고 ${money(hi)}</span><span class="${chg >= 0 ? "pos" : "neg"}">${plabel} ${chg >= 0 ? "▲" : "▼"} ${fmt(Math.abs(chg))}%</span><span>저 ${money(lo)}</span></div>
    <div class="chartWrap" id="chartWrap">${ch.svg}</div>
    <div class="chartDates"><span>${dateOf(hist.t[0])}</span><span>${dateOf(hist.t[hist.t.length - 1])}</span></div>
    <div class="chartRead" id="chartRead">차트를 손가락으로 쓸면 날짜별 가격이 보여요</div>
    ${ref ? `<div class="small" style="margin-top:8px"><span style="color:var(--accent)">┄ 내 매수단가 $${fmt(ref)}</span>${!ch.refShown ? ` (이 기간 가격대와 멀어서 선은 생략 — 현재가 대비 ${nowPx >= ref ? "+" : ""}${fmt((nowPx - ref) / ref * 100)}%)` : ` · 현재가 대비 ${nowPx >= ref ? "+" : ""}${fmt((nowPx - ref) / ref * 100)}%`}${qty ? ` · ${fmt(qty, 3)}주` : ""}</div>` : ""}
    <div class="small" style="margin-top:6px;color:var(--muted)">출처: ${escapeHtml(hist.src)} · ${period === "5y" ? "주간" : "일간"} 종가</div>
  `;
  bind();
  const wrap = $("#chartWrap"), read = $("#chartRead"), cur = $("#chartCursor");
  const show = ev => {
    const r = wrap.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    const i = Math.round(fx * (c.length - 1));
    const x = (i / (c.length - 1)) * 320;
    cur.setAttribute("x1", x); cur.setAttribute("x2", x); cur.setAttribute("visibility", "visible");
    const vs = (c[i] - first) / first * 100;
    read.textContent = `${dateOf(hist.t[i])} · ${money(c[i])} (기간 시작 대비 ${vs >= 0 ? "+" : ""}${fmt(vs)}%)`;
  };
  wrap.addEventListener("pointerdown", e => { wrap.setPointerCapture(e.pointerId); show(e); });
  wrap.addEventListener("pointermove", e => { if (e.pointerType === "mouse" || e.buttons) show(e); });
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-chart]");
  if (b) { openChart(b.dataset.chart, b.dataset.label || b.dataset.chart); return; }
  if (e.target.id === "chartSheet") closeChart();
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#chartSheet").hidden) closeChart(); });

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
const DEFAULT_MUNI_HOLDINGS = [];
const MUNI_HOLDINGS_VERSION = 1;
if (LS.get("muniHoldingsVersion", 0) !== MUNI_HOLDINGS_VERSION) {
  if (!LS.get("muniHoldings", null)) LS.set("muniHoldings", DEFAULT_MUNI_HOLDINGS);
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
    set(cusip, patch) { const list = load(); const h = list.find(x => x.cusip === cusip); if (h) { Object.assign(h, patch); LS.set(storageKey, list); } },
    add(h) { const list = load(); list.push(h); LS.set(storageKey, list); },
    upsert(h) { // CUSIP 기준으로 있으면 갱신, 없으면 추가 (CSV 가져오기용)
      const list = load();
      const i = list.findIndex(x => x.cusip === h.cusip);
      if (i >= 0) list[i] = { ...list[i], ...h }; else list.push(h);
      LS.set(storageKey, list);
      return i >= 0 ? "updated" : "added";
    }
  };
}
const muniBonds = createBondHoldings("muniHoldings", DEFAULT_MUNI_HOLDINGS);
// 보유 미국채(국채) — 지방채와 달리 과세대상
const DEFAULT_GOV_BOND_HOLDINGS = [];
const GOV_BOND_VERSION = 1;
if (LS.get("govBondVersion", 0) !== GOV_BOND_VERSION) {
  if (!LS.get("govBondHoldings", null)) LS.set("govBondHoldings", DEFAULT_GOV_BOND_HOLDINGS);
  LS.set("govBondVersion", GOV_BOND_VERSION);
}
const govBonds = createBondHoldings("govBondHoldings", DEFAULT_GOV_BOND_HOLDINGS);
// 계좌가 비어 있는 기존 채권에 기본 계좌를 한 번 지정(지방채=피델리티 개인, 국채=피델리티 LLC). 이미 지정된 건 유지.
const BOND_ACCT_VERSION = 1;
if (LS.get("bondAcctVersion", 0) !== BOND_ACCT_VERSION) {
  [[muniBonds, "fid_p"], [govBonds, "fid_llc"]].forEach(([ctrl, key]) => ctrl.load().forEach(h => { if (!h.acct) ctrl.set(h.cusip, { acct: key }); }));
  LS.set("bondAcctVersion", BOND_ACCT_VERSION);
}
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
          <span class="small">액면 $${fmtInt(h.face)} · 가격 ${asOfText(asOfGet("bond:" + h.cusip) || asOfGet("acct:" + h.acct))}</span>
          <input class="qtyInput" data-price="${escapeHtml(h.cusip)}" type="number" step="0.001" value="${h.price}">
          <select class="acctSel" data-acct-bond="${escapeHtml(h.cusip)}" title="계좌">${acctOptions(h.acct || "")}</select>
          <button class="delbtn" data-del="${escapeHtml(h.cusip)}" style="margin-left:auto">삭제</button>
        </div>
      </div>
    `).join("")}
    <p class="note">쿠폰 지급일은 만기 월·일 기준 6개월 간격 지급을 가정한 추정값입니다(실제와 다를 수 있음). 이자 = 액면가 × 쿠폰금리(세전). 가격은 자동조회가 안 돼서 직접 확인해 가끔 업데이트해주세요.</p>
  `;
  $$("[data-price]", box).forEach(inp => inp.addEventListener("change", () => { ctrl.setPrice(inp.dataset.price, inp.value); markAsOf("bond:" + inp.dataset.price); renderBondHoldings(boxId, ctrl, emptyLabel); }));
  $$("[data-del]", box).forEach(b => b.addEventListener("click", () => { ctrl.delete(b.dataset.del); renderBondHoldings(boxId, ctrl, emptyLabel); }));
  $$("[data-acct-bond]", box).forEach(sel => sel.addEventListener("change", () => ctrl.set(sel.dataset.acctBond, { acct: sel.value || null })));
  renderBondIncome();
}
function renderMuniHoldings() { renderBondHoldings("muniHoldBox", muniBonds, "등록된 보유 지방채가 없습니다"); }
function renderGovBondHoldings() { renderBondHoldings("govHoldBox", govBonds, "등록된 보유 국채가 없습니다"); }
// ---- 머니마켓펀드(MMF): 잔액 × 7일 수익률(연)로 월 이자 계산, 월말 지급 가정 ----
// 처음 설치 시 비어 있음 — 티커·잔액은 기기에만 저장(MMF 카드에서 입력).
const DEFAULT_MMF = { ticker: "", name: "", balance: 0, yield: null };
const MMF_VERSION = 1;
if (LS.get("mmfVersion", 0) !== MMF_VERSION) { if (!LS.get("mmf", null)) LS.set("mmf", DEFAULT_MMF); LS.set("mmfVersion", MMF_VERSION); }
let mmfAutoYield = null, mmfAutoSrc = "", mmfAutoErr = "";
// MMF 7일 수익률 자동 조회: 시세 API(CNBC 등)는 MMF 수익률을 안 주므로, 펀드 요약 페이지(Yahoo·Google Finance)를
// 프록시/jina 리더로 받아 "Yield x.xx%"를 찾는다. 되는 소스가 하나만 있으면 됨(동시에 시도, 30일 캐시).
async function fetchMmfYieldAuto(ticker) {
  const cacheKey = "mmfYieldAuto." + ticker;
  const cached = LS.get(cacheKey, null);
  const parse = (text, src) => {
    const t = String(text).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ");
    const m = t.match(/\b(?:7[- ]?day\s+)?(?:sec\s+)?yield\b[^%\d]{0,40}?(\d{1,2}\.\d{1,3})\s*%/i);
    const v = m ? parseFloat(m[1]) : NaN;
    if (!(v > 0 && v < 10)) throw new Error(src + ": 수익률 못 찾음");
    return { yield: v, src };
  };
  const yPage = `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/`;
  const gPage = `https://www.google.com/finance/quote/${encodeURIComponent(ticker)}:MUTF`;
  const tasks = [
    () => fetchText(`https://r.jina.ai/${yPage}`, 15000).then(t => parse(t, "Yahoo(jina)")),
    () => fetchText(`https://r.jina.ai/${gPage}`, 15000).then(t => parse(t, "Google(jina)")),
    ...corsProxies(gPage).map(u => () => fetchText(u, 10000).then(t => parse(t, "Google"))),
    ...corsProxies(yPage).map(u => () => fetchText(u, 10000).then(t => parse(t, "Yahoo")))
  ];
  try {
    const r = await raceOk(tasks);
    LS.set(cacheKey, { ...r, at: Date.now() });
    return r;
  } catch (e) {
    if (cached && cached.yield && Date.now() - cached.at < 30 * 86400000) return { ...cached, stale: true };
    throw e;
  }
}
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
    ${m.ticker ? `<div class="bondName">${escapeHtml(m.ticker)} <span class="small" style="font-weight:400">${escapeHtml(m.name)}</span></div>`
      : `<div class="row" style="align-items:center;gap:6px"><input class="qtyInput" id="mmfTicker" placeholder="MMF 티커 (예: SPAXX)" maxlength="8" style="text-transform:uppercase;flex:1 1 140px"><button class="btn sm" id="mmfTickerSave">저장</button></div>`}
    <div class="small">잔액 ${asOfText(asOfGet("mmf"))}</div>
    <div class="bondStats">
      <div><span class="k">월 이자 예상</span><span class="v hl">${monthly != null ? "$" + fmtInt(monthly) : "—"}</span></div>
      <div><span class="k">연 이자 예상</span><span class="v hl">${monthly != null ? "$" + fmtInt(monthly * 12) : "—"}</span></div>
      <div><span class="k">잔액 ($)</span><input class="qtyInput" id="mmfBalance" type="number" step="0.01" inputmode="decimal" value="${m.balance}"></div>
      <div><span class="k">7일 수익률 (연 %)</span><input class="qtyInput" id="mmfYield" type="number" step="0.01" inputmode="decimal" placeholder="${mmfAutoYield != null ? "자동 " + fmt(mmfAutoYield) : "직접 입력"}" value="${manual ? m.yield : ""}"></div>
    </div>
    <div class="row" style="margin-top:8px;align-items:center;gap:8px">
      <span class="small">계좌</span><select class="acctSel" id="mmfAcct">${acctOptions(m.acct || "chase")}</select>
      ${(m.acct || "chase") === "chase" ? `<span class="small">소유</span><select class="acctSel" id="chaseOwner"><option value="personal"${LS.get("chaseOwner", "personal") === "personal" ? " selected" : ""}>개인</option><option value="llc"${LS.get("chaseOwner", "personal") === "llc" ? " selected" : ""}>LLC</option></select>` : ""}
    </div>
    <p class="note">${y == null
      ? (mmfAutoErr ? `수익률 자동 조회 실패 (${escapeHtml(mmfAutoErr)}) — 피델리티 MMF 화면의 7-day yield를 입력해주세요.` : "수익률 자동 조회 중…")
      : (manual ? "직접 입력한 수익률 기준." : `자동 조회한 수익률(${escapeHtml(mmfAutoSrc || "자동")}) ${fmt(mmfAutoYield)}% 기준 — 직접 입력하면 그 값을 우선.`)} 이자는 매일 쌓여 월말에 지급된다고 가정. 지방채 MMF라 연방세 면제.</p>
  `;
  $("#mmfBalance").addEventListener("change", e => { const v = parseFloat(e.target.value); if (isFinite(v) && v >= 0) { LS.set("mmf", { ...mmfGet(), balance: v }); markAsOf("mmf"); renderMmf(); renderBondIncome(); } });
  $("#mmfYield").addEventListener("change", e => { const v = parseFloat(e.target.value); LS.set("mmf", { ...mmfGet(), yield: isFinite(v) && v > 0 ? v : null }); renderMmf(); renderBondIncome(); });
  const tk = $("#mmfTickerSave");
  if (tk) tk.addEventListener("click", () => { const t = ($("#mmfTicker").value || "").trim().toUpperCase(); if (/^[A-Z0-9]{2,8}$/.test(t)) { LS.set("mmf", { ...mmfGet(), ticker: t, name: "" }); renderMmf(); loadMuniBench(true); } else toast("티커를 확인해주세요"); });
  $("#mmfAcct").addEventListener("change", e => { LS.set("mmf", { ...mmfGet(), acct: e.target.value || null }); renderMmf(); });
  const co = $("#chaseOwner");
  if (co) co.addEventListener("change", e => { LS.set("chaseOwner", e.target.value); renderMmf(); });
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
  // MMF 7일 수익률 자동 조회 — 재무부 금리표와 동시에 진행
  if (mmfGet().ticker) fetchMmfYieldAuto(mmfGet().ticker).then(r => {
    mmfAutoYield = r.yield; mmfAutoSrc = r.src + (r.stale ? " · 최근 캐시" : ""); mmfAutoErr = "";
    renderMmf(); renderBondIncome();
  }).catch(e => { mmfAutoErr = e.message; renderMmf(); });
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
// 0) 내 자산 요약: 유명 자산관리 앱(Empower·Kubera·Robinhood 등)이 맨 앞에 두는 화면.
//    총자산(원화 환산)·오늘 변동·누적손익·자산 배분·연간 예상 수입·상위 비중·오늘 등락 + 백업/복원.
//    전부 다른 탭이 이미 가진 데이터로 계산(추가 조회 없음).
// =========================================================
const paneHome = $("#pane-home");
function homeSkeleton() {
  const owner = LS.get("homeOwner", "all");
  paneHome.innerHTML = `
    <div class="segrow" id="homeOwnerRow" style="margin:0 0 10px">
      ${[["all", "전체"], ["personal", "개인"], ["llc", "LLC"]].map(([k, l]) => `<button class="seg" data-owner="${k}" aria-pressed="${k === owner}">${l}</button>`).join("")}
    </div>
    <div class="card" id="homeTotal"><h2><span class="lbl">총자산 (평가액 기준, 세전)</span></h2><div class="status">불러오는 중…</div></div>
    <div class="card" id="homeAlloc"><h2><span class="lbl">자산 배분</span></h2><div class="status">불러오는 중…</div></div>
    <div class="card" id="homeAcct"><h2><span class="lbl">계좌별 자산</span></h2><div class="status">불러오는 중…</div></div>
    <div class="card" id="homeCash"></div>
    <div class="card" id="homeIncome"><h2><span class="lbl">연간 예상 수입</span></h2><div class="status">불러오는 중…</div></div>
    <div class="card" id="homeTop"><h2><span class="lbl">상위 비중 종목</span></h2><div class="status">불러오는 중…</div></div>
    <div class="card" id="homeMovers"><h2><span class="lbl">오늘 등락</span></h2><div class="status">불러오는 중…</div></div>
    <div class="card" id="importCard">
      <h2><span class="lbl">피델리티 CSV 가져오기</span></h2>
      <div class="small">피델리티 웹사이트 → Accounts &amp; Trade → Portfolio → <b>Positions</b> → 오른쪽 위 <b>Download</b>로 받은 CSV를 넣으면 ETF·주식 수량/매수단가, 지방채·국채, MMF 잔액을 한 번에 읽어 미리보기 후 반영합니다. 계좌가 여러 개면 같은 종목은 합산(가중평균단가).</div>
      <div class="row" style="margin-top:10px">
        <button class="btn sm primary" id="importBtn">CSV 파일 선택</button>
        <button class="btn sm" id="importPasteBtn">텍스트 붙여넣기</button>
        <input type="file" id="importFile" accept=".csv,text/csv,text/plain" hidden>
      </div>
      <textarea id="importPaste" class="qtyInput" style="width:100%;min-height:90px;margin-top:8px;font-family:var(--font-mono);font-size:11px" placeholder="CSV 내용을 통째로 붙여넣고 아래 버튼을 누르세요" hidden></textarea>
      <div class="row" id="importPasteRow" style="margin-top:8px" hidden><button class="btn sm primary" id="importPasteGo">붙여넣은 내용 읽기</button></div>
      <div id="importPreview" style="margin-top:10px"></div>
    </div>
    <div class="card">
      <h2><span class="lbl">데이터 백업 · 복원</span></h2>
      <div class="small">보유수량·채권·MMF·설정은 이 기기 브라우저에만 저장됩니다. 폰을 바꾸거나 브라우저 데이터를 지우면 사라지니 가끔 백업 파일을 받아두세요.</div>
      <div class="row" style="margin-top:10px">
        <button class="btn sm" id="backupBtn">백업 파일 저장</button>
        <button class="btn sm" id="restoreBtn">복원</button>
        <input type="file" id="restoreFile" accept="application/json,.json" hidden>
      </div>
    </div>
    <div class="row"><button class="btn sm" id="homeRefresh">새로고침</button></div>
    <p class="disclaim">시세는 15~20분 지연일 수 있고 채권 가격은 직접 입력한 값 기준입니다. 참고용이며 투자 조언이 아닙니다.</p>
  `;
  $("#homeRefresh").addEventListener("click", () => loadHome(true));
  $$("#homeOwnerRow .seg").forEach(b => b.addEventListener("click", () => {
    LS.set("homeOwner", b.dataset.owner);
    $$("#homeOwnerRow .seg").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    renderHome(lastEtfData, !etfLoadedOnce);
  }));
  renderCash();
  $("#backupBtn").addEventListener("click", backupData);
  $("#restoreBtn").addEventListener("click", () => $("#restoreFile").click());
  $("#restoreFile").addEventListener("change", restoreData);
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => previewFidelityCsv(String(reader.result));
    reader.readAsText(f);
    e.target.value = "";
  });
  $("#importPasteBtn").addEventListener("click", () => { const t = $("#importPaste"); t.hidden = !t.hidden; $("#importPasteRow").hidden = t.hidden; if (!t.hidden) t.focus(); });
  $("#importPasteGo").addEventListener("click", () => previewFidelityCsv($("#importPaste").value));
}
function backupData() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("findash.")) out[k] = localStorage.getItem(k);
  }
  const blob = new Blob([JSON.stringify({ app: "findash", at: new Date().toISOString(), data: out }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `findash-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast("백업 파일을 저장했어요");
}
function restoreData(e) {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const j = JSON.parse(reader.result);
      if (!j || j.app !== "findash" || !j.data) throw new Error("형식");
      if (!confirm(`${(j.at || "").slice(0, 10)} 백업으로 덮어쓸까요? 지금 저장된 수량·채권·설정이 교체됩니다.`)) return;
      Object.entries(j.data).forEach(([k, v]) => { if (k.startsWith("findash.")) localStorage.setItem(k, v); });
      toast("복원했어요 — 다시 불러옵니다");
      setTimeout(() => location.reload(), 600);
    } catch { toast("백업 파일이 아니에요"); }
  };
  reader.readAsText(f);
  e.target.value = "";
}
function renderCash() {
  const card = $("#homeCash");
  if (!card) return;
  const list = cashList();
  card.innerHTML = `
    <h2><span class="lbl">현금 · 기타 계좌</span></h2>
    ${list.map(c => `<div class="row" style="align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap">
      <input class="qtyInput" data-cash-label="${escapeHtml(c.id)}" value="${escapeHtml(c.label)}" placeholder="계좌 이름" style="flex:1 1 110px;min-width:0">
      <input class="qtyInput" data-cash-bal="${escapeHtml(c.id)}" type="number" step="0.01" inputmode="decimal" value="${c.balance || ""}" placeholder="잔고 $" style="flex:1 1 110px;min-width:0">
      <select class="acctSel" data-cash-owner="${escapeHtml(c.id)}"><option value="personal"${c.owner === "personal" ? " selected" : ""}>개인</option><option value="llc"${c.owner === "llc" ? " selected" : ""}>LLC</option></select>
      <select class="acctSel" data-cash-kind="${escapeHtml(c.id)}" title="종류"><option value="cash"${c.kind !== "invest" ? " selected" : ""}>현금</option><option value="invest"${c.kind === "invest" ? " selected" : ""}>투자(총액)</option></select>
      <input class="qtyInput" data-cash-apy="${escapeHtml(c.id)}" type="number" step="0.01" inputmode="decimal" value="${c.apy || ""}" placeholder="${c.ticker && cashApy(c) != null ? "자동 " + fmt(cashApy(c)) + "%" : "이자 %(선택)"}" style="flex:0 1 92px;min-width:0" title="연 이자율(선택)">
      ${c.ticker ? `<span class="small" style="flex-basis:100%;margin-top:-4px">${escapeHtml(c.ticker)} · ${cashApy(c) != null ? (c.apy > 0 ? "직접 입력 " + fmt(c.apy) + "%" : `7일 수익률 자동 ${fmt(cashApy(c))}%${cashAutoYield[c.ticker] ? " (" + escapeHtml(cashAutoYield[c.ticker].src) + ")" : ""}`) : "7일 수익률 조회 중… (안 되면 직접 입력)"}</span>` : ""}
      <button class="delbtn" data-cash-del="${escapeHtml(c.id)}">삭제</button>
      <span class="small" style="flex-basis:100%;margin-top:-4px">잔고 ${asOfText(asOfGet("cash:" + c.id))}</span>
    </div>`).join("")}
    <div class="row"><button class="btn sm" id="cashAdd">+ 현금 계좌 추가</button></div>
    <p class="note">잔고는 직접 입력(은행·증권 앱의 총액). 종목을 따로 관리하지 않는 계좌(로빈후드 Smart Income 등)는 종류를 "투자(총액)"로 두면 자산 배분에서 현금과 구분돼요. 이자율·수익률을 적으면 연간 수입에도 들어갑니다.</p>
  `;
  const save = (id, patch) => { const l = cashList(); const c = l.find(x => x.id === id); if (c) { Object.assign(c, patch); LS.set("cash", l); } };
  const rerender = () => { renderCash(); renderHome(lastEtfData, !etfLoadedOnce); };
  $$("[data-cash-label]", card).forEach(i => i.addEventListener("change", () => { save(i.dataset.cashLabel, { label: i.value.trim() || "현금" }); rerender(); }));
  $$("[data-cash-bal]", card).forEach(i => i.addEventListener("change", () => { const v = parseFloat(i.value); save(i.dataset.cashBal, { balance: isFinite(v) ? v : 0 }); markAsOf("cash:" + i.dataset.cashBal); rerender(); }));
  $$("[data-cash-owner]", card).forEach(s => s.addEventListener("change", () => { save(s.dataset.cashOwner, { owner: s.value }); rerender(); }));
  $$("[data-cash-kind]", card).forEach(s => s.addEventListener("change", () => { save(s.dataset.cashKind, { kind: s.value === "invest" ? "invest" : undefined }); rerender(); }));
  $$("[data-cash-apy]", card).forEach(i => i.addEventListener("change", () => { const v = parseFloat(i.value); save(i.dataset.cashApy, { apy: isFinite(v) ? v : 0 }); rerender(); }));
  $$("[data-cash-del]", card).forEach(b => b.addEventListener("click", () => { LS.set("cash", cashList().filter(x => x.id !== b.dataset.cashDel)); rerender(); }));
  $("#cashAdd").addEventListener("click", () => { const l = cashList(); l.push({ id: uid(), label: "새 계좌", balance: 0, owner: "personal", apy: 0 }); LS.set("cash", l); rerender(); });
}
function homeFxRate() {
  if (fxRate) return fxRate;
  const c = LS.get("fxLast", null);
  return c && c.rate ? c.rate : null;
}
// owner: "all" | "personal" | "llc" — 소유별로 볼 때 계좌 구분이 없는 자산은 빼고 개수만 알려줌
function computeHome(etfData, owner = "all") {
  const syms = LS.get("etfSymbols", DEFAULT_ETFS);
  const pos = [];
  let etfValue = 0, etfCost = 0, dayChange = 0, pending = 0, unclassified = 0;
  const inc = computeIncome(etfData);
  const incBySym = {}; inc.sources.forEach(s => { incBySym[s.label] = s.annual; });
  let divAnnual = 0;
  const byAcct = {}; // 계좌별 내역(필터와 무관하게 전체)
  const bump = (key, field, v) => { const k = key || "none"; byAcct[k] = byAcct[k] || { etf: 0, muni: 0, gov: 0, mmf: 0, cash: 0, inv: 0 }; byAcct[k][field] += v; };
  syms.forEach(sym => {
    const qtyTotal = parseFloat(getEtfQty(sym));
    if (!qtyTotal) return;
    const d = etfData[sym];
    if (!d || d.error) { pending++; return; }
    const split = etfByAcctGet(sym);
    if (split) Object.entries(split).forEach(([k, p]) => bump(k, "etf", p.qty * d.price)); else bump(null, "etf", qtyTotal * d.price);
    let qty = qtyTotal;
    if (owner !== "all") {
      const q = etfQtyForOwner(sym, owner);
      if (q == null) { unclassified++; return; }
      if (q <= 0) return;
      qty = q;
    }
    const value = qty * d.price;
    const cost = parseFloat(getEtfCost(sym));
    etfValue += value;
    if (isFinite(cost)) etfCost += qty * cost;
    if (incBySym[sym]) divAnnual += incBySym[sym] * qty / qtyTotal;
    const prev = d.pct != null ? d.price / (1 + d.pct / 100) : null;
    const chg = prev != null ? qty * (d.price - prev) : null;
    if (chg != null) dayChange += chg;
    pos.push({ sym, name: d.name || "", qty, price: d.price, value, pct: d.pct, chg, gain: isFinite(cost) ? value - qty * cost : null, gainPct: isFinite(cost) && cost ? (d.price - cost) / cost * 100 : null });
  });
  const inOwner = acct => owner === "all" || acctOwner(acct) === owner;
  const muniAll = muniBonds.load(), govAll = govBonds.load();
  muniAll.forEach(h => bump(h.acct, "muni", h.face * h.price / 100));
  govAll.forEach(h => bump(h.acct, "gov", h.face * h.price / 100));
  const muni = muniAll.filter(h => inOwner(h.acct)), gov = govAll.filter(h => inOwner(h.acct));
  if (owner !== "all") unclassified += muniAll.filter(h => !h.acct).length + govAll.filter(h => !h.acct).length;
  const muniMv = muni.reduce((s, h) => s + h.face * h.price / 100, 0);
  const govMv = gov.reduce((s, h) => s + h.face * h.price / 100, 0);
  const mmf = mmfGet();
  const mmfAcct = mmf.acct || "chase";
  bump(mmfAcct, "mmf", mmf.balance || 0);
  const mmfValue = inOwner(mmfAcct) ? (mmf.balance || 0) : 0;
  let cashValue = 0, invValue = 0, cashAnnual = 0;
  cashList().forEach(c => {
    const b = c.balance || 0;
    if (!b) return;
    const inv = c.kind === "invest"; // 총액만 아는 투자 계좌(로빈후드 Smart Income 등)
    bump("cash:" + c.id, inv ? "inv" : "cash", b);
    if (owner === "all" || c.owner === owner) { if (inv) invValue += b; else cashValue += b; cashAnnual += b * (cashApy(c) || 0) / 100; }
  });
  const total = etfValue + muniMv + govMv + mmfValue + cashValue + invValue;
  const muniAnnual = muni.reduce((s, h) => s + h.face * h.coupon / 100, 0);
  const govAnnual = gov.reduce((s, h) => s + h.face * h.coupon / 100, 0);
  const my = mmfYield();
  const mmfAnnual = my != null ? mmfValue * my / 100 : null;
  Object.values(byAcct).forEach(a => { a.cash = a.cash || 0; a.inv = a.inv || 0; a.total = a.etf + a.muni + a.gov + a.mmf + a.cash + a.inv; });
  return { owner, pos: pos.sort((a, b) => b.value - a.value), etfValue, etfCost, dayChange, pending, unclassified, muniMv, govMv, mmfValue, cashValue, invValue, cashAnnual, total, divAnnual, muniAnnual, govAnnual, mmfAnnual, mmfYieldKnown: my != null, etfFailed: inc.etfFailed, byAcct };
}
// 총자산 아래 한 줄: 시세는 실시간, 보유·잔고는 가장 오래된 기준일 + 갱신 필요한 계좌 수
function homeAsOfLine(r) {
  const keys = Object.entries(r.byAcct).filter(([, v]) => v.total > 0).map(([k]) => acctAsOfKey(k)).filter(Boolean);
  const times = [...new Set(keys)].map(k => asOfGet(k)).filter(Boolean);
  if (!times.length) return "";
  const oldest = Math.min(...times);
  const stale = times.filter(t => asOfDays(t) >= STALE_DAYS).length;
  return `시세는 실시간 · 보유·잔고는 계좌별 입력 기준 (가장 오래된 것 ${asOfText(oldest)})${stale ? ` <span style="color:var(--danger)">— ${stale}개 계좌 갱신 필요</span>` : ""}`;
}
function renderHome(etfData, loading) {
  const owner = LS.get("homeOwner", "all");
  const r = computeHome(etfData, owner);
  const ownerTag = owner === "all" ? "" : ` <span class="acctTag">${OWNER_LABEL[owner]}</span>`;
  const fx = homeFxRate();
  const krw = v => fx ? `₩${fmtInt(v * fx)}` : "환율 없음";
  const gain = r.etfCost ? r.etfValue - r.etfCost : null;
  const gainPct = r.etfCost ? gain / r.etfCost * 100 : null;
  const signed = (v, pct) => v == null ? "—" : `<span style="color:${v >= 0 ? "var(--up)" : "var(--down)"}">${v >= 0 ? "+" : "-"}$${fmtInt(Math.abs(v))}${pct != null ? ` (${v >= 0 ? "+" : "-"}${fmt(Math.abs(pct))}%)` : ""}</span>`;
  $("#homeTotal").innerHTML = `
    <h2><span class="lbl">총자산 (평가액 기준, 세전)</span>${ownerTag}</h2>
    <div class="homeBig">$${fmtInt(r.total)}</div>
    <div class="homeSub">${krw(r.total)}${fx ? ` · 1 USD = ₩${fmt(fx)}` : " · 환율 탭에서 환율을 불러오면 원화로도 표시"}</div>
    <div class="small" style="margin-top:4px">${homeAsOfLine(r)}</div>
    <div class="kpi">
      <div><span class="k">오늘 변동 (ETF·주식)</span><span class="v">${signed(r.dayChange, r.etfValue ? r.dayChange / (r.etfValue - r.dayChange) * 100 : null)}</span></div>
      <div><span class="k">ETF·주식 누적손익</span><span class="v">${signed(gain, gainPct)}</span></div>
      <div><span class="k">ETF·주식 평가액</span><span class="v">$${fmtInt(r.etfValue)}</span></div>
      <div><span class="k">채권 · MMF · 현금 · 기타</span><span class="v">$${fmtInt(r.muniMv + r.govMv + r.mmfValue + r.cashValue + r.invValue)}</span></div>
    </div>
    ${loading ? `<div class="small" style="margin-top:8px">ETF 시세 불러오는 중… (채권·MMF는 먼저 계산됨)</div>` : (r.pending ? `<div class="small" style="margin-top:8px;color:var(--danger)">${r.pending}개 종목 시세 조회 실패 — 총자산에서 빠져 있어요.</div>` : "")}
    ${r.unclassified ? `<div class="small" style="margin-top:8px;color:var(--danger)">계좌 구분이 없는 자산 ${r.unclassified}건은 제외됨 — ETF 탭·채권 탭에서 계좌를 지정하거나 CSV로 가져오면 반영돼요.</div>` : ""}
  `;
  const acctRows = [...ACCOUNTS.map(a => ({ key: a.key, label: a.label, owner: acctOwner(a.key) })), ...cashList().map(c => ({ key: "cash:" + c.id, label: c.label, owner: c.owner })), { key: "none", label: "구분 없음", owner: null }]
    .map(a => ({ ...a, v: r.byAcct[a.key] })).filter(a => a.v && a.v.total > 0);
  const ownerTotals = { personal: 0, llc: 0, none: 0 };
  acctRows.forEach(a => { ownerTotals[a.owner || "none"] += a.v.total; });
  const grand = acctRows.reduce((s, a) => s + a.v.total, 0);
  $("#homeAcct").innerHTML = `
    <h2><span class="lbl">계좌별 자산</span></h2>
    <div class="kpi" style="margin-top:0">
      <div><span class="k">개인 합계</span><span class="v">$${fmtInt(ownerTotals.personal)}</span></div>
      <div><span class="k">LLC 합계</span><span class="v">$${fmtInt(ownerTotals.llc)}</span></div>
    </div>
    ${acctRows.map((a, i) => `<div class="etfRow" style="grid-template-columns:1fr auto;${i === 0 ? "border-top:0;margin-top:6px" : ""}">
      <div><div class="sym">${escapeHtml(a.label)}${a.owner ? ` <span class="acctTag">${OWNER_LABEL[a.owner]}</span>` : ""}</div>
        ${acctAsOfKey(a.key) ? `<div class="small">${asOfText(asOfGet(acctAsOfKey(a.key)))}</div>` : ""}
        <div class="nm">${[a.v.etf ? `ETF·주식 $${fmtInt(a.v.etf)}` : "", a.v.muni ? `지방채 $${fmtInt(a.v.muni)}` : "", a.v.gov ? `국채 $${fmtInt(a.v.gov)}` : "", a.v.mmf ? `MMF $${fmtInt(a.v.mmf)}` : "", a.v.cash ? `현금 $${fmtInt(a.v.cash)}` : "", a.v.inv ? `투자(총액) $${fmtInt(a.v.inv)}` : ""].filter(Boolean).join(" · ")}</div></div>
      <div class="px" style="text-align:right">$${fmtInt(a.v.total)}<div class="small">${grand ? fmt(a.v.total / grand * 100, 1) : "-"}%</div></div>
    </div>`).join("")}
    ${ownerTotals.none ? `<div class="small" style="margin-top:8px">"구분 없음" $${fmtInt(ownerTotals.none)}은 어느 계좌인지 아직 지정 안 된 자산이에요. ETF 탭 종목의 계좌 선택칸, 채권 탭 종목의 계좌 선택칸, 또는 CSV 가져오기로 지정할 수 있어요.</div>` : ""}
  `;
  const parts = [
    { label: "ETF·주식", v: r.etfValue, c: "var(--accent)" },
    { label: "지방채", v: r.muniMv, c: "#7FB4F2" },
    { label: "국채", v: r.govMv, c: "#C9A227" },
    { label: "MMF(현금성)", v: r.mmfValue, c: "#9AA7A1" },
    { label: "현금", v: r.cashValue, c: "#6FBF9A" },
    { label: "기타 투자(총액)", v: r.invValue, c: "#B48EE0" }
  ].filter(p => p.v > 0);
  $("#homeAlloc").innerHTML = `
    <h2><span class="lbl">자산 배분</span></h2>
    <div class="allocBar">${parts.map(p => `<i style="width:${(p.v / r.total * 100).toFixed(2)}%;background:${p.c}"></i>`).join("")}</div>
    <div class="allocLegend">${parts.map(p => `<span><b style="background:${p.c}"></b>${p.label}<span class="v">${fmt(p.v / r.total * 100, 1)}% · $${fmtInt(p.v)}</span></span>`).join("")}</div>
  `;
  const incTotal = r.divAnnual + r.muniAnnual + r.govAnnual + (r.mmfAnnual || 0) + (r.cashAnnual || 0);
  $("#homeIncome").innerHTML = `
    <h2><span class="lbl">연간 예상 수입 (세전)</span></h2>
    <div class="homeBig" style="font-size:26px;color:var(--accent)">$${fmtInt(incTotal)}<span class="small" style="margin-left:6px;color:var(--muted)">/년</span></div>
    <div class="homeSub">월 $${fmtInt(incTotal / 12)} · 총자산 대비 ${r.total ? fmt(incTotal / r.total * 100) : "-"}%${fx ? ` · ${krw(incTotal)}/년` : ""}</div>
    <div class="kpi">
      <div><span class="k">ETF·주식 배당</span><span class="v">$${fmtInt(r.divAnnual)}</span></div>
      <div><span class="k">지방채 이자 (비과세)</span><span class="v">$${fmtInt(r.muniAnnual)}</span></div>
      <div><span class="k">국채 이자</span><span class="v">$${fmtInt(r.govAnnual)}</span></div>
      <div><span class="k">MMF 이자</span><span class="v">${r.mmfAnnual != null ? "$" + fmtInt(r.mmfAnnual) : "수익률 필요"}</span></div>
      ${r.cashAnnual ? `<div><span class="k">현금 이자·기타 수익</span><span class="v">$${fmtInt(r.cashAnnual)}</span></div>` : ""}
    </div>
    ${!r.mmfYieldKnown ? `<div class="small" style="margin-top:6px">MMF 수익률이 아직 없어 MMF 이자는 빠져 있어요 (채권 탭에서 자동 조회 또는 입력).</div>` : ""}
  `;
  const top = r.pos.slice(0, 5);
  const top5Share = r.total ? top.reduce((s, p) => s + p.value, 0) / r.total * 100 : 0;
  $("#homeTop").innerHTML = `
    <h2><span class="lbl">상위 비중 종목</span></h2>
    ${top.length ? top.map((p, i) => `<div class="etfRow" style="grid-template-columns:1fr auto;${i === 0 ? "border-top:0" : ""}">
      <div><div class="sym"><button class="symBtn" data-chart="${escapeHtml(p.sym)}">${escapeHtml(p.sym)}</button> <span class="small" style="font-weight:400">${fmt(p.value / r.total * 100, 1)}%</span></div><div class="nm">${escapeHtml(p.name)}</div></div>
      <div class="px" style="text-align:right">$${fmtInt(p.value)}<div class="small">${p.gain != null ? signed(p.gain, p.gainPct) : ""}</div></div>
    </div>`).join("") : `<div class="small">${loading ? "불러오는 중…" : "보유수량이 입력된 종목이 없습니다."}</div>`}
    ${top.length ? `<div class="small" style="margin-top:8px">상위 5종목이 총자산의 ${fmt(top5Share, 1)}%${top5Share >= 50 ? " — 특정 종목 쏠림이 큰 편이에요" : ""}</div>` : ""}
  `;
  const movers = r.pos.filter(p => p.pct != null).sort((a, b) => b.pct - a.pct);
  const up = movers.filter(p => p.pct > 0).slice(0, 3);
  const down = movers.filter(p => p.pct < 0).slice(-3).reverse();
  const moverRow = p => `<div class="etfRow" style="grid-template-columns:1fr auto auto"><div class="sym"><button class="symBtn" data-chart="${escapeHtml(p.sym)}">${escapeHtml(p.sym)}</button></div><div class="px">$${fmt(p.price)}</div>${pctCell(p.pct)}<div class="nm" style="grid-column:1/4">${p.chg != null ? `오늘 ${signed(p.chg)}` : ""}</div></div>`;
  $("#homeMovers").innerHTML = `
    <h2><span class="lbl">오늘 등락 (보유 종목)</span></h2>
    ${movers.length ? `<div class="small">상승</div>${up.length ? up.map(moverRow).join("") : `<div class="small" style="color:var(--muted)">오른 종목 없음</div>`}<div class="small" style="margin-top:8px">하락</div>${down.length ? down.map(moverRow).join("") : `<div class="small" style="color:var(--muted)">내린 종목 없음</div>`}` : `<div class="small">${loading ? "불러오는 중…" : "표시할 종목이 없습니다."}</div>`}
  `;
}
async function loadHome(force) {
  if (!etfLoadedOnce || force) renderHome(lastEtfData, true);
  try { await (force ? loadEtf() : ensureEtfLoaded()); } catch {}
  if (!fxRate && !fxLoaded) { try { await loadFx(); } catch {} } // 원화 환산용
  renderHome(lastEtfData, false);
  setUpdated(nowLabel() + " 업데이트");
  loadCashYields().then(changed => { if (changed) { renderCash(); renderHome(lastEtfData, false); } }); // SPAXX 등 현금성 계좌 이자율
}

// =========================================================
// 0-b) 피델리티 Positions CSV 가져오기 — 보유수량·매수단가·채권·MMF를 캡처 대신 파일로 갱신
// =========================================================
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  const s = String(text).replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function csvNum(v) {
  if (v == null) return null;
  const t = String(v).trim();
  if (!t || /^(n\/a|--|-|—)$/i.test(t)) return null;
  const neg = /^\(.*\)$/.test(t) || t.startsWith("-");
  const n = parseFloat(t.replace(/[$,%()\s+-]/g, ""));
  return isFinite(n) ? (neg ? -n : n) : null;
}
// 피델리티 CSV 한 장을 { etf:{sym:{qty,costTotal,byAcct:{계좌명:{qty,costTotal,hasCost}}}}, muni:[], gov:[], mmf:[], skipped:[], accounts:[] } 로 분류
function parseFidelityPositions(rows) {
  const hi = rows.findIndex(r => r.some(c => /^symbol$/i.test(c.trim())) && r.some(c => /quantity/i.test(c)));
  if (hi < 0) throw new Error("피델리티 Positions CSV 형식이 아니에요 (Symbol/Quantity 헤더 없음)");
  const header = rows[hi].map(h => h.trim().toLowerCase());
  const col = (...names) => { for (const n of names) { const i = header.findIndex(h => h === n); if (i >= 0) return i; } for (const n of names) { const i = header.findIndex(h => h.includes(n)); if (i >= 0) return i; } return -1; };
  const cSym = col("symbol"), cDesc = col("description"), cQty = col("quantity"), cLast = col("last price"), cVal = col("current value"),
    cCostTotal = col("cost basis total", "cost basis"), cCostAvg = col("average cost basis", "average cost"), cAcct = col("account name", "account number");
  const out = { broker: "fidelity", etf: {}, muni: [], gov: [], mmf: [], skipped: [], accounts: new Set() };
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < 3) continue;
    let sym = (row[cSym] || "").trim().toUpperCase().replace(/\*+$/, "");
    const desc = (row[cDesc] || "").trim();
    const qty = csvNum(row[cQty]);
    if (!sym || /^pending activity$/i.test(sym) || /^(cash|total)$/i.test(sym)) { if (sym) out.skipped.push(sym); continue; }
    if (qty == null) { out.skipped.push(sym); continue; }
    const acctName = cAcct >= 0 ? (row[cAcct] || "").trim() : "";
    if (acctName) out.accounts.add(acctName);
    const last = csvNum(row[cLast]);
    const value = csvNum(row[cVal]);
    const couponM = desc.match(/(\d{1,2}\.\d{2,5})\s*%/);
    const matM = desc.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    const isCusip = /^[0-9A-Z]{9}$/.test(sym) && /\d/.test(sym);
    if (isCusip && couponM && matM) {
      const h = { cusip: sym, name: desc.replace(/\s+\d{1,2}\.\d{2,5}\s*%.*$/, "").slice(0, 40).trim() || sym, coupon: parseFloat(couponM[1]), maturity: `${matM[3]}-${matM[1]}-${matM[2]}`, face: qty, price: last != null ? last : (value != null && qty ? value / qty * 100 : 100), acctName };
      (/UNITED STATES TREAS|US TREAS|U S TREAS|TREASURY/i.test(desc) ? out.gov : out.muni).push(h);
      continue;
    }
    if (/XX$/.test(sym) || /MONEY MARKET|MONEY MKT/i.test(desc)) { // 머니마켓펀드: 수량 = 잔액
      out.mmf.push({ ticker: sym, name: desc.slice(0, 50), balance: value != null ? value : qty, acctName });
      continue;
    }
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) { out.skipped.push(sym); continue; }
    const costTotal = csvNum(row[cCostTotal]);
    const costAvg = csvNum(row[cCostAvg]);
    const e = out.etf[sym] || (out.etf[sym] = { qty: 0, costTotal: 0, hasCost: false, name: desc, byAcct: {} });
    const a = e.byAcct[acctName] || (e.byAcct[acctName] = { qty: 0, costTotal: 0, hasCost: false });
    e.qty += qty; a.qty += qty;
    const ct = costTotal != null ? costTotal : (costAvg != null ? costAvg * qty : null);
    if (ct != null) { e.costTotal += ct; e.hasCost = true; a.costTotal += ct; a.hasCost = true; }
  }
  out.accounts = [...out.accounts];
  if (!Object.keys(out.etf).length && !out.muni.length && !out.gov.length && !out.mmf.length) throw new Error("읽을 수 있는 보유 종목이 없어요");
  return out;
}
// 로빈후드는 보유현황 CSV가 없고 거래내역(Account activity report) CSV만 있음 → 매수·매도를 합산해 보유수량/평균단가를 복원
// 열: Activity Date, Process Date, Settle Date, Instrument, Description, Trans Code, Quantity, Price, Amount
function parseRobinhoodActivity(rows) {
  const hi = rows.findIndex(r => r.some(c => /trans code/i.test(c)) && r.some(c => /instrument/i.test(c)));
  if (hi < 0) throw new Error("로빈후드 거래내역 CSV 형식이 아니에요");
  const header = rows[hi].map(h => h.trim().toLowerCase());
  const col = n => header.findIndex(h => h.includes(n));
  const cDate = col("activity date"), cSym = col("instrument"), cCode = col("trans code"), cQty = col("quantity"), cAmt = col("amount"), cPrice = col("price");
  const pos = {};
  let minDate = null, maxDate = null, buys = 0, sells = 0, divs = 0;
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < 4) continue;
    const sym = (row[cSym] || "").trim().toUpperCase();
    const code = (row[cCode] || "").trim().toUpperCase();
    const date = (row[cDate] || "").trim();
    if (date && /\d/.test(date)) { if (!minDate || date < minDate) minDate = date; if (!maxDate || date > maxDate) maxDate = date; }
    if (!sym || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) continue;
    const qty = csvNum((row[cQty] || "").replace(/S$/i, ""));
    const amt = csvNum(row[cAmt]);
    const price = csvNum(row[cPrice]);
    const p = pos[sym] || (pos[sym] = { qty: 0, costTotal: 0 });
    if (code === "BUY" && qty) {
      // 금액 칸이 따옴표 없이 "($1,234.56)"처럼 쉼표로 쪼개져 들어오는 파일이 있어, 단가×수량과 30% 넘게 다르면 단가×수량을 씀
      const byPrice = price != null ? price * qty : null;
      let cost = amt != null ? Math.abs(amt) : byPrice;
      if (byPrice != null && cost != null && Math.abs(cost - byPrice) / byPrice > 0.3) cost = byPrice;
      p.qty += qty; p.costTotal += cost || 0; buys++;
    }
    else if (code === "SELL" && qty) { const avg = p.qty > 0 ? p.costTotal / p.qty : 0; p.qty -= qty; p.costTotal -= avg * qty; sells++; }
    else if (code === "CDIV") divs++;
  }
  const etf = {};
  Object.entries(pos).forEach(([sym, p]) => { if (p.qty > 1e-6) etf[sym] = { qty: p.qty, costTotal: Math.max(0, p.costTotal), hasCost: true }; });
  if (!Object.keys(etf).length) throw new Error("거래내역에서 현재 보유 중인 종목을 찾지 못했어요 (매수 거래가 없거나 전부 매도됨)");
  return { broker: "robinhood", etf, range: [minDate, maxDate], buys, sells, divs };
}
let importPending = null;
function previewFidelityCsv(text) {
  const box = $("#importPreview");
  let p;
  try {
    const rows = parseCsv(text);
    const isRh = rows.slice(0, 5).some(r => r.some(c => /trans code/i.test(c)));
    p = isRh ? parseRobinhoodActivity(rows) : parseFidelityPositions(rows);
  } catch (e) { box.innerHTML = `<div class="status err">${escapeHtml(e.message)}</div>`; importPending = null; return; }
  importPending = p;
  const syms = LS.get("etfSymbols", DEFAULT_ETFS);
  const etfRows = Object.entries(p.etf).sort((a, b) => a[0].localeCompare(b[0])).map(([sym, e]) => {
    const oldQ = parseFloat(getEtfQty(sym)) || 0, oldC = parseFloat(getEtfCost(sym));
    const newC = e.hasCost && e.qty ? e.costTotal / e.qty : null;
    const isNew = !syms.includes(sym);
    return { sym, e, oldQ, newC, isNew };
  });
  if (p.broker === "robinhood") {
    box.innerHTML = `
      <div class="small" style="margin-bottom:6px"><b>로빈후드 거래내역</b> ${escapeHtml((p.range[0] || "?") + " ~ " + (p.range[1] || "?"))} · 매수 ${p.buys}건 · 매도 ${p.sells}건 · 배당 ${p.divs}건 → 현재 보유 ${etfRows.length}종목 (계좌: 로빈후드)</div>
      <div style="max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px 8px">
        ${etfRows.map(r => `<div class="small"><b>${escapeHtml(r.sym)}</b>${r.isNew ? " <span style='color:var(--accent)'>신규</span>" : ""} 수량 <b>${fmt(r.e.qty, 4)}</b>${r.newC != null ? ` · 평균단가 $${fmt(r.newC)}` : ""}</div>`).join("")}
      </div>
      <div class="row" style="margin-top:10px"><button class="btn sm primary" id="importApply">반영하기</button><button class="btn sm" id="importCancel">취소</button></div>
      <p class="note">거래내역은 <b>전체 기간</b>으로 받아야 수량이 정확해요(일부 기간만 받으면 그 전에 산 수량이 빠짐). 로빈후드 보유분은 "로빈후드" 계좌로 들어가고, 같은 종목의 피델리티 보유분과 합산돼 총수량이 됩니다.</p>
    `;
  } else {
    const acctMap = LS.get("acctMap", {}) || {};
    const changedCount = etfRows.filter(r => r.isNew || Math.abs(r.oldQ - r.e.qty) > 1e-6).length;
    const bondLine = (h, kind) => `<div class="small">${kind} ${escapeHtml(h.cusip)} ${escapeHtml(h.name)} · 쿠폰 ${fmt(h.coupon, 3)}% · 만기 ${h.maturity} · 액면 $${fmtInt(h.face)} · 가격 ${fmt(h.price, 3)}${h.acctName ? ` · ${escapeHtml(h.acctName)}` : ""}</div>`;
    box.innerHTML = `
      <div class="small" style="margin-bottom:6px"><b>피델리티 보유현황</b> · ETF·주식 ${etfRows.length}종목(변경 ${changedCount}) · 지방채 ${p.muni.length} · 국채 ${p.gov.length} · MMF ${p.mmf.length}${p.skipped.length ? ` · 건너뜀: ${escapeHtml(p.skipped.join(", "))}` : ""}</div>
      ${p.accounts.length ? `<div class="small" style="margin-bottom:4px"><b>계좌 구분</b> — CSV의 계좌마다 개인/LLC를 골라주세요 (한 번 고르면 기억)</div>
        ${p.accounts.map(name => { const def = acctMap[name] || (/llc/i.test(name) ? "fid_llc" : "fid_p"); return `<div class="row" style="align-items:center;gap:8px;margin-bottom:4px"><span class="small" style="min-width:0;overflow:hidden;text-overflow:ellipsis">${escapeHtml(name)}</span><select class="acctSel" data-acct-map="${escapeHtml(name)}"><option value="fid_p"${def === "fid_p" ? " selected" : ""}>피델리티 개인</option><option value="fid_llc"${def === "fid_llc" ? " selected" : ""}>피델리티 LLC</option></select></div>`; }).join("")}` : `<div class="small" style="color:var(--danger)">CSV에 계좌 이름 열이 없어 계좌 구분 없이 가져옵니다.</div>`}
      ${etfRows.length ? `<div style="max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px 8px;margin-top:6px">
        ${etfRows.map(r => `<div class="small"><b>${escapeHtml(r.sym)}</b>${r.isNew ? " <span style='color:var(--accent)'>신규</span>" : ""} 수량 ${r.oldQ ? fmt(r.oldQ, 3) + " → " : ""}<b>${fmt(r.e.qty, 3)}</b>${r.newC != null ? ` · 단가 $${fmt(r.newC)}` : ""}${Object.keys(r.e.byAcct).length > 1 ? ` <span style="color:var(--muted)">(${Object.entries(r.e.byAcct).map(([n, a]) => `${escapeHtml(n)} ${fmt(a.qty, 3)}`).join(" / ")})</span>` : ""}</div>`).join("")}
      </div>` : ""}
      ${p.muni.map(h => bondLine(h, "지방채")).join("")}
      ${p.gov.map(h => bondLine(h, "국채")).join("")}
      ${p.mmf.map(m => `<div class="small">현금(core) ${escapeHtml(m.ticker)} $${fmtInt(m.balance)}${m.acctName ? ` · ${escapeHtml(m.acctName)}` : ""} → 자산 탭 현금 계좌에 반영</div>`).join("")}
      <div class="row" style="margin-top:10px"><button class="btn sm primary" id="importApply">반영하기</button><button class="btn sm" id="importCancel">취소</button></div>
      <p class="note">CSV에 없는 기존 종목은 그대로 둡니다(판 종목은 ETF 탭에서 삭제). 피델리티 계좌분만 갱신되고 로빈후드 계좌분은 유지됩니다. 채권은 CUSIP 기준 갱신/추가, 가격은 CSV의 Last Price.</p>
    `;
  }
  $("#importApply").addEventListener("click", applyFidelityImport);
  $("#importCancel").addEventListener("click", () => { box.innerHTML = ""; importPending = null; });
}
function applyFidelityImport() {
  const p = importPending;
  if (!p) return;
  const syms = LS.get("etfSymbols", DEFAULT_ETFS);
  let added = 0;
  if (p.broker === "robinhood") {
    Object.entries(p.etf).forEach(([sym, e]) => {
      if (!syms.includes(sym)) { syms.push(sym); added++; }
      const cur = etfByAcctGet(sym) || {};
      const hadNoSplit = !etfByAcctGet(sym) && (parseFloat(getEtfQty(sym)) || 0) > 0;
      if (hadNoSplit) { // 기존 총수량이 계좌 구분 없이 있었으면 그건 피델리티 개인분으로 간주해 유지
        const q = parseFloat(getEtfQty(sym)), c = parseFloat(getEtfCost(sym));
        cur.fid_p = { qty: q, costTotal: isFinite(c) ? c * q : null };
      }
      cur.rh = { qty: e.qty, costTotal: e.costTotal };
      markAsOf("acct:rh");
      etfByAcctSet(sym, cur);
      etfRecomputeTotals(sym);
    });
    LS.set("etfSymbols", syms);
    importPending = null;
    toast(`로빈후드 ${Object.keys(p.etf).length}종목 반영(신규 ${added}). 다시 불러옵니다`);
    setTimeout(() => location.reload(), 900);
    return;
  }
  const acctMap = LS.get("acctMap", {}) || {};
  $$("[data-acct-map]").forEach(sel => { acctMap[sel.dataset.acctMap] = sel.value; });
  LS.set("acctMap", acctMap);
  const keyOf = name => (name && acctMap[name]) || (p.accounts.length ? "fid_p" : null);
  Object.entries(p.etf).forEach(([sym, e]) => {
    if (!syms.includes(sym)) { syms.push(sym); added++; }
    const cur = etfByAcctGet(sym) || {};
    Object.keys(cur).forEach(k => { if (k.startsWith("fid_")) delete cur[k]; }); // 피델리티분은 CSV가 전체 진실
    Object.entries(e.byAcct).forEach(([name, a]) => {
      const k = keyOf(name);
      if (!k) return;
      const prev = cur[k] || { qty: 0, costTotal: 0 };
      cur[k] = { qty: prev.qty + a.qty, costTotal: a.hasCost && prev.costTotal != null ? prev.costTotal + a.costTotal : null };
    });
    if (Object.keys(cur).length) { etfByAcctSet(sym, cur); etfRecomputeTotals(sym); }
    else { setEtfQty(sym, e.qty); if (e.hasCost && e.qty) setEtfCost(sym, Math.round(e.costTotal / e.qty * 100) / 100); }
  });
  LS.set("etfSymbols", syms);
  p.muni.forEach(h => { const { acctName, ...rest } = h; muniBonds.upsert({ ...rest, acct: keyOf(acctName) }); });
  p.gov.forEach(h => { const { acctName, ...rest } = h; govBonds.upsert({ ...rest, acct: keyOf(acctName) }); });
  // 피델리티 CSV의 머니마켓(SPAXX 등)은 계좌의 core 현금 → 현금 계좌 목록에 계좌별로 반영(JPM MMF 카드는 건드리지 않음)
  const cashIds = [];
  if (p.mmf.length) {
    const list = cashList();
    p.mmf.forEach(m => {
      const k = keyOf(m.acctName) || "fid_p";
      const id = k === "fid_p" && m.ticker === "SPAXX" ? "fid_spaxx" : `fidmmf_${k}_${m.ticker}`;
      const c = list.find(x => x.id === id);
      if (c) { c.balance = (cashIds.includes(id) ? c.balance : 0) + m.balance; }
      else list.push({ id, label: `피델리티 ${m.ticker} (${k === "fid_llc" ? "LLC" : "개인"} core)`, ticker: m.ticker, balance: m.balance, owner: acctOwner(k) || "personal", apy: 0 });
      if (!cashIds.includes(id)) cashIds.push(id);
    });
    LS.set("cash", list);
  }
  LS.set("lastImportAt", Date.now());
  markAsOf(...[...new Set(p.accounts.map(keyOf))].map(k => k && "acct:" + k), ...p.muni.concat(p.gov).map(h => "bond:" + h.cusip), ...cashIds.map(id => "cash:" + id));
  importPending = null;
  toast(`반영했어요 — ETF·주식 ${Object.keys(p.etf).length}종목(신규 ${added}), 채권 ${p.muni.length + p.gov.length}, MMF ${p.mmf.length}. 다시 불러옵니다`);
  setTimeout(() => location.reload(), 900);
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
homeSkeleton(); fxSkeleton(); etfSkeleton(); muniSkeleton(); incomeSkeleton(); newsSkeleton();
const lastTab = LS.get("lastTab", "home");
showTab(PANES.includes(lastTab) ? lastTab : "home"); // 없어진 탭(cd)이 저장돼 있을 수 있음

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
})();
