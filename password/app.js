const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const CATS = ["업무", "금융", "쇼핑", "소셜", "이메일", "엔터테인먼트", "공공·행정", "기타"];
const COLORS = ["#2E5E4E", "#1F5F8B", "#7A4E9E", "#B3542E", "#9A6B00", "#2C7A4B", "#8C2F5E", "#3E5A7A"];
const AUTOLOCK_KEY = "pwvault.autolock";
const CLIP_CLEAR_MS = 30000;

let key = null, entries = [], filter = "전체", favOnly = false, lockTimer = null, hiddenAt = 0, lastCopy = null;

/* ---------- 공통 ---------- */
function toast(t, ms = 2000) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => el.hidden = true, ms); }
async function copy(t, label = "복사했어요", sensitive = false) {
  try { await navigator.clipboard.writeText(t); }
  catch { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
  if (sensitive) {
    const token = lastCopy = {};
    toast(`${label} · 30초 후 클립보드에서 지워요`, 2600);
    setTimeout(async () => { if (lastCopy !== token) return; try { await navigator.clipboard.writeText(""); } catch {} }, CLIP_CLEAR_MS);
  } else toast(label);
}
function host(url) { try { return new URL(/^https?:\/\//i.test(url) ? url : "https://" + url).hostname.replace(/^www\./, ""); } catch { return ""; } }
function href(url) { if (!url) return ""; return /^https?:\/\//i.test(url) ? url : "https://" + url; }
function colorFor(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; }
function avatar(e, cls = "ava") { const n = (e.site || host(e.url) || "?").trim(); return `<div class="${cls}" style="background:${colorFor(n)}">${esc(n[0].toUpperCase())}</div>`; }
function fmtDate(t) { if (!t) return ""; const d = new Date(t); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`; }
function saveFile(name, blob) {
  const f = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [f] })) return navigator.share({ files: [f], title: name }).catch(e => { if (e.name !== "AbortError") download(name, blob); });
  download(name, blob);
}
function download(name, blob) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }
const ICON = {
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeoff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3l18 18M10.6 10.6A3 3 0 0 0 13.4 13.4M9.9 5.2A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.2 6.2C3.6 8 2 12 2 12s3.5 7 10 7c1.6 0 3-.3 4.2-.9"/></svg>',
  dice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="15" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/><circle cx="9" cy="15" r="1" fill="currentColor"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
};

/* ---------- 비밀번호 강도 / 생성 ---------- */
function strength(pw) {
  if (!pw) return { score: 0, label: "" };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26; if (/[A-Z]/.test(pw)) pool += 26; if (/\d/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 33; if (/[^\x00-\x7F]/.test(pw)) pool += 100;
  let bits = pw.length * Math.log2(pool || 1);
  if (/^(.)\1+$/.test(pw)) bits = 4;
  if (/(.)\1{2,}/.test(pw)) bits -= 8;
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf|zxcv|password|passw0rd|iloveyou|letmein|admin|qwerty)/i.test(pw)) bits -= 20;
  if (/^(19|20)\d{2}[01]?\d[0-3]?\d$/.test(pw)) bits = 10;
  if (pw.length < 8) bits = Math.min(bits, 25);
  bits = Math.max(0, bits);
  const score = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { score, label: ["매우 약함", "약함", "보통", "강함", "매우 강함"][score], bits: Math.round(bits) };
}
function genPassword(o) {
  const sets = [];
  const amb = o.noAmbig ? /[Il1O0o|`'"]/g : null;
  const clean = s => amb ? s.replace(amb, "") : s;
  if (o.lower) sets.push(clean("abcdefghijklmnopqrstuvwxyz"));
  if (o.upper) sets.push(clean("ABCDEFGHIJKLMNOPQRSTUVWXYZ"));
  if (o.digit) sets.push(clean("0123456789"));
  if (o.symbol) sets.push(clean("!@#$%^&*()-_=+[]{};:,.?/~"));
  if (!sets.length) sets.push("abcdefghijklmnopqrstuvwxyz");
  const all = sets.join(""), len = Math.max(sets.length, o.length | 0);
  const pick = s => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  const out = sets.map(pick);
  while (out.length < len) out.push(pick(all));
  for (let i = out.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join("");
}
function reuseMap() { const m = new Map(); for (const e of entries) if (e.password) m.set(e.password, (m.get(e.password) || 0) + 1); return m; }
function meterHTML(pw, id = "meter") { const s = strength(pw); return `<div class="meter${pw ? " s" + s.score : ""}" id="${id}"><i></i></div><div class="mlabel" id="${id}L"><span>${pw ? esc(s.label) : "&nbsp;"}</span><span>${pw ? pw.length + "자" : ""}</span></div>`; }
function updateMeter(pw, id = "meter") { const s = strength(pw); const m = $("#" + id); if (!m) return; m.className = pw ? "meter s" + s.score : "meter"; $("#" + id + "L").innerHTML = `<span>${pw ? esc(s.label) : "&nbsp;"}</span><span>${pw ? pw.length + "자" : ""}</span>`; }

/* ---------- 잠금 / 자동 잠금 ---------- */
function autolockMin() { const v = localStorage.getItem(AUTOLOCK_KEY); return v == null ? 5 : Number(v); }
function armLock() {
  clearTimeout(lockTimer);
  const m = autolockMin(); if (!key || !m) return;
  lockTimer = setTimeout(() => lock("자동으로 잠갔어요"), m * 60000);
}
function lock(msg) {
  key = null; entries = []; clearTimeout(lockTimer);
  ["#detail", "#editor", "#settings"].forEach(s => { $(s).hidden = true; $(s).innerHTML = ""; });
  $("#list").innerHTML = ""; $("#emptyBox").innerHTML = ""; $("#count").textContent = "";
  showLock(); if (msg) toast(msg);
}
["pointerdown", "keydown", "touchstart", "scroll"].forEach(ev => addEventListener(ev, () => { if (key) armLock(); }, { passive: true }));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (key && hiddenAt && autolockMin() && Date.now() - hiddenAt > autolockMin() * 60000) lock("자동으로 잠갔어요");
});

async function showLock() {
  const el = $("#lock"); el.hidden = false;
  const has = await Vault.exists();
  el.innerHTML = `<div class="box">
    <div class="logo">${ICON.lock}</div>
    <h2>${has ? "비밀번호 금고" : "금고 만들기"}</h2>
    <p>${has ? "마스터 비밀번호를 입력하세요" : "모든 비밀번호를 지키는 단 하나의 마스터 비밀번호를 정하세요"}</p>
    <form id="lockForm" autocomplete="off">
      <div class="f"><div class="pw"><input id="mpw" type="password" placeholder="마스터 비밀번호" autocomplete="${has ? "current-password" : "new-password"}" required autofocus><button type="button" class="x" data-eye="mpw" aria-label="보기">${ICON.eye}</button></div>${has ? "" : meterHTML("")}</div>
      ${has ? "" : `<div class="f"><input id="mpw2" type="password" placeholder="마스터 비밀번호 확인" autocomplete="new-password" required></div>
      <div class="hint"><b>중요:</b> 마스터 비밀번호는 어디에도 저장되지 않아 잊으면 되찾을 수 없어요. 길고 기억하기 쉬운 문장형(예: 띄어쓰기 포함 4~5개 단어)을 권해요.</div>`}
      <div id="lockStat"></div>
      <button class="btn primary" type="submit" id="lockGo">${has ? "열기" : "금고 만들기"}</button>
    </form>
    <p class="small">데이터는 이 폰의 브라우저 안에만 암호화되어 저장돼요. 서버로 보내지 않아요.</p>
  </div>`;
  const stat = h => $("#lockStat").innerHTML = h;
  if (!has) $("#mpw").oninput = e => updateMeter(e.target.value);
  el.onclick = e => { const b = e.target.closest("[data-eye]"); if (b) toggleEye(b); };
  $("#lockForm").onsubmit = async e => {
    e.preventDefault();
    const pw = $("#mpw").value, go = $("#lockGo"); go.disabled = true;
    try {
      if (!has) {
        if (pw.length < 8) { stat(`<div class="status err">8자 이상으로 정해 주세요.</div>`); return; }
        if (pw !== $("#mpw2").value) { stat(`<div class="status err">확인 비밀번호가 달라요.</div>`); return; }
        if (strength(pw).score < 2) { stat(`<div class="status err">너무 약해요. 더 길게 하거나 숫자·기호를 섞어 주세요.</div>`); return; }
        stat(`<div class="status">금고를 만드는 중…</div>`);
        key = await Vault.create(pw);
      } else {
        stat(`<div class="status">확인 중…</div>`);
        key = await Vault.unlock(pw);
        if (!key) { stat(`<div class="status err">마스터 비밀번호가 맞지 않아요.</div>`); $("#mpw").select(); return; }
      }
      el.hidden = true; el.innerHTML = ""; await reload(); armLock();
    } finally { go.disabled = false; }
  };
  setTimeout(() => $("#mpw")?.focus(), 50);
}
function toggleEye(b) { const i = $("#" + b.dataset.eye); i.type = i.type === "password" ? "text" : "password"; b.innerHTML = i.type === "password" ? ICON.eye : ICON.eyeoff; }

/* ---------- 목록 ---------- */
async function reload() { try { entries = await Vault.loadAll(key); } catch { entries = []; toast("저장소를 열 수 없어요"); } render(); }
function sorted(list) {
  const s = $("#sort").value;
  return [...list].sort((a, b) => (b.favorite | 0) - (a.favorite | 0) || (
    s === "new" ? (b.updatedAt || 0) - (a.updatedAt || 0) :
    s === "used" ? (b.lastUsed || 0) - (a.lastUsed || 0) :
    (a.site || "").localeCompare(b.site || "", "ko")));
}
function render() {
  const q = $("#q").value.trim().toLowerCase(), reuse = reuseMap();
  const counts = {}; for (const e of entries) counts[e.category || "기타"] = (counts[e.category || "기타"] || 0) + 1;
  const favN = entries.filter(e => e.favorite).length;
  $("#rail").innerHTML = [`<button class="chip" data-cat="전체" aria-pressed="${filter === "전체" && !favOnly}">전체<b>${entries.length}</b></button>`,
    `<button class="chip" data-fav aria-pressed="${favOnly}">★ 즐겨찾기<b>${favN}</b></button>`,
    ...CATS.filter(c => counts[c]).map(c => `<button class="chip" data-cat="${c}" aria-pressed="${filter === c && !favOnly}">${c}<b>${counts[c]}</b></button>`)].join("");
  let list = entries.filter(e => (favOnly ? e.favorite : (filter === "전체" || (e.category || "기타") === filter)) &&
    (!q || [e.site, e.url, e.username, e.note, e.category].some(v => (v || "").toLowerCase().includes(q))));
  list = sorted(list);
  $("#count").textContent = entries.length ? `${list.length}/${entries.length}` : "";
  $("#list").innerHTML = list.map(e => {
    const st = strength(e.password), tags = [`<span class="tag cat">${esc(e.category || "기타")}</span>`];
    if (e.password && reuse.get(e.password) > 1) tags.push(`<span class="tag warn">재사용</span>`);
    if (e.password && st.score <= 1) tags.push(`<span class="tag bad">${esc(st.label)}</span>`);
    return `<div class="item" role="button" tabindex="0" data-open="${e.id}">${avatar(e)}
      <div class="meta"><div class="n">${e.favorite ? '<span class="star">★</span>' : ""}<span>${esc(e.site || host(e.url) || "(이름 없음)")}</span></div>
      <div class="c">${esc(e.username || host(e.url) || "")}</div><div>${tags.join("")}</div></div>
      <div class="quick"><button class="qbtn" data-copypw="${e.id}" aria-label="비밀번호 복사" title="비밀번호 복사">${ICON.copy}</button></div></div>`;
  }).join("");
  $("#emptyBox").innerHTML = entries.length ? (list.length ? "" : `<div class="empty">검색 결과가 없어요</div>`) :
    `<div class="empty"><h2>아직 저장된 비밀번호가 없어요</h2><p>오른쪽 아래 <b>추가</b>를 눌러 첫 항목을 저장하거나,<br>백업·설정에서 다른 앱의 CSV를 가져오세요.</p></div>`;
}
$("#q").oninput = render; $("#sort").onchange = render;
$("#rail").onclick = e => { const b = e.target.closest(".chip"); if (!b) return; if (b.hasAttribute("data-fav")) favOnly = !favOnly; else { favOnly = false; filter = b.dataset.cat; } render(); };
$("#list").onclick = async e => {
  const c = e.target.closest("[data-copypw]"); if (c) { e.stopPropagation(); const en = entries.find(x => x.id === c.dataset.copypw); if (en) { await copy(en.password, "비밀번호 복사", true); touch(en); } return; }
  const it = e.target.closest("[data-open]"); if (it) openDetail(it.dataset.open);
};
$("#list").onkeydown = e => { if (e.key === "Enter") { const it = e.target.closest("[data-open]"); if (it) openDetail(it.dataset.open); } };
$("#fab").onclick = () => openEditor(null);
$("#lockBtn").onclick = () => lock();
$("#menuBtn").onclick = openSettings;
async function touch(en) { en.lastUsed = Date.now(); try { await Vault.save(key, en); } catch {} }

/* ---------- 상세 ---------- */
function openDetail(id) {
  const c = entries.find(x => x.id === id); if (!c) return;
  const el = $("#detail"); el.hidden = false; el.scrollTop = 0;
  const u = href(c.url), st = strength(c.password), reused = c.password && reuseMap().get(c.password) > 1;
  el.innerHTML = `<div class="wrap">
    <div class="bar"><button class="tbtn l" data-close>‹ 목록</button><h2>${esc(c.site || "")}</h2><button class="tbtn r" data-edit>수정</button></div>
    <div class="body">
      <div class="who">${avatar(c)}<div><h3>${esc(c.site || host(c.url) || "(이름 없음)")}</h3>${u ? `<div class="alt">${esc(host(c.url) || c.url)}</div>` : ""}</div></div>
      ${reused || st.score <= 1 ? `<div class="status warn">${reused ? "다른 사이트와 같은 비밀번호를 쓰고 있어요. " : ""}${st.score <= 1 ? "비밀번호가 약해요. " : ""}바꾸는 걸 권해요.</div>` : ""}
      <div class="rows">
        ${u ? `<div class="row"><div><div class="k">사이트</div><a class="v" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(c.url)}</a></div><div class="acts"><button class="qbtn" data-copy="${esc(c.url)}" aria-label="주소 복사">${ICON.copy}</button></div></div>` : ""}
        <div class="row"><div><div class="k">아이디</div><div class="v num">${esc(c.username || "—")}</div></div><div class="acts">${c.username ? `<button class="qbtn" data-copy="${esc(c.username)}" aria-label="아이디 복사">${ICON.copy}</button>` : ""}</div></div>
        <div class="row"><div><div class="k">비밀번호 <span class="small">· ${esc(st.label)}</span></div><div class="v num" id="pwv">${c.password ? "••••••••••" : "—"}</div></div>
          <div class="acts">${c.password ? `<button class="qbtn" data-reveal aria-label="보기">${ICON.eye}</button><button class="qbtn" data-copypw aria-label="비밀번호 복사">${ICON.copy}</button>` : ""}</div></div>
        <div class="row"><div><div class="k">분류</div><div class="v">${esc(c.category || "기타")}</div></div><div></div></div>
        <div class="row"><div><div class="k">수정</div><div class="v small">${fmtDate(c.updatedAt)}${c.lastUsed ? ` · 최근 사용 ${fmtDate(c.lastUsed)}` : ""}</div></div><div></div></div>
      </div>
      ${c.note ? `<div class="memo">${esc(c.note)}</div>` : ""}
      <div class="btnrow"><button class="btn" data-fav>${c.favorite ? "★ 즐겨찾기 해제" : "☆ 즐겨찾기"}</button>${u ? `<a class="btn" style="display:grid;place-items:center;text-decoration:none;color:inherit" href="${esc(u)}" target="_blank" rel="noopener noreferrer">사이트 열기</a>` : ""}<button class="btn danger" data-del>삭제</button></div>
      <div id="delBox"></div>
    </div></div>`;
  let shown = false;
  el.onclick = async e => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.hasAttribute("data-close")) { el.hidden = true; }
    else if (t.hasAttribute("data-edit")) openEditor(c.id);
    else if (t.hasAttribute("data-copy")) copy(t.dataset.copy);
    else if (t.hasAttribute("data-copypw")) { await copy(c.password, "비밀번호 복사", true); touch(c); }
    else if (t.hasAttribute("data-reveal")) { shown = !shown; $("#pwv").textContent = shown ? c.password : "••••••••••"; t.innerHTML = shown ? ICON.eyeoff : ICON.eye; if (shown) touch(c); }
    else if (t.hasAttribute("data-fav")) { c.favorite = !c.favorite; await Vault.save(key, c); render(); openDetail(c.id); }
    else if (t.hasAttribute("data-del")) $("#delBox").innerHTML = `<div class="confirm"><b>이 항목을 삭제할까요?</b><span class="small">되돌릴 수 없어요.</span><div class="btnrow"><button class="btn" data-cancel>취소</button><button class="btn danger" data-delyes>삭제</button></div></div>`;
    else if (t.hasAttribute("data-cancel")) $("#delBox").innerHTML = "";
    else if (t.hasAttribute("data-delyes")) { await Vault.remove(c.id); el.hidden = true; await reload(); toast("삭제했어요"); }
  };
}

/* ---------- 편집 ---------- */
function openEditor(id) {
  const c = id ? entries.find(x => x.id === id) : null;
  const d = c ? { ...c } : { site: "", url: "", username: "", password: "", note: "", category: "기타", favorite: false };
  const el = $("#editor"); el.hidden = false; el.scrollTop = 0;
  const go = { length: 16, upper: true, lower: true, digit: true, symbol: true, noAmbig: true };
  el.innerHTML = `<div class="wrap">
    <div class="bar"><button class="tbtn l" type="button" data-close>취소</button><h2>${c ? "수정" : "새 항목"}</h2><button class="tbtn r" type="submit" form="ef">저장</button></div>
    <div class="body">
      <form id="ef" autocomplete="off">
        <div class="f"><label>사이트·서비스 이름</label><input id="f_site" value="${esc(d.site)}" placeholder="예: 네이버, 국민은행" required></div>
        <div class="f"><label>주소 (URL)</label><input id="f_url" value="${esc(d.url)}" placeholder="예: naver.com" inputmode="url"></div>
        <div class="f"><label>아이디 · 이메일</label><input id="f_user" value="${esc(d.username)}" autocomplete="off" autocapitalize="off"></div>
        <div class="f"><label>비밀번호</label><div class="pw"><input id="f_pw" type="password" value="${esc(d.password)}" autocomplete="new-password" autocapitalize="off"><button type="button" class="x" data-eye="f_pw" aria-label="보기">${ICON.eye}</button><button type="button" class="x" data-gen aria-label="생성기">${ICON.dice}</button></div>${meterHTML(d.password)}</div>
        <div class="gen" id="gen" hidden>
          <div class="out" id="genOut"></div>
          <label class="small">길이 <b id="genLen">${go.length}</b><input type="range" min="8" max="40" value="${go.length}" id="genRange"></label>
          <div class="opts">
            <label><input type="checkbox" id="g_upper" checked>대문자</label><label><input type="checkbox" id="g_lower" checked>소문자</label>
            <label><input type="checkbox" id="g_digit" checked>숫자</label><label><input type="checkbox" id="g_symbol" checked>기호</label>
            <label><input type="checkbox" id="g_noamb" checked>헷갈리는 글자 제외 (l1IO0)</label>
          </div>
          <div class="btnrow"><button type="button" class="btn" data-regen>다시 생성</button><button type="button" class="btn primary" data-use>이 비밀번호 사용</button></div>
        </div>
        <div class="two">
          <div class="f"><label>분류</label><select id="f_cat">${CATS.map(x => `<option ${x === (d.category || "기타") ? "selected" : ""}>${x}</option>`).join("")}</select></div>
          <div class="f"><label>즐겨찾기</label><select id="f_fav"><option value="0" ${!d.favorite ? "selected" : ""}>아니오</option><option value="1" ${d.favorite ? "selected" : ""}>예</option></select></div>
        </div>
        <div class="f"><label>메모 (보안 질문 답, 가입 전화번호 등)</label><textarea id="f_note">${esc(d.note)}</textarea></div>
        <div id="eStat"></div>
      </form>
    </div></div>`;
  const regen = () => { Object.assign(go, { length: +$("#genRange").value, upper: $("#g_upper").checked, lower: $("#g_lower").checked, digit: $("#g_digit").checked, symbol: $("#g_symbol").checked, noAmbig: $("#g_noamb").checked }); $("#genOut").textContent = genPassword(go); $("#genLen").textContent = go.length; };
  $("#f_pw").oninput = e => updateMeter(e.target.value);
  $("#genRange").oninput = regen; $("#gen").onchange = regen;
  $("#f_url").onblur = () => { if (!$("#f_site").value && $("#f_url").value) $("#f_site").value = host($("#f_url").value).split(".")[0]; };
  el.onclick = e => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.hasAttribute("data-close")) { el.hidden = true; el.innerHTML = ""; }
    else if (t.hasAttribute("data-eye")) toggleEye(t);
    else if (t.hasAttribute("data-gen")) { const g = $("#gen"); g.hidden = !g.hidden; if (!g.hidden && !$("#genOut").textContent) regen(); }
    else if (t.hasAttribute("data-regen")) regen();
    else if (t.hasAttribute("data-use")) { const p = $("#f_pw"); p.value = $("#genOut").textContent; p.type = "text"; $('[data-eye="f_pw"]').innerHTML = ICON.eyeoff; updateMeter(p.value); $("#gen").hidden = true; }
  };
  $("#ef").onsubmit = async e => {
    e.preventDefault();
    const body = { id: d.id || uid(), site: $("#f_site").value.trim(), url: $("#f_url").value.trim(), username: $("#f_user").value.trim(), password: $("#f_pw").value,
      note: $("#f_note").value.trim(), category: $("#f_cat").value, favorite: $("#f_fav").value === "1", createdAt: d.createdAt || Date.now(), updatedAt: Date.now(), lastUsed: d.lastUsed || 0 };
    if (!body.site) { $("#eStat").innerHTML = `<div class="status err">사이트 이름을 입력해 주세요.</div>`; return; }
    try { await Vault.save(key, body); el.hidden = true; el.innerHTML = ""; await reload(); if (!$("#detail").hidden) openDetail(body.id); toast("저장했어요"); }
    catch { $("#eStat").innerHTML = `<div class="status err">저장하지 못했어요. 폰 저장 공간을 확인해 주세요.</div>`; }
  };
  setTimeout(() => $(c ? "#f_pw" : "#f_site").focus(), 50);
}

/* ---------- 설정 ---------- */
function openSettings() {
  const el = $("#settings"); el.hidden = false; el.scrollTop = 0;
  const reuse = reuseMap(), weak = entries.filter(e => e.password && strength(e.password).score <= 1).length, reusedN = entries.filter(e => e.password && reuse.get(e.password) > 1).length;
  const al = autolockMin();
  el.innerHTML = `<div class="wrap">
    <div class="bar"><button class="tbtn l" data-close>‹ 목록</button><h2>백업·설정</h2><span class="tbtn"></span></div>
    <div class="body">
      <div class="rows">
        <div class="row"><div><div class="k">저장된 항목</div><div class="v">${entries.length}개</div></div><div></div></div>
        <div class="row"><div><div class="k">점검</div><div class="v">${weak ? `약한 비밀번호 ${weak}개` : "약한 비밀번호 없음"} · ${reusedN ? `재사용 ${reusedN}개` : "재사용 없음"}</div></div><div></div></div>
      </div>

      <div class="sec"><h3>자동 잠금</h3>
        <div class="kv"><span>안 쓰고 있으면 잠그기</span><select id="autolock">${[[1, "1분"], [5, "5분"], [15, "15분"], [30, "30분"], [0, "안 함"]].map(([v, t]) => `<option value="${v}" ${v === al ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="hint">화면을 끄거나 다른 앱으로 갔다 와도 이 시간이 지났으면 다시 마스터 비밀번호를 물어요.</div></div>

      <div class="sec"><h3>백업 (암호화)</h3>
        <div class="btnrow"><button class="btn" data-backup>백업 파일 저장</button><label class="btn pick" style="display:grid;place-items:center">복원<input type="file" accept=".json,application/json" id="restoreFile"></label></div>
        <div class="hint">백업 파일은 <b>마스터 비밀번호로 암호화된 상태</b>라 구글 드라이브 등에 올려도 내용이 보이지 않아요. 복원할 때 그 백업의 마스터 비밀번호가 필요해요. 폰을 바꾸거나 브라우저 데이터를 지우면 금고가 사라지니 <b>정기적으로 백업</b>하세요.</div></div>

      <div class="sec"><h3>다른 앱과 주고받기 (CSV)</h3>
        <div class="btnrow"><label class="btn pick" style="display:grid;place-items:center">CSV 가져오기<input type="file" accept=".csv,text/csv" id="csvFile"></label><button class="btn" data-csv>CSV 내보내기</button></div>
        <div class="hint">크롬·삼성패스·다른 비밀번호 앱에서 내보낸 CSV(name, url, username, password, note 열)를 가져올 수 있어요. <b>CSV 내보내기는 암호화되지 않은 평문</b>이에요. 옮긴 뒤에는 파일을 꼭 지우세요.</div></div>

      <div class="sec"><h3>마스터 비밀번호 변경</h3>
        <form id="chpw">
          <div class="f"><input id="c_old" type="password" placeholder="현재 마스터 비밀번호" autocomplete="current-password" required></div>
          <div class="f"><div class="pw"><input id="c_new" type="password" placeholder="새 마스터 비밀번호 (8자 이상)" autocomplete="new-password" required><button type="button" class="x" data-eye="c_new">${ICON.eye}</button></div>${meterHTML("", "cmeter")}</div>
          <div class="f"><input id="c_new2" type="password" placeholder="새 마스터 비밀번호 확인" autocomplete="new-password" required></div>
          <div id="cStat"></div>
          <button class="btn" type="submit">변경</button>
        </form></div>

      <div class="sec"><h3>위험 구역</h3>
        <div class="btnrow"><button class="btn danger" data-wipe>금고 전체 삭제</button></div>
        <div id="wipeBox"></div></div>

      <p class="small">비밀번호 금고 · 데이터는 이 폰 브라우저의 IndexedDB에 AES-GCM 256비트로 암호화 저장되며, 외부 서버와 통신하지 않아요. 홈 화면에 추가하면 앱처럼 쓸 수 있어요.</p>
    </div></div>`;
  $("#autolock").onchange = e => { localStorage.setItem(AUTOLOCK_KEY, e.target.value); armLock(); toast("자동 잠금 설정을 바꿨어요"); };
  $("#c_new").oninput = e => updateMeter(e.target.value, "cmeter");
  $("#restoreFile").onchange = e => { if (e.target.files[0]) restore(e.target.files[0]); e.target.value = ""; };
  $("#csvFile").onchange = e => { if (e.target.files[0]) importCSV(e.target.files[0]); e.target.value = ""; };
  el.onclick = async e => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.hasAttribute("data-close")) { el.hidden = true; el.innerHTML = ""; }
    else if (t.hasAttribute("data-eye")) toggleEye(t);
    else if (t.hasAttribute("data-backup")) { const b = await Vault.exportBackup(); saveFile(`비밀번호금고-백업-${fmtDate(Date.now()).replace(/\./g, "")}.json`, new Blob([JSON.stringify(b)], { type: "application/json" })); }
    else if (t.hasAttribute("data-csv")) $("#wipeBox").innerHTML = `<div class="confirm"><b>평문 CSV로 내보낼까요?</b><span class="small">누구나 열어볼 수 있는 파일이에요. 다른 앱으로 옮긴 뒤 바로 삭제하세요.</span><div class="btnrow"><button class="btn" data-cancel>취소</button><button class="btn danger" data-csvyes>내보내기</button></div></div>`;
    else if (t.hasAttribute("data-csvyes")) { $("#wipeBox").innerHTML = ""; exportCSV(); }
    else if (t.hasAttribute("data-wipe")) $("#wipeBox").innerHTML = `<div class="confirm"><b>금고를 통째로 지울까요?</b><span class="small">모든 항목과 마스터 비밀번호가 삭제되고 되돌릴 수 없어요. 먼저 백업하세요.</span><div class="f"><input id="wipeConfirm" placeholder="삭제 라고 입력"></div><div class="btnrow"><button class="btn" data-cancel>취소</button><button class="btn danger" data-wipeyes>전체 삭제</button></div></div>`;
    else if (t.hasAttribute("data-cancel")) $("#wipeBox").innerHTML = "";
    else if (t.hasAttribute("data-wipeyes")) { if ($("#wipeConfirm").value.trim() !== "삭제") { toast("‘삭제’ 라고 입력해 주세요"); return; } await Vault.wipe(); el.hidden = true; el.innerHTML = ""; lock("금고를 삭제했어요"); }
  };
  $("#chpw").onsubmit = async e => {
    e.preventDefault(); const st = h => $("#cStat").innerHTML = h;
    const o = $("#c_old").value, n = $("#c_new").value, n2 = $("#c_new2").value;
    if (n.length < 8) return st(`<div class="status err">8자 이상으로 정해 주세요.</div>`);
    if (n !== n2) return st(`<div class="status err">확인 비밀번호가 달라요.</div>`);
    if (strength(n).score < 2) return st(`<div class="status err">너무 약해요. 더 길게 하거나 숫자·기호를 섞어 주세요.</div>`);
    st(`<div class="status">확인 중…</div>`);
    if (!(await Vault.unlock(o))) return st(`<div class="status err">현재 마스터 비밀번호가 맞지 않아요.</div>`);
    st(`<div class="status">다시 암호화하는 중…</div>`);
    key = await Vault.changeMaster(n, entries);
    $("#chpw").reset(); updateMeter("", "cmeter"); st(""); toast("마스터 비밀번호를 바꿨어요");
  };
}

async function restore(file) {
  try {
    const obj = JSON.parse(await file.text());
    const list = await Vault.readBackup(obj, key, () => Promise.resolve(prompt("이 백업 파일의 마스터 비밀번호를 입력하세요")));
    if (!list) return;
    let n = 0; for (const e of list) { if (e && e.site) { e.id = e.id || uid(); await Vault.save(key, e); n++; } }
    await reload(); toast(`${n}개 복원했어요`); $("#settings").hidden = true;
  } catch (err) { toast(err.message || "복원하지 못했어요", 3000); }
}
function csvEscape(v) { v = String(v ?? ""); return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }
function exportCSV() {
  const rows = [["name", "url", "username", "password", "note", "category", "favorite"], ...sorted(entries).map(e => [e.site, e.url, e.username, e.password, e.note, e.category, e.favorite ? "1" : ""])];
  saveFile(`비밀번호-내보내기-${fmtDate(Date.now()).replace(/\./g, "")}.csv`, new Blob(["﻿" + rows.map(r => r.map(csvEscape).join(",")).join("\r\n")], { type: "text/csv" }));
}
function parseCSV(text) {
  const rows = [], re = /("([^"]|"")*"|[^,\r\n]*)(,|\r?\n|$)/g; let row = [], m;
  text = text.replace(/^﻿/, "");
  while ((m = re.exec(text)) && m[0] !== "") { let v = m[1]; if (v.startsWith('"')) v = v.slice(1, -1).replace(/""/g, '"'); row.push(v); if (m[3] !== ",") { rows.push(row); row = []; } if (m.index + m[0].length >= text.length) break; }
  if (row.length) rows.push(row);
  return rows.filter(r => r.some(c => c !== ""));
}
async function importCSV(file) {
  try {
    const rows = parseCSV(await file.text()); if (rows.length < 2) throw 0;
    const h = rows[0].map(x => x.trim().toLowerCase());
    const col = (...names) => h.findIndex(x => names.includes(x));
    const iName = col("name", "title", "사이트", "이름"), iUrl = col("url", "login_uri", "website", "주소"), iUser = col("username", "login_username", "id", "아이디", "login"),
      iPw = col("password", "login_password", "비밀번호"), iNote = col("note", "notes", "메모", "extra"), iCat = col("category", "folder", "분류", "grouping");
    if (iPw < 0 || (iName < 0 && iUrl < 0)) throw 0;
    const byKey = new Map(entries.map(e => [(e.site + "|" + e.username).toLowerCase(), e]));
    let n = 0, up = 0;
    for (const r of rows.slice(1)) {
      const g = i => i >= 0 ? (r[i] || "").trim() : "";
      const url = g(iUrl), site = g(iName) || host(url).split(".")[0] || url; if (!site) continue;
      const body = { site, url, username: g(iUser), password: g(iPw), note: g(iNote), category: CATS.includes(g(iCat)) ? g(iCat) : "기타", favorite: false, createdAt: Date.now(), updatedAt: Date.now(), lastUsed: 0 };
      const ex = byKey.get((site + "|" + body.username).toLowerCase());
      if (ex) { Object.assign(ex, { url: body.url || ex.url, password: body.password || ex.password, note: body.note || ex.note, updatedAt: Date.now() }); await Vault.save(key, ex); up++; }
      else { body.id = uid(); await Vault.save(key, body); n++; }
    }
    await reload(); toast(`${n}개 추가, ${up}개 갱신했어요`, 3000); $("#settings").hidden = true;
  } catch { toast("읽을 수 있는 CSV가 아니에요 (name/url/username/password 열 필요)", 3500); }
}

/* ---------- 시작 ---------- */
showLock();
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js").catch(() => {});
