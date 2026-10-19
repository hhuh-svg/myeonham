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
function fetchJSON(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal, cache: "no-store" })
    .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .finally(() => clearTimeout(t));
}
async function fetchFirstOk(urls, ms = 8000) {
  let lastErr;
  for (const u of urls) {
    try { return await fetchJSON(u, ms); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("모든 소스 실패");
}

// =========================================================
// 탭 전환
// =========================================================
const PANES = ["fx", "etf", "muni", "cd", "rates"];
const TITLES = { fx: "환율", etf: "ETF 시세", muni: "비과세 지방채", cd: "CD 금리", rates: "미국채 금리" };
function showTab(tab) {
  PANES.forEach(p => { $("#pane-" + p).hidden = p !== tab; });
  $$('.tabs button').forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  $("#paneTitle").textContent = TITLES[tab];
  LS.set("lastTab", tab);
  if (tab === "fx" && !fxLoaded) loadFx();
  if (tab === "etf" && !etfLoadedOnce) loadEtf();
  if (tab === "muni" && !benchLoadedFor.muni) loadMuniBench();
  if (tab === "cd" && !benchLoadedFor.cd) loadCdBench();
  if (tab === "rates" && !benchLoadedFor.rates) loadRatesBench();
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
    try {
      const series = await fetchJSON(`https://api.frankfurter.app/${iso(back)}..${iso(today)}?from=USD&to=KRW`);
      days = Object.keys(series.rates || {}).sort();
      history = days.map(d => series.rates[d].KRW);
      if (history.length) {
        rate = history[history.length - 1];
        prevRate = history.length > 1 ? history[history.length - 2] : null;
      }
    } catch (e) { errs.push("frankfurter(기간): " + e.message); }
    if (rate == null) {
      try {
        const cur = await fetchJSON(`https://api.frankfurter.app/latest?from=USD&to=KRW`);
        rate = cur.rates && cur.rates.KRW;
      } catch (e) { errs.push("frankfurter(현재): " + e.message); }
    }
    if (rate == null) {
      try {
        const alt = await fetchJSON(`https://open.er-api.com/v6/latest/USD`);
        rate = alt.rates && alt.rates.KRW;
      } catch (e) { errs.push("open.er-api: " + e.message); }
    }
    if (rate == null) {
      try {
        const alt2 = await fetchJSON(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json`);
        rate = alt2.usd && alt2.usd.krw;
      } catch (e) { errs.push("jsdelivr: " + e.message); }
    }
    if (rate == null) { const err = new Error("환율 조회 실패"); err.detail = errs.join(" / "); throw err; }
    fxRate = rate;
    const chg = prevRate != null ? rate - prevRate : null;
    const chgPct = prevRate != null ? (chg / prevRate) * 100 : null;
    const hasChart = history.length > 2;
    const hi = hasChart ? Math.max(...history) : null;
    const lo = hasChart ? Math.min(...history) : null;
    const periodChg = hasChart ? ((history[history.length - 1] - history[0]) / history[0]) * 100 : null;
    card.innerHTML = `
      <h2><span class="lbl">USD → KRW</span></h2>
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
          <span class="${periodChg >= 0 ? "pos" : "neg"}">${FX_PERIOD_LABELS[fxPeriod]} ${periodChg >= 0 ? "▲" : "▼"} ${fmt(Math.abs(periodChg))}%</span>
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
    setUpdated(nowLabel() + " 업데이트");
  } catch (e) {
    card.innerHTML = `
      <h2><span class="lbl">USD → KRW</span></h2>
      <div class="status err">환율 조회 실패. 네트워크를 확인하고 새로고침 해주세요.</div>
      ${e.detail ? `<div class="small" style="margin-top:8px;word-break:break-all">실패 원인: ${escapeHtml(e.detail)}</div>` : ""}
    `;
    toast("환율 조회 실패");
  }
}

// =========================================================
// 2) ETF 시세 (Yahoo Finance chart API, 무키 — 실패 시 대체 경로)
// =========================================================
const DEFAULT_ETFS = ["SPY", "QQQ", "VOO", "VTI", "DIA", "IWM", "GLD", "SCHD"];
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
      <div class="etfAdd">
        <input id="etfInput" placeholder="예: ARKK" maxlength="6">
        <button class="btn sm" id="etfAddBtn">추가</button>
      </div>
    </div>
    <div class="row"><button class="btn sm" id="etfRefresh">새로고침</button></div>
    <p class="disclaim">15~20분 지연 시세일 수 있으며 참고용입니다. 실제 체결가는 피델리티 앱에서 확인하세요.</p>
  `;
  renderEtfRows(syms, {});
  renderIndexRows({});
  $("#etfRefresh").addEventListener("click", () => loadEtf(true));
  $("#etfAddBtn").addEventListener("click", addEtfSymbol);
  $("#etfInput").addEventListener("keydown", e => { if (e.key === "Enter") addEtfSymbol(); });
}
function renderIndexRows(data) {
  const box = $("#indexList");
  if (!box) return;
  box.innerHTML = INDEX_TICKERS.map(({ sym, label }, i) => {
    const d = data[sym];
    const base = `style="grid-template-columns:1fr auto auto;${i === 0 ? "border-top:0" : ""}"`;
    if (!d) return `<div class="etfRow" ${base}><div class="sym">${label}</div><div class="px">…</div><div></div></div>`;
    if (d.error) return `<div class="etfRow" ${base}><div class="sym">${label}</div><div class="err">조회 실패</div><div></div></div>`;
    const pos = d.pct >= 0;
    return `<div class="etfRow" ${base}>
      <div class="sym">${label}</div>
      <div class="px">${fmt(d.price)}</div>
      <div class="pc ${pos ? "pos" : "neg"}">${pos ? "▲" : "▼"} ${fmt(Math.abs(d.pct))}%</div>
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
  loadEtf(true);
}
function removeEtfSymbol(sym) {
  const syms = LS.get("etfSymbols", DEFAULT_ETFS).filter(s => s !== sym);
  LS.set("etfSymbols", syms);
  loadEtf(true);
}
function renderEtfRows(syms, data) {
  const box = $("#etfList");
  if (!box) return;
  box.innerHTML = syms.map(sym => {
    const s = escapeHtml(sym);
    const d = data[sym];
    if (!d) return `<div class="etfRow" data-sym="${s}"><div class="sym">${s}</div><div class="px">…</div><div></div></div>`;
    if (d.error) return `<div class="etfRow" data-sym="${s}"><div class="sym">${s}</div><div class="err">조회 실패</div><button class="delbtn" data-del="${s}">삭제</button></div>`;
    const pos = d.pct >= 0;
    return `<div class="etfRow" data-sym="${s}">
      <div class="sym">${s}<button class="delbtn" data-del="${s}" style="margin-left:6px">삭제</button></div>
      <div class="px">$${fmt(d.price)}</div>
      <div class="pc ${pos ? "pos" : "neg"}">${pos ? "▲" : "▼"} ${fmt(Math.abs(d.pct))}%</div>
      <div class="nm">${escapeHtml(d.name || "")}</div>
    </div>`;
  }).join("");
  $$("[data-del]", box).forEach(b => b.addEventListener("click", () => removeEtfSymbol(b.dataset.del)));
}
function yahooUrls(symbol) {
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const target2 = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  return [
    target,
    target2,
    `https://corsproxy.io/?url=${encodeURIComponent(target)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`
  ];
}
async function fetchQuote(symbol) {
  const json = await fetchFirstOk(yahooUrls(symbol), 7000);
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  if (!r || !r.meta) throw new Error("no data");
  const price = r.meta.regularMarketPrice;
  const prev = r.meta.chartPreviousClose ?? r.meta.previousClose;
  if (price == null || prev == null) throw new Error("no price");
  return { price, pct: ((price - prev) / prev) * 100, name: r.meta.longName || r.meta.shortName || "" };
}
async function loadEtf() {
  etfLoadedOnce = true;
  const syms = LS.get("etfSymbols", DEFAULT_ETFS);
  renderEtfRows(syms, {});
  renderIndexRows({});
  const data = {};
  const idata = {};
  await Promise.all([
    ...syms.map(async sym => {
      try { data[sym] = await fetchQuote(sym); }
      catch { data[sym] = { error: true }; }
      renderEtfRows(syms, data);
    }),
    ...INDEX_TICKERS.map(async ({ sym }) => {
      try { idata[sym] = await fetchQuote(sym); }
      catch { idata[sym] = { error: true }; }
      renderIndexRows(idata);
    })
  ]);
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
const benchLoadedFor = { muni: false, cd: false, rates: false };
let bench = { irx: null, fvx: null, tnx: null, tyx: null, loadedAt: 0 };
async function loadBenchmark(force) {
  if (bench.loadedAt && !force && Date.now() - bench.loadedAt < 5 * 60000) return bench;
  const results = await Promise.allSettled(BENCH_SERIES.map(s => fetchQuote(s.ticker)));
  const next = { loadedAt: Date.now() };
  BENCH_SERIES.forEach((s, i) => { next[s.key] = results[i].status === "fulfilled" ? results[i].value.price : null; });
  bench = next;
  return bench;
}

// =========================================================
// 4) 비과세 지방채: "지금 사도 될 만한 수익률인가" 자동 기준선 계산기
// =========================================================
const paneMuni = $("#pane-muni");
function muniSkeleton() {
  const c = LS.get("muniCalc", { fed: "32", state: "0", src: "irx", custom: "", check: "" });
  paneMuni.innerHTML = `
    <div class="card calc">
      <h2>매수 기준선 (자동 계산)</h2>
      <div class="f"><label>비교 기준</label>
        <select id="mSrc">
          ${BENCH_SERIES.map(s => `<option value="${s.key}">미국채 ${s.label} — <span id="mVal_${s.key}">…</span></option>`).join("")}
          <option value="custom">직접 입력</option>
        </select>
      </div>
      <div class="f" id="mCustomWrap" hidden><label>비교 수익률 (%)</label><input id="mCustom" type="number" step="0.01" inputmode="decimal" placeholder="예: 4.50" value="${c.custom}"></div>
      <div class="two">
        <div class="f"><label>연방 소득세율 (%)</label><input id="mFed" type="number" step="1" inputmode="decimal" value="${c.fed}"></div>
        <div class="f"><label>주(State) 소득세율 (%)</label><input id="mState" type="number" step="1" inputmode="decimal" value="${c.state}"></div>
      </div>
      <div class="resultBox" id="mResult"><div class="small">불러오는 중…</div></div>
      <p class="note">텍사스(TX)처럼 주소득세가 없으면 주 세율은 0으로 둡니다. AMT 대상 채권·NIIT 등은 반영하지 않은 단순 참고치이며 투자 조언이 아닙니다.</p>
    </div>
    <div class="card calc">
      <h2>후보 종목 바로 확인</h2>
      <div class="f"><label>확인하고 싶은 지방채 수익률 (%)</label><input id="mCheck" type="number" step="0.01" inputmode="decimal" placeholder="예: 3.80" value="${c.check}"></div>
      <div class="resultBox" id="mCheckResult"><div class="small">수익률을 입력하면 기준선과 바로 비교해드려요</div></div>
    </div>
    <div class="row"><button class="btn sm" id="muniRefresh">미국채 수익률 새로고침</button></div>
    <p class="disclaim">개별 지방채 매물 목록은 로그인 전용이라 이 앱이 직접 가져올 순 없습니다 — <a href="https://www.fidelity.com/fixed-income-bonds/municipal-bonds" target="_blank" rel="noopener">피델리티에서 찾기 ↗</a></p>
  `;
  $("#mSrc").value = c.src;
  $("#mCustomWrap").hidden = c.src !== "custom";
  $("#mSrc").addEventListener("change", () => { $("#mCustomWrap").hidden = $("#mSrc").value !== "custom"; calcMuni(); });
  ["mCustom", "mFed", "mState"].forEach(id => $("#" + id).addEventListener("input", calcMuni));
  $("#mCheck").addEventListener("input", calcMuni);
  $("#muniRefresh").addEventListener("click", () => loadMuniBench(true));
}
function muniThreshold() {
  const fed = parseFloat($("#mFed").value) || 0;
  const state = parseFloat($("#mState").value) || 0;
  const src = $("#mSrc").value;
  const base = src === "custom" ? parseFloat($("#mCustom").value) : bench[src];
  LS.set("muniCalc", { fed: $("#mFed").value, state: $("#mState").value, src, custom: $("#mCustom").value, check: $("#mCheck").value });
  if (!Number.isFinite(base)) return null;
  const combo = Math.min(0.9, (fed + state) / 100);
  return base * (1 - combo);
}
function calcMuni() {
  BENCH_SERIES.forEach(s => {
    const el = $("#mVal_" + s.key);
    if (el) el.textContent = bench[s.key] != null ? fmt(bench[s.key]) + "%" : (bench.loadedAt ? "조회 실패" : "…");
  });
  const box = $("#mResult");
  const th = muniThreshold();
  if (th == null) {
    box.innerHTML = `<div class="small">기준 수익률을 가져오지 못했습니다. 새로고침하거나 직접 입력을 선택하세요.</div>`;
  } else {
    box.innerHTML = `
      <div class="big">${fmt(th)}%</div>
      <div class="small">지방채 수익률이 이 이상이면, 세후 기준으로 선택한 미국채보다 유리합니다.</div>
    `;
  }
  const cbox = $("#mCheckResult");
  const y = parseFloat($("#mCheck").value);
  if (!cbox) return;
  if (!isFinite(y) || y <= 0) { cbox.innerHTML = `<div class="small">수익률을 입력하면 기준선과 바로 비교해드려요</div>`; return; }
  if (th == null) { cbox.innerHTML = `<div class="small">기준선을 먼저 확인해주세요</div>`; return; }
  const ok = y >= th;
  const fed = parseFloat($("#mFed").value) || 0;
  const state = parseFloat($("#mState").value) || 0;
  const combo = Math.min(0.9, (fed + state) / 100);
  const tey = y / (1 - combo);
  cbox.innerHTML = `
    <div class="big" style="color:${ok ? "var(--ok)" : "var(--danger)"}">${ok ? "✅ 기준 충족" : "❌ 기준 미달"}</div>
    <div class="small">세후환산수익률(TEY): ${fmt(tey)}% — 과세상품으로 같은 세후소득을 받으려면 이 정도 금리가 필요합니다.</div>
  `;
}
async function loadMuniBench(force) {
  benchLoadedFor.muni = true;
  try { await loadBenchmark(force); } catch {}
  calcMuni();
  setUpdated(nowLabel() + " 업데이트");
}

// =========================================================
// 5) CD: 피델리티 바로가기 + 미국채 벤치마크 자동 표시(브로커드 CD는 보통 이보다 소폭 높게 나옴)
// =========================================================
const paneCd = $("#pane-cd");
function cdSkeleton() {
  paneCd.innerHTML = `
    <div class="card" id="cdBenchCard"><h2><span class="lbl">미국채 수익률 (참고 벤치마크)</span></h2><div class="status">불러오는 중…</div></div>
    <div class="row"><button class="btn sm" id="cdRefresh">새로고침</button></div>
    <p class="disclaim">브로커드 CD는 발행사·물량에 따라 보통 같은 만기 미국채보다 0.1~0.3%p 정도 높게 나오는 경우가 많습니다(시장 상황에 따라 다를 수 있음). 개별 금리 "최고가"는 로그인 전용이라 이 앱이 직접 가져올 순 없습니다 — <a href="https://www.fidelity.com/fixed-income-bonds/cds/new-issue-cds" target="_blank" rel="noopener">피델리티에서 찾기 ↗</a></p>
  `;
  $("#cdRefresh").addEventListener("click", () => loadCdBench(true));
}
function renderCdBench() {
  const card = $("#cdBenchCard");
  if (!card) return;
  if (bench.irx == null && bench.fvx == null) {
    card.innerHTML = `<h2><span class="lbl">미국채 수익률 (참고 벤치마크)</span></h2><div class="status err">조회 실패. 네트워크를 확인하고 새로고침 해주세요.</div>`;
    return;
  }
  card.innerHTML = `
    <h2><span class="lbl">미국채 수익률 (참고 벤치마크)</span></h2>
    <div class="etfRow" style="border-top:0"><div class="sym">3개월 (단기)</div><div class="px">${bench.irx != null ? fmt(bench.irx) + "%" : "조회 실패"}</div><div></div></div>
    <div class="etfRow"><div class="sym">5년 (중기)</div><div class="px">${bench.fvx != null ? fmt(bench.fvx) + "%" : "조회 실패"}</div><div></div></div>
  `;
}
async function loadCdBench(force) {
  benchLoadedFor.cd = true;
  try { await loadBenchmark(force); } catch {}
  renderCdBench();
  setUpdated(nowLabel() + " 업데이트");
}

// =========================================================
// 6) 미국채 금리 커브: 3개월~30년 수익률을 한눈에 (지수 자동표시도 ETF 탭 상단에 추가)
// =========================================================
const paneRates = $("#pane-rates");
function ratesSkeleton() {
  paneRates.innerHTML = `
    <div class="card" id="ratesCard"><h2><span class="lbl">미국채 금리 커브</span></h2><div class="status">불러오는 중…</div></div>
    <div class="row"><button class="btn sm" id="ratesRefresh">새로고침</button></div>
    <p class="disclaim">Yahoo Finance의 미국채 지수(3개월물·5년물·10년물·30년물)를 그대로 보여줍니다. 보통 단기보다 장기 금리가 높으면 정상적인 커브, 반대면 "역전"된 상태로 봅니다.</p>
  `;
  $("#ratesRefresh").addEventListener("click", () => loadRatesBench(true));
}
function renderRatesBench() {
  const card = $("#ratesCard");
  if (!card) return;
  const vals = BENCH_SERIES.map(s => bench[s.key]).filter(v => v != null);
  if (!vals.length) {
    card.innerHTML = `<h2><span class="lbl">미국채 금리 커브</span></h2><div class="status err">조회 실패. 네트워크를 확인하고 새로고침 해주세요.</div>`;
    return;
  }
  const max = Math.max(...vals);
  card.innerHTML = `
    <h2><span class="lbl">미국채 금리 커브</span></h2>
    ${BENCH_SERIES.map(s => {
      const v = bench[s.key];
      const pct = v != null ? Math.max(4, (v / max) * 100) : 0;
      return `<div class="curveRow">
        <div class="lbl">${s.label}</div>
        <div class="curveBar">${v != null ? `<i style="width:${pct}%"></i>` : ""}</div>
        <div class="val">${v != null ? fmt(v) + "%" : "실패"}</div>
      </div>`;
    }).join("")}
  `;
}
async function loadRatesBench(force) {
  benchLoadedFor.rates = true;
  try { await loadBenchmark(force); } catch {}
  renderRatesBench();
  setUpdated(nowLabel() + " 업데이트");
}

// =========================================================
// 초기화
// =========================================================
fxSkeleton(); etfSkeleton(); muniSkeleton(); cdSkeleton(); ratesSkeleton();
showTab(LS.get("lastTab", "fx"));

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
})();
