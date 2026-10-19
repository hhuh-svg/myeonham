// 자산 대시보드: 환율(USD/KRW) · 미국 주요 ETF 시세 · 비과세 지방채 세후환산 계산 · CD 금리 기록
// 데이터는 모두 공개 무료 API에서 실시간 조회. 지방채/CD는 실시간 전체목록 API가 없어
// 계산기 + 사용자가 피델리티에서 본 금리를 직접 기록하는 방식으로 구현.
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
const PANES = ["fx", "etf", "muni", "cd"];
const TITLES = { fx: "환율", etf: "ETF 시세", muni: "비과세 지방채", cd: "CD 금리" };
function showTab(tab) {
  PANES.forEach(p => { $("#pane-" + p).hidden = p !== tab; });
  $$('.tabs button').forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  $("#paneTitle").textContent = TITLES[tab];
  LS.set("lastTab", tab);
  if (tab === "fx" && !fxLoaded) loadFx();
  if (tab === "etf" && !etfLoadedOnce) loadEtf();
  if (tab === "muni") renderMuniLog();
  if (tab === "cd") renderCdLog();
}
$$('.tabs button').forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));

// =========================================================
// 1) 환율 (USD → KRW), frankfurter.app (무료/무키/CORS) + open.er-api.com (보조)
// =========================================================
let fxLoaded = false;
const paneFx = $("#pane-fx");
function fxSkeleton() {
  paneFx.innerHTML = `
    <div class="card" id="fxCard">
      <h2><span class="lbl">USD → KRW</span></h2>
      <div class="status">불러오는 중…</div>
    </div>
    <div class="card">
      <h2>환전 계산기</h2>
      <div class="conv">
        <span>$</span><input id="convUsd" type="number" inputmode="decimal" placeholder="100" step="0.01">
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
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}
async function loadFx(force) {
  fxLoaded = true;
  const card = $("#fxCard");
  card.innerHTML = `<h2><span class="lbl">USD → KRW</span></h2><div class="status">불러오는 중…</div>`;
  try {
    const today = new Date();
    const past = new Date(today.getTime() - 12 * 86400000);
    const iso = d => d.toISOString().slice(0, 10);
    let rate = null, history = [], prevRate = null;
    try {
      const series = await fetchJSON(`https://api.frankfurter.app/${iso(past)}..${iso(today)}?from=USD&to=KRW`);
      const days = Object.keys(series.rates || {}).sort();
      history = days.map(d => series.rates[d].KRW);
      if (history.length) {
        rate = history[history.length - 1];
        prevRate = history.length > 1 ? history[history.length - 2] : null;
      }
    } catch {}
    if (rate == null) {
      const cur = await fetchJSON(`https://api.frankfurter.app/latest?from=USD&to=KRW`);
      rate = cur.rates && cur.rates.KRW;
    }
    if (rate == null) {
      const alt = await fetchJSON(`https://open.er-api.com/v6/latest/USD`);
      rate = alt.rates && alt.rates.KRW;
    }
    if (rate == null) throw new Error("환율 조회 실패");
    fxRate = rate;
    const chg = prevRate != null ? rate - prevRate : null;
    const chgPct = prevRate != null ? (chg / prevRate) * 100 : null;
    card.innerHTML = `
      <h2><span class="lbl">USD → KRW</span></h2>
      <div class="fxRate">
        <span class="num">₩${fmt(rate)}</span>
        ${chg != null ? `<span class="chg ${chg >= 0 ? "pos" : "neg"}">${chg >= 0 ? "▲" : "▼"} ${fmt(Math.abs(chg))} (${fmt(Math.abs(chgPct))}%)</span>` : ""}
      </div>
      <div class="fxSub">1 USD 기준 · 중간시장가 참고용</div>
      ${history.length > 2 ? sparkSVG(history) : ""}
    `;
    convertFrom("usd"); convertFrom("krw");
    setUpdated(nowLabel() + " 업데이트");
  } catch (e) {
    card.innerHTML = `<h2><span class="lbl">USD → KRW</span></h2><div class="status err">환율 조회 실패. 네트워크를 확인하고 새로고침 해주세요.</div>`;
    toast("환율 조회 실패");
  }
}

// =========================================================
// 2) ETF 시세 (Yahoo Finance chart API, 무키 — 실패 시 대체 경로)
// =========================================================
const DEFAULT_ETFS = ["SPY", "QQQ", "VOO", "VTI", "DIA", "IWM", "GLD", "SCHD"];
let etfLoadedOnce = false;
const paneEtf = $("#pane-etf");
function etfSkeleton() {
  const syms = LS.get("etfSymbols", DEFAULT_ETFS);
  paneEtf.innerHTML = `
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
  $("#etfRefresh").addEventListener("click", () => loadEtf(true));
  $("#etfAddBtn").addEventListener("click", addEtfSymbol);
  $("#etfInput").addEventListener("keydown", e => { if (e.key === "Enter") addEtfSymbol(); });
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
  const data = {};
  await Promise.all(syms.map(async sym => {
    try { data[sym] = await fetchQuote(sym); }
    catch { data[sym] = { error: true }; }
    renderEtfRows(syms, data);
  }));
  setUpdated(nowLabel() + " 업데이트");
}

// =========================================================
// 3) 비과세 지방채(Municipal bond): 세후환산수익률(TEY) 계산기 + 피델리티 바로가기 + 기록장
// =========================================================
const paneMuni = $("#pane-muni");
function muniSkeleton() {
  const c = LS.get("muniCalc", { yield: "", fed: "32", state: "0" });
  paneMuni.innerHTML = `
    <div class="card">
      <div class="row" style="margin-bottom:4px">
        <a class="btn primary" href="https://www.fidelity.com/fixed-income-bonds/municipal-bonds" target="_blank" rel="noopener">피델리티 지방채 바로가기</a>
        <a class="btn" href="https://digital.fidelity.com/ftgw/digital/research/bond" target="_blank" rel="noopener">채권 스크리너 (로그인)</a>
      </div>
      <p class="note">지방채(municipal bond)는 로그인 후 개인별 화면·실시간 매물로만 제공되어 앱이 자동으로 긁어올 수 없습니다. 피델리티에서 수익률 상위 종목을 찾은 뒤, 아래 계산기로 CD 등 과세상품과 바로 비교해보세요.</p>
    </div>
    <div class="card calc">
      <h2>세후환산수익률(TEY) 계산기</h2>
      <div class="f"><label>지방채 수익률 (%)</label><input id="mYield" type="number" step="0.01" inputmode="decimal" value="${c.yield}" placeholder="예: 3.80"></div>
      <div class="two">
        <div class="f"><label>연방 소득세율 (%)</label><input id="mFed" type="number" step="1" inputmode="decimal" value="${c.fed}"></div>
        <div class="f"><label>주(State) 소득세율 (%)</label><input id="mState" type="number" step="1" inputmode="decimal" value="${c.state}"></div>
      </div>
      <div class="resultBox" id="mResult"><div class="small">수익률을 입력하세요</div></div>
      <p class="note">해당 주 발행 지방채는 연방+주 세금이 모두 면제(double tax-exempt)되는 경우가 많습니다. 주 세율은 "본인 거주주에서 발행한 지방채"에만 적용하세요. AMT 대상 채권·NIIT 등은 반영하지 않은 단순 참고치입니다. 투자 조언이 아닙니다.</p>
    </div>
    <div class="card">
      <h2>내가 본 지방채 기록</h2>
      <div id="muniLogBox"></div>
      <div class="row" style="margin-top:10px"><button class="btn sm" id="muniAddBtn">+ 기록 추가</button></div>
      <div class="logform" id="muniForm">
        <input id="mfName" placeholder="종목명 / 발행기관">
        <div class="two">
          <input id="mfState" placeholder="발행 주 (예: TX)" maxlength="2" style="text-transform:uppercase">
          <input id="mfMat" placeholder="만기 (예: 2034)">
        </div>
        <div class="two">
          <input id="mfYield" type="number" step="0.01" placeholder="수익률(%)">
          <button class="btn sm primary" id="mfSave">저장</button>
        </div>
      </div>
    </div>
  `;
  ["mYield", "mFed", "mState"].forEach(id => $("#" + id).addEventListener("input", calcMuni));
  calcMuni();
  $("#muniAddBtn").addEventListener("click", () => $("#muniForm").classList.toggle("open"));
  $("#mfSave").addEventListener("click", saveMuniLog);
  renderMuniLog();
}
function calcMuni() {
  const y = parseFloat($("#mYield").value);
  const fed = parseFloat($("#mFed").value) || 0;
  const state = parseFloat($("#mState").value) || 0;
  LS.set("muniCalc", { yield: $("#mYield").value, fed: $("#mFed").value, state: $("#mState").value });
  const box = $("#mResult");
  if (!isFinite(y) || y <= 0) { box.innerHTML = `<div class="small">수익률을 입력하세요</div>`; return; }
  const combo = Math.min(0.9, (fed + state) / 100);
  const fedOnly = Math.min(0.9, fed / 100);
  const teyCombo = y / (1 - combo);
  const teyFed = y / (1 - fedOnly);
  box.innerHTML = `
    <div class="big">${fmt(teyCombo)}%</div>
    <div class="small">연방+주 세율 적용 환산수익률 — 같은 세후 소득을 주려면 과세상품(CD 등)이 이 정도 금리여야 합니다.</div>
    <div class="small" style="margin-top:6px">연방세만 적용 시: ${fmt(teyFed)}%</div>
  `;
}
function loadMuniLog() { return LS.get("muniLog", []); }
function saveMuniLog() {
  const name = $("#mfName").value.trim();
  const y = parseFloat($("#mfYield").value);
  if (!name || !isFinite(y)) { toast("종목명과 수익률을 입력하세요"); return; }
  const list = loadMuniLog();
  list.push({ id: uid(), name, state: $("#mfState").value.trim().toUpperCase(), mat: $("#mfMat").value.trim(), yield: y, date: new Date().toISOString().slice(0, 10) });
  LS.set("muniLog", list);
  $("#mfName").value = ""; $("#mfState").value = ""; $("#mfMat").value = ""; $("#mfYield").value = "";
  $("#muniForm").classList.remove("open");
  renderMuniLog();
}
function deleteMuniLog(id) { LS.set("muniLog", loadMuniLog().filter(x => x.id !== id)); renderMuniLog(); }
function renderMuniLog() {
  const box = $("#muniLogBox");
  if (!box) return;
  const list = loadMuniLog().slice().sort((a, b) => b.yield - a.yield);
  if (!list.length) { box.innerHTML = `<div class="empty2">기록된 지방채가 없습니다</div>`; return; }
  box.innerHTML = `<table class="logtbl"><thead><tr><th>종목</th><th>주</th><th>만기</th><th>수익률</th><th></th></tr></thead><tbody>
    ${list.map((r, i) => `<tr class="${i === 0 ? "top" : ""}">
      <td class="name">${escapeHtml(r.name)}</td><td>${escapeHtml(r.state || "-")}</td><td>${escapeHtml(r.mat || "-")}</td>
      <td>${fmt(r.yield)}%</td><td class="del"><button class="delbtn" data-del="${r.id}">삭제</button></td>
    </tr>`).join("")}
  </tbody></table>`;
  $$("[data-del]", box).forEach(b => b.addEventListener("click", () => deleteMuniLog(b.dataset.del)));
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// =========================================================
// 4) CD 금리: 피델리티 바로가기 + 기록장 (실시간 전체목록 무료 API 없음 → 사용자가 본 금리 기록해 비교)
// =========================================================
const paneCd = $("#pane-cd");
function cdSkeleton() {
  paneCd.innerHTML = `
    <div class="card">
      <div class="row" style="margin-bottom:4px">
        <a class="btn primary" href="https://www.fidelity.com/fixed-income-bonds/cds/new-issue-cds" target="_blank" rel="noopener">피델리티 신규발행 CD 바로가기</a>
        <a class="btn" href="https://digital.fidelity.com/ftgw/digital/research/bond" target="_blank" rel="noopener">채권 스크리너 (로그인)</a>
      </div>
      <p class="note">브로커드 CD(brokered CD) 금리는 발행사·만기별로 매일 바뀌고 로그인 화면에만 공개되어 자동 조회가 불가합니다. 피델리티에서 확인한 금리를 아래에 기록하면 만기별로 가장 높은 금리를 한눈에 비교할 수 있습니다.</p>
    </div>
    <div class="card">
      <h2>내가 본 CD 금리 기록</h2>
      <div id="cdLogBox"></div>
      <div class="row" style="margin-top:10px"><button class="btn sm" id="cdAddBtn">+ 기록 추가</button></div>
      <div class="logform" id="cdForm">
        <input id="cfIssuer" placeholder="발행은행">
        <div class="two">
          <input id="cfTerm" placeholder="기간 (예: 1년)">
          <input id="cfApy" type="number" step="0.01" placeholder="APY(%)">
        </div>
        <button class="btn sm primary" id="cfSave">저장</button>
      </div>
    </div>
  `;
  $("#cdAddBtn").addEventListener("click", () => $("#cdForm").classList.toggle("open"));
  $("#cfSave").addEventListener("click", saveCdLog);
  renderCdLog();
}
function loadCdLog() { return LS.get("cdLog", []); }
function saveCdLog() {
  const issuer = $("#cfIssuer").value.trim();
  const apy = parseFloat($("#cfApy").value);
  if (!issuer || !isFinite(apy)) { toast("은행명과 APY를 입력하세요"); return; }
  const list = loadCdLog();
  list.push({ id: uid(), issuer, term: $("#cfTerm").value.trim() || "-", apy, date: new Date().toISOString().slice(0, 10) });
  LS.set("cdLog", list);
  $("#cfIssuer").value = ""; $("#cfTerm").value = ""; $("#cfApy").value = "";
  $("#cdForm").classList.remove("open");
  renderCdLog();
}
function deleteCdLog(id) { LS.set("cdLog", loadCdLog().filter(x => x.id !== id)); renderCdLog(); }
function renderCdLog() {
  const box = $("#cdLogBox");
  if (!box) return;
  const list = loadCdLog().slice().sort((a, b) => b.apy - a.apy);
  if (!list.length) { box.innerHTML = `<div class="empty2">기록된 CD 금리가 없습니다</div>`; return; }
  box.innerHTML = `<table class="logtbl"><thead><tr><th>은행</th><th>기간</th><th>APY</th><th>날짜</th><th></th></tr></thead><tbody>
    ${list.map((r, i) => `<tr class="${i === 0 ? "top" : ""}">
      <td class="name">${escapeHtml(r.issuer)}</td><td>${escapeHtml(r.term)}</td><td>${fmt(r.apy)}%</td><td>${r.date}</td>
      <td class="del"><button class="delbtn" data-del="${r.id}">삭제</button></td>
    </tr>`).join("")}
  </tbody></table>`;
  $$("[data-del]", box).forEach(b => b.addEventListener("click", () => deleteCdLog(b.dataset.del)));
}

// =========================================================
// 초기화
// =========================================================
fxSkeleton(); etfSkeleton(); muniSkeleton(); cdSkeleton();
showTab(LS.get("lastTab", "fx"));

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
})();
