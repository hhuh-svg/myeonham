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
function fetchText(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal, cache: "no-store" })
    .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
    .finally(() => clearTimeout(t));
}
async function fetchFirstOkText(urls, ms = 8000) {
  let lastErr;
  for (const u of urls) {
    try { return await fetchText(u, ms); } catch (e) { lastErr = e; }
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

// =========================================================
// 탭 전환
// =========================================================
const PANES = ["fx", "etf", "muni", "cd", "news"];
const TITLES = { fx: "환율", etf: "ETF 시세", muni: "비과세 지방채", cd: "CD 금리", news: "뉴스" };
function showTab(tab) {
  PANES.forEach(p => { $("#pane-" + p).hidden = p !== tab; });
  $$('.tabs button').forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  $("#paneTitle").textContent = TITLES[tab];
  LS.set("lastTab", tab);
  if (tab === "fx" && !fxLoaded) loadFx();
  if (tab === "etf" && !etfLoadedOnce) loadEtf();
  if (tab === "muni" && !benchLoadedFor.muni) loadMuniBench();
  if (tab === "cd" && !benchLoadedFor.cd) loadCdBench();
  if (tab === "cd" && !cdRatesLoadedOnce) loadCdRates();
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
    <div class="card">
      <h2>네트워크 진단</h2>
      <p class="note">숫자가 안 뜰 때 어디서 막히는지 한 번에 확인합니다.</p>
      <div class="row" style="margin-top:8px"><button class="btn sm" id="diagRun">진단 실행</button></div>
      <div id="diagBox" style="margin-top:10px"></div>
    </div>
  `;
  $("#fxRefresh").addEventListener("click", () => loadFx(true));
  $("#convUsd").addEventListener("input", () => convertFrom("usd"));
  $("#convKrw").addEventListener("input", () => convertFrom("krw"));
  $("#diagRun").addEventListener("click", runDiagnostics);
}
async function runDiagnostics() {
  const box = $("#diagBox");
  const tests = [
    { name: "같은 사이트 파일 (GitHub Pages)", url: new URL("manifest.webmanifest", location.href).href },
    { name: "jsDelivr (대형 CDN)", url: "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json" },
    { name: "Google 번역 (translate.googleapis.com)", url: "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&q=test" },
    { name: "Frankfurter (환율 API)", url: "https://api.frankfurter.app/latest?from=USD&to=KRW" },
    { name: "Yahoo Finance (시세 API)", url: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL" },
    { name: "CORS 프록시 (codetabs)", url: "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent("https://api.frankfurter.app/latest?from=USD&to=KRW") },
    { name: "CORS 프록시 (allorigins)", url: "https://api.allorigins.win/raw?url=" + encodeURIComponent("https://api.frankfurter.app/latest?from=USD&to=KRW") }
  ];
  box.innerHTML = tests.map((t, i) => `<div class="small" id="diag${i}">⏳ ${escapeHtml(t.name)}</div>`).join("");
  await Promise.all(tests.map(async (t, i) => {
    const el = $("#diag" + i);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(t.url, { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(timer);
      el.innerHTML = r.ok ? `✅ ${escapeHtml(t.name)} (HTTP ${r.status})` : `❌ ${escapeHtml(t.name)} — HTTP ${r.status}`;
      el.style.color = r.ok ? "var(--ok)" : "var(--danger)";
    } catch (e) {
      el.innerHTML = `❌ ${escapeHtml(t.name)} — ${escapeHtml(e.message)}`;
      el.style.color = "var(--danger)";
    }
  }));
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
    const pos = d.pct >= 0;
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
      <div class="pc ${pos ? "pos" : "neg"}">${pos ? "▲" : "▼"} ${fmt(Math.abs(d.pct))}%</div>
      <div class="nm">${escapeHtml(d.name || "")}</div>
      ${parts.length ? `<div class="nm" style="color:var(--accent)">${parts.join(" · ")}</div>` : ""}
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
function yahooUrls(symbol) {
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y&events=div`;
  const target2 = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y&events=div`;
  return [target, target2, ...corsProxies(target)];
}
async function fetchQuote(symbol) {
  const json = await fetchFirstOk(yahooUrls(symbol), 7000);
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  if (!r || !r.meta) throw new Error("no data");
  const price = r.meta.regularMarketPrice;
  const prev = r.meta.chartPreviousClose ?? r.meta.previousClose;
  if (price == null || prev == null) throw new Error("no price");
  const divEvents = (r.events && r.events.dividends) ? Object.values(r.events.dividends) : [];
  const divHistory = divEvents
    .map(e => ({ date: new Date(e.date * 1000).toISOString().slice(0, 10), amount: e.amount }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3);
  return { price, pct: ((price - prev) / prev) * 100, name: r.meta.longName || r.meta.shortName || "", divHistory };
}
function quoteSummaryUrls(symbol) {
  const target = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=summaryDetail`;
  const target2 = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=summaryDetail`;
  return [target, target2, ...corsProxies(target)];
}
async function fetchDividend(symbol) {
  const json = await fetchFirstOk(quoteSummaryUrls(symbol), 7000);
  const sd = json && json.quoteSummary && json.quoteSummary.result && json.quoteSummary.result[0] && json.quoteSummary.result[0].summaryDetail;
  if (!sd) throw new Error("no dividend data");
  const y = sd.dividendYield && sd.dividendYield.raw;
  const r = sd.dividendRate && sd.dividendRate.raw;
  if (y == null && r == null) throw new Error("no dividend");
  return { yield: y != null ? y * 100 : null, rate: r != null ? r : null };
}
async function loadEtf() {
  etfLoadedOnce = true;
  const syms = LS.get("etfSymbols", DEFAULT_ETFS);
  renderEtfRows(syms, {});
  renderIndexRows({});
  const data = {};
  const idata = {};
  lastEtfData = data;
  await Promise.all([
    ...syms.map(async sym => {
      try { data[sym] = await fetchQuote(sym); }
      catch { data[sym] = { error: true }; renderEtfRows(syms, data); return; }
      renderEtfRows(syms, data);
      try { data[sym].div = await fetchDividend(sym); renderEtfRows(syms, data); } catch {}
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
const benchLoadedFor = { muni: false, cd: false };
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
function renderBondHoldings(boxId, ctrl, emptyLabel) {
  const box = $("#" + boxId);
  if (!box) return;
  const list = ctrl.load();
  if (!list.length) { box.innerHTML = `<div class="empty2">${emptyLabel}</div>`; return; }
  const enriched = list.map(h => ({ ...h, mv: h.face * h.price / 100 })).sort((a, b) => b.mv - a.mv);
  const totalMv = enriched.reduce((s, h) => s + h.mv, 0);
  box.innerHTML = `
    <div class="small" style="margin-bottom:10px">평가총액 $${fmtInt(totalMv)} (최근 입력가 기준)</div>
    ${enriched.map(h => `
      <div class="bondCard">
        <div class="bondName">${escapeHtml(h.name)}</div>
        <div class="small">CUSIP ${escapeHtml(h.cusip)} · ${fmt(h.coupon, 3)}% · 만기 ${h.maturity}</div>
        <div class="bondStats">
          <div><span class="k">평가액</span><span class="v">$${fmtInt(h.mv)}</span></div>
        </div>
        <div class="bondFoot">
          <span class="small">액면 $${fmtInt(h.face)} · 가격</span>
          <input class="qtyInput" data-price="${escapeHtml(h.cusip)}" type="number" step="0.001" value="${h.price}">
          <button class="delbtn" data-del="${escapeHtml(h.cusip)}" style="margin-left:auto">삭제</button>
        </div>
      </div>
    `).join("")}
    <p class="note">개별 채권 가격은 자동조회가 안 돼서 직접 확인해 가끔 업데이트해주세요.</p>
  `;
  $$("[data-price]", box).forEach(inp => inp.addEventListener("change", () => { ctrl.setPrice(inp.dataset.price, inp.value); renderBondHoldings(boxId, ctrl, emptyLabel); }));
  $$("[data-del]", box).forEach(b => b.addEventListener("click", () => { ctrl.delete(b.dataset.del); renderBondHoldings(boxId, ctrl, emptyLabel); }));
}
function renderMuniHoldings() { renderBondHoldings("muniHoldBox", muniBonds, "등록된 보유 지방채가 없습니다"); }
function renderGovBondHoldings() { renderBondHoldings("govHoldBox", govBonds, "등록된 보유 국채가 없습니다"); }
function muniSkeleton() {
  const c = LS.get("muniCalc", { fed: "32", state: "0", src: "irx", custom: "", check: "" });
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
    <div class="card" id="cdRatesCard"><h2><span class="lbl">피델리티 CD 금리 (실시간 시도)</span></h2><div class="status">불러오는 중…</div></div>
    <div class="card" id="cdBenchCard"><h2><span class="lbl">금리</span></h2><div class="status">불러오는 중…</div></div>
    <div class="row"><button class="btn sm" id="cdRefresh">새로고침</button></div>
    <p class="disclaim">브로커드 CD는 발행사·물량에 따라 보통 같은 만기 미국채보다 0.1~0.3%p 정도 높게 나오는 경우가 많습니다(시장 상황에 따라 다를 수 있음). 정확한 최신 금리는 <a href="https://www.fidelity.com/fixed-income-bonds/cds/new-issue-cds" target="_blank" rel="noopener">피델리티에서 직접 확인 ↗</a></p>
  `;
  $("#cdRefresh").addEventListener("click", () => { loadCdBench(true); loadCdRates(true); });
}
function computeMuniThreshold() {
  const c = LS.get("muniCalc", { fed: "32", state: "0", src: "irx", custom: "" });
  const fed = parseFloat(c.fed) || 0;
  const state = parseFloat(c.state) || 0;
  const base = c.src === "custom" ? parseFloat(c.custom) : bench[c.src];
  if (!Number.isFinite(base)) return null;
  const combo = Math.min(0.9, (fed + state) / 100);
  const srcInfo = BENCH_SERIES.find(s => s.key === c.src);
  return { threshold: base * (1 - combo), srcLabel: srcInfo ? srcInfo.label : "직접입력", fed, state };
}
function rateRow(label, val, first) {
  return `<div class="etfRow" style="grid-template-columns:1fr auto auto;${first ? "border-top:0" : ""}"><div class="sym">${label}</div><div class="px">${val != null ? fmt(val) + "%" : "조회 실패"}</div><div></div></div>`;
}
function renderCdBench() {
  const card = $("#cdBenchCard");
  if (!card) return;
  const vals = BENCH_SERIES.map(s => bench[s.key]);
  if (vals.every(v => v == null)) {
    card.innerHTML = `<h2><span class="lbl">금리</span></h2><div class="status err">조회 실패. 네트워크를 확인하고 새로고침 해주세요.</div>`;
    return;
  }
  const muni = computeMuniThreshold();
  card.innerHTML = `
    <h2><span class="lbl">금리</span></h2>
    <div class="small" style="margin:2px 0 4px">CD 금리 (벤치마크 — 브로커드 CD는 보통 이보다 0.1~0.3%p 높음)</div>
    ${rateRow("3개월", bench.irx, true)}
    ${rateRow("5년", bench.fvx)}
    <div class="small" style="margin:14px 0 4px">지방채 매수 기준선 (세후환산, 연방 ${muni ? muni.fed : "-"}%·주 ${muni ? muni.state : "-"}% 가정, 미국채 ${muni ? muni.srcLabel : "-"} 기준)</div>
    ${rateRow("세후환산 기준", muni ? muni.threshold : null, true)}
    <div class="small" style="margin:14px 0 4px">국채 금리 (전체 만기)</div>
    ${rateRow("3개월", bench.irx, true)}
    ${rateRow("5년", bench.fvx)}
    ${rateRow("10년", bench.tnx)}
    ${rateRow("30년", bench.tyx)}
  `;
}
async function loadCdBench(force) {
  benchLoadedFor.cd = true;
  try { await loadBenchmark(force); } catch {}
  renderCdBench();
  setUpdated(nowLabel() + " 업데이트");
}
// 피델리티 공개 CD 페이지에서 금리표를 직접 긁어오는 시도. 로그인 없이 보이는 화면이 JS로
// 렌더링되는 경우(흔함) 원문 HTML에는 숫자가 없어서 실패할 수 있음 — 그럴 땐 벤치마크로 대체.
async function fetchFidelityCdRates() {
  const target = "https://www.fidelity.com/fixed-income-bonds/cds/new-issue-cds";
  const urls = [...corsProxies(target), `https://r.jina.ai/${target}`];
  const html = await fetchFirstOkText(urls, 9000);
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ");
  const re = /(\d{1,2})\s*[-]?\s*(Month|Months|Year|Years|Mo|Yr)s?\b[^%\d]{0,40}?(\d{1,2}\.\d{1,3})\s*%/gi;
  const found = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(text)) && found.length < 12) {
    const key = m[1] + m[2][0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ term: `${m[1]} ${m[2]}`, apy: parseFloat(m[3]) });
  }
  if (!found.length) throw new Error("금리표를 찾지 못함 (페이지가 자바스크립트로 그려지는 경우일 수 있음)");
  return found;
}
let cdRatesLoadedOnce = false;
async function loadCdRates(force) {
  if (cdRatesLoadedOnce && !force) return;
  cdRatesLoadedOnce = true;
  const card = $("#cdRatesCard");
  card.innerHTML = `<h2><span class="lbl">피델리티 CD 금리 (실시간 시도)</span></h2><div class="status">불러오는 중…</div>`;
  try {
    const rates = await fetchFidelityCdRates();
    rates.sort((a, b) => b.apy - a.apy);
    card.innerHTML = `
      <h2><span class="lbl">피델리티 CD 금리 (실시간 시도)</span></h2>
      ${rates.map((r, i) => `<div class="etfRow" style="grid-template-columns:1fr auto auto;${i === 0 ? "border-top:0" : ""}"><div class="sym">${escapeHtml(r.term)}</div><div class="px">${fmt(r.apy)}%</div><div></div></div>`).join("")}
      <p class="note">피델리티 공개 페이지를 그대로 긁어온 값이라 표시 오류가 있을 수 있어요. 실제 매수 전엔 꼭 피델리티 앱에서 재확인하세요.</p>
    `;
  } catch (e) {
    card.innerHTML = `
      <h2><span class="lbl">피델리티 CD 금리 (실시간 시도)</span></h2>
      <div class="status err">자동으로 가져오지 못했습니다.</div>
      <div class="small" style="margin-top:4px;word-break:break-all">사유: ${escapeHtml(e.message)}</div>
      <p class="note">아래 미국채 벤치마크를 참고하거나, 피델리티에서 직접 확인해주세요.</p>
    `;
  }
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
async function fetchFeed(url, ms = 8000) {
  const urls = [url, ...corsProxies(url)];
  const xml = await fetchFirstOkText(urls, ms);
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
// 구글 번역 비공식 엔드포인트(무료/무키, 많은 오픈소스 번역위젯이 쓰는 방식) + 프록시 대체
async function translateToKo(text) {
  if (!text) return "";
  const target = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&q=${encodeURIComponent(text)}`;
  const json = await fetchFirstOk([target, ...corsProxies(target)], 6000);
  if (!Array.isArray(json) || !Array.isArray(json[0])) throw new Error("번역 응답 형식 오류");
  return json[0].map(seg => seg[0]).join("");
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
  items.forEach(async (it, idx) => {
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
fxSkeleton(); etfSkeleton(); muniSkeleton(); cdSkeleton(); newsSkeleton();
showTab(LS.get("lastTab", "fx"));

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
})();
