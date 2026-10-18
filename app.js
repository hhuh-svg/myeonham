// 명함첩 — 모든 데이터는 이 폰의 브라우저 저장소(IndexedDB)에만 저장됩니다.
const CATS=["거래처","고객","공급·물류","세무·법무","금융·보험","부동산·주택","병원·의료","학교·교육","관공서","개인","기타"];
const ICON={
 tel:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
 sms:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>',
 mail:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
 map:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>',
 web:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
 copy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>'
};
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const telOf=n=>String(n||"").replace(/[^\d+]/g,"");
const mapOf=a=>"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(a);
const webOf=w=>/^https?:\/\//i.test(w)?w:"https://"+w;
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);

/* ---------- IndexedDB ---------- */
const DB={_db:null,
  open(){return this._db||(this._db=new Promise((res,rej)=>{const r=indexedDB.open("myeonham",1);
    r.onupgradeneeded=()=>{r.result.createObjectStore("cards",{keyPath:"id"})};
    r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}))},
  async tx(mode,fn){const db=await this.open();return new Promise((res,rej)=>{const t=db.transaction("cards",mode),s=t.objectStore("cards");const out=fn(s);t.oncomplete=()=>res(out&&out.result!==undefined?out.result:out);t.onerror=()=>rej(t.error)})},
  all(){return this.tx("readonly",s=>s.getAll())},
  put(c){return this.tx("readwrite",s=>s.put(c))},
  del(id){return this.tx("readwrite",s=>s.delete(id))},
  clear(){return this.tx("readwrite",s=>s.clear())}
};

let cards=[],filter="전체";
async function reload(){try{cards=await DB.all()}catch(e){cards=[];toast("저장소를 열 수 없어요")}render()}

function toast(t){const el=$("#toast");el.textContent=t;el.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>el.hidden=true,2000)}
async function copy(t){try{await navigator.clipboard.writeText(t);toast("복사했어요")}catch(e){toast(t)}}

/* ---------- list ---------- */
function visible(){
  const q=$("#q").value.trim().toLowerCase();
  let r=cards.filter(c=>filter==="전체"||c.category===filter);
  if(q){const qd=q.replace(/\D/g,"");r=r.filter(c=>{
    const hay=[c.name,c.nameAlt,c.company,c.title,c.department,c.address,c.website,c.memo,c.category,c.fax,...(c.emails||[]),...(c.phones||[]).map(p=>p.number)].join(" ").toLowerCase();
    if(hay.includes(q))return true;
    return qd.length>=3&&(c.phones||[]).some(p=>telOf(p.number).includes(qd));})}
  const s=$("#sort").value,ko=(a,b)=>String(a||"").localeCompare(String(b||""),"ko");
  r.sort(s==="name"?(a,b)=>ko(a.name,b.name):s==="company"?(a,b)=>ko(a.company,b.company)||ko(a.name,b.name):(a,b)=>(b.createdAt||0)-(a.createdAt||0));
  return r;
}
function render(){
  const n={};cards.forEach(c=>n[c.category]=(n[c.category]||0)+1);
  const opts=["전체",...CATS.filter(c=>n[c])];if(!opts.includes(filter))filter="전체";
  $("#rail").innerHTML=cards.length?opts.map(c=>`<button class="chip" data-cat="${esc(c)}" aria-pressed="${c===filter}">${esc(c)}<b>${c==="전체"?cards.length:n[c]}</b></button>`).join(""):"";
  $("#count").textContent=cards.length?`${cards.length}장`:"";
  const r=visible();
  $("#list").innerHTML=r.map(c=>{
    const p=(c.phones||[]).find(x=>x.label==="휴대폰")||(c.phones||[])[0];
    const thumb=c.image?`<img class="thumb" src="${c.image}" alt="">`:`<span class="thumb ph">${esc((c.name||c.company||"?").slice(0,1))}</span>`;
    return `<div class="item" data-id="${esc(c.id)}" role="button" tabindex="0">${thumb}
      <div class="meta"><div class="n">${esc(c.name||c.company||"이름 없음")}</div>
      <div class="c">${esc([c.company,c.title].filter(Boolean).join(" · "))}</div>
      ${c.category?`<span class="cat">${esc(c.category)}</span>`:""}</div>
      <div class="quick">${p?`<a class="qbtn" href="tel:${telOf(p.number)}" aria-label="전화" data-stop>${ICON.tel}</a>`:""}</div></div>`;
  }).join("");
  $("#emptyBox").innerHTML=r.length?"":cards.length
    ?`<div class="empty"><h2>${$("#q").value?"검색 결과가 없어요":"이 분류에 명함이 없어요"}</h2><p>다른 검색어나 분류를 선택해 보세요.</p></div>`
    :`<div class="empty"><svg class="art" viewBox="0 0 150 96" fill="none"><rect x="14" y="18" width="122" height="70" rx="8" fill="var(--surface)" stroke="var(--line)" stroke-width="2"/><rect x="6" y="8" width="122" height="70" rx="8" fill="var(--surface)" stroke="var(--accent)" stroke-width="2"/><rect x="18" y="22" width="44" height="8" rx="2" fill="var(--accent)"/><rect x="18" y="36" width="70" height="5" rx="2" fill="var(--line)"/><rect x="18" y="50" width="56" height="5" rx="2" fill="var(--line)"/><rect x="18" y="60" width="62" height="5" rx="2" fill="var(--line)"/></svg>
      <h2>아직 저장한 명함이 없어요</h2><p>오른쪽 아래 <b>명함 추가</b>를 눌러 첫 명함을 찍어 보세요.<br>사진과 정보는 이 폰에만 저장돼요.</p></div>`;
}
$("#rail").onclick=e=>{const b=e.target.closest(".chip");if(b){filter=b.dataset.cat;render()}};
$("#q").oninput=render;$("#sort").onchange=render;
$("#list").onclick=e=>{if(e.target.closest("[data-stop]"))return;const it=e.target.closest(".item");if(it)openDetail(it.dataset.id)};
$("#list").onkeydown=e=>{if(e.key==="Enter"){const it=e.target.closest(".item");if(it)openDetail(it.dataset.id)}};

/* ---------- detail ---------- */
function openDetail(id){
  const c=cards.find(x=>x.id===id);if(!c)return;const el=$("#detail");
  const imgs=[c.image,c.imageBack].filter(Boolean),rows=[];
  (c.phones||[]).forEach(p=>rows.push(`<div class="row"><div class="v"><div class="k">${esc(p.label||"전화")}</div><a class="v num" href="tel:${telOf(p.number)}">${esc(p.number)}</a></div>
    <div class="acts"><a class="qbtn" href="tel:${telOf(p.number)}" aria-label="전화 걸기">${ICON.tel}</a><a class="qbtn" href="sms:${telOf(p.number)}" aria-label="문자 보내기">${ICON.sms}</a><button class="qbtn" data-copy="${esc(p.number)}" aria-label="복사">${ICON.copy}</button></div></div>`));
  if(c.fax)rows.push(`<div class="row"><div class="v"><div class="k">팩스</div><span class="num">${esc(c.fax)}</span></div><div class="acts"><button class="qbtn" data-copy="${esc(c.fax)}" aria-label="복사">${ICON.copy}</button></div></div>`);
  (c.emails||[]).forEach(m=>rows.push(`<div class="row"><div class="v"><div class="k">이메일</div><a class="v" href="mailto:${esc(m)}">${esc(m)}</a></div>
    <div class="acts"><a class="qbtn" href="mailto:${esc(m)}" aria-label="메일 쓰기">${ICON.mail}</a><button class="qbtn" data-copy="${esc(m)}" aria-label="복사">${ICON.copy}</button></div></div>`));
  if(c.address)rows.push(`<div class="row"><div class="v"><div class="k">주소</div><a class="v" href="${mapOf(c.address)}" target="_blank" rel="noopener">${esc(c.address)}</a></div>
    <div class="acts"><a class="qbtn" href="${mapOf(c.address)}" target="_blank" rel="noopener" aria-label="구글 지도">${ICON.map}</a><button class="qbtn" data-copy="${esc(c.address)}" aria-label="복사">${ICON.copy}</button></div></div>`);
  if(c.website)rows.push(`<div class="row"><div class="v"><div class="k">웹사이트</div><a class="v" href="${esc(webOf(c.website))}" target="_blank" rel="noopener">${esc(c.website)}</a></div>
    <div class="acts"><a class="qbtn" href="${esc(webOf(c.website))}" target="_blank" rel="noopener" aria-label="열기">${ICON.web}</a></div></div>`);
  const d=c.createdAt?new Date(c.createdAt).toLocaleDateString("ko-KR"):"";
  el.innerHTML=`<div class="wrap"><div class="bar"><button class="tbtn l" data-close>닫기</button><h2>${esc(c.category||"명함")}</h2><button class="tbtn r" data-edit>편집</button></div>
  <div class="body">
    ${imgs.length?`<div class="imgs">${imgs.map(s=>`<img class="cardimg" src="${s}" alt="명함 이미지" data-zoom>`).join("")}</div>`:""}
    <div class="who"><h3>${esc(c.name||c.company||"이름 없음")}</h3>${c.nameAlt?`<div class="alt">${esc(c.nameAlt)}</div>`:""}
      <div class="role">${esc([c.company,c.department,c.title].filter(Boolean).join(" · "))}</div></div>
    ${rows.length?`<div class="rows">${rows.join("")}</div>`:""}
    ${c.memo?`<div><div class="small" style="margin-bottom:4px">메모</div><div class="memo">${esc(c.memo)}</div></div>`:""}
    <div class="btnrow"><button class="btn" data-vcf>폰 연락처에 추가</button><button class="btn danger" data-del>삭제</button></div>
    <div id="delBox"></div>
    ${d?`<p class="small">저장일 ${d}</p>`:""}
  </div></div>`;
  el.hidden=false;el.scrollTop=0;
  el.onclick=async e=>{
    const t=e.target.closest("button,img");if(!t)return;
    if(t.dataset.copy!==undefined)copy(t.dataset.copy);
    else if(t.hasAttribute("data-close"))el.hidden=true;
    else if(t.hasAttribute("data-edit"))openEditor(c);
    else if(t.hasAttribute("data-zoom")){$("#zoomImg").src=t.src;$("#zoom").hidden=false}
    else if(t.hasAttribute("data-vcf"))saveFile((c.name||c.company||"contact")+".vcf",new Blob([vcf(c)],{type:"text/vcard"}));
    else if(t.hasAttribute("data-del"))$("#delBox").innerHTML=`<div class="confirm"><b>이 명함을 삭제할까요?</b><span class="small">이미지와 정보가 모두 지워지고 되돌릴 수 없어요.</span><div class="btnrow"><button class="btn" data-cancel>취소</button><button class="btn danger" data-delyes>삭제</button></div></div>`;
    else if(t.hasAttribute("data-cancel"))$("#delBox").innerHTML="";
    else if(t.hasAttribute("data-delyes")){await DB.del(c.id);el.hidden=true;await reload();toast("삭제했어요")}
  };
}
$("#zoom").onclick=()=>$("#zoom").hidden=true;

function vcf(c){
  const e=s=>String(s||"").replace(/([,;\\])/g,"\\$1").replace(/\n/g,"\\n");
  const L=["BEGIN:VCARD","VERSION:3.0",`FN:${e(c.name||c.company)}`,`N:${e(c.name)};;;;`];
  if(c.company)L.push(`ORG:${e(c.company)}${c.department?";"+e(c.department):""}`);
  if(c.title)L.push(`TITLE:${e(c.title)}`);
  (c.phones||[]).forEach(p=>L.push(`TEL;TYPE=${p.label==="휴대폰"?"CELL":p.label==="사무실"?"WORK":"VOICE"}:${p.number}`));
  if(c.fax)L.push(`TEL;TYPE=FAX:${c.fax}`);
  (c.emails||[]).forEach(m=>L.push(`EMAIL;TYPE=INTERNET:${m}`));
  if(c.address)L.push(`ADR;TYPE=WORK:;;${e(c.address)};;;;`);
  if(c.website)L.push(`URL:${webOf(c.website)}`);
  if(c.memo)L.push(`NOTE:${e(c.memo)}`);
  L.push("END:VCARD");return L.join("\r\n");
}
async function saveFile(name,blob){
  const f=new File([blob],name,{type:blob.type});
  if(navigator.canShare&&navigator.canShare({files:[f]})){try{await navigator.share({files:[f],title:name});return}catch(e){if(e.name==="AbortError")return}}
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},4000);
}

/* ---------- OCR (Tesseract, 폰 안에서 실행) ---------- */
let ocrWorker=null;
async function getWorker(onp){
  if(ocrWorker)return ocrWorker;
  if(!window.Tesseract)throw new Error("글자 인식 엔진을 불러오지 못했어요");
  const base=new URL("lib/",location.href).href;
  ocrWorker=await Tesseract.createWorker(["kor","eng"],1,{workerPath:base+"worker.min.js",corePath:base+"core",langPath:base+"lang",gzip:true,cacheMethod:"write",logger:m=>{if(m.status&&onp)onp(m)}});
  return ocrWorker;
}
function prep(dataUrl){return new Promise(res=>{const im=new Image();im.onload=()=>{
  const s=Math.min(2.2,1800/Math.max(im.width,im.height)),cv=document.createElement("canvas");
  cv.width=Math.round(im.width*s);cv.height=Math.round(im.height*s);const x=cv.getContext("2d");x.drawImage(im,0,0,cv.width,cv.height);
  const d=x.getImageData(0,0,cv.width,cv.height),p=d.data;
  for(let i=0;i<p.length;i+=4){let g=.299*p[i]+.587*p[i+1]+.114*p[i+2];g=Math.max(0,Math.min(255,(g-128)*1.35+128));p[i]=p[i+1]=p[i+2]=g}
  x.putImageData(d,0,0);res(cv)};im.src=dataUrl})}
const STAGE={"loading tesseract core":"엔진 준비","initializing tesseract":"엔진 준비","loading language traineddata":"한글·영어 데이터 준비","initializing api":"엔진 준비","recognizing text":"글자 읽는 중"};

/* ---------- editor ---------- */
let draft=null;
function compress(file,max=1100,q=.75){return new Promise((res,rej)=>{const u=URL.createObjectURL(file),im=new Image();
  im.onload=()=>{const s=Math.min(1,max/Math.max(im.width,im.height)),cv=document.createElement("canvas");cv.width=Math.round(im.width*s);cv.height=Math.round(im.height*s);
    cv.getContext("2d").drawImage(im,0,0,cv.width,cv.height);URL.revokeObjectURL(u);res(cv.toDataURL("image/jpeg",q))};
  im.onerror=()=>{URL.revokeObjectURL(u);rej(new Error("이미지를 열 수 없어요"))};im.src=u})}

function openEditor(c){
  draft=c?JSON.parse(JSON.stringify(c)):{name:"",nameAlt:"",company:"",title:"",department:"",phones:[{label:"휴대폰",number:""}],emails:[""],fax:"",address:"",website:"",category:"거래처",memo:"",image:"",imageBack:"",ocrText:""};
  if(!draft.phones||!draft.phones.length)draft.phones=[{label:"휴대폰",number:""}];
  if(!draft.emails||!draft.emails.length)draft.emails=[""];
  drawEditor();$("#editor").hidden=false;$("#editor").scrollTop=0;
}
function drawEditor(status){
  const d=draft,el=$("#editor");
  const pv=[d.image,d.imageBack].filter(Boolean).map(s=>`<img src="${s}" alt="미리보기">`).join("");
  el.innerHTML=`<div class="wrap"><div class="bar"><button class="tbtn l" data-x>취소</button><h2>${d.id?"명함 편집":"새 명함"}</h2><button class="tbtn r" data-save>저장</button></div>
  <div class="body">
    <div class="drop">${pv?`<div class="pv">${pv}</div>`:`<div class="small">명함을 밝은 곳에서 정면으로, 화면에 꽉 차게 찍으면 글자를 잘 읽어요.</div>`}
      <div class="pickrow">
        <label class="pick">${d.image?"앞면 다시 찍기":"앞면 촬영·선택"}<input id="fFront" type="file" accept="image/*" capture="environment"></label>
        <label class="pick">${d.imageBack?"뒷면 다시 찍기":"뒷면 추가"}<input id="fBack" type="file" accept="image/*" capture="environment"></label>
        ${d.image?`<button type="button" class="pick" data-ocr>다시 읽기</button>`:""}
      </div></div>
    <div id="stat">${status||""}</div>
    <form id="frm" autocomplete="off">
      <div class="two"><div class="f"><label for="e_name">이름</label><input id="e_name" value="${esc(d.name)}"></div>
        <div class="f"><label for="e_alt">영문·다른 표기</label><input id="e_alt" value="${esc(d.nameAlt)}"></div></div>
      <div class="f"><label for="e_company">회사</label><input id="e_company" value="${esc(d.company)}"></div>
      <div class="two"><div class="f"><label for="e_dept">부서</label><input id="e_dept" value="${esc(d.department)}"></div>
        <div class="f"><label for="e_title">직함</label><input id="e_title" value="${esc(d.title)}"></div></div>
      <div class="f"><label>전화번호</label><div class="multi">${d.phones.map((p,i)=>`<div class="mrow">
        <select id="e_pl${i}">${["휴대폰","사무실","기타"].map(o=>`<option ${o===p.label?"selected":""}>${o}</option>`).join("")}</select>
        <input id="e_pn${i}" inputmode="tel" value="${esc(p.number)}"><button type="button" class="x" data-rmp="${i}" aria-label="삭제">×</button></div>`).join("")}
        <button type="button" class="add" data-addp>+ 번호 추가</button></div></div>
      <div class="f"><label>이메일</label><div class="multi">${d.emails.map((m,i)=>`<div class="mrow"><input id="e_em${i}" type="email" inputmode="email" value="${esc(m)}"><button type="button" class="x" data-rme="${i}" aria-label="삭제">×</button></div>`).join("")}
        <button type="button" class="add" data-adde>+ 이메일 추가</button></div></div>
      <div class="f"><label for="e_fax">팩스</label><input id="e_fax" inputmode="tel" value="${esc(d.fax)}"></div>
      <div class="f"><label for="e_addr">주소</label><textarea id="e_addr" rows="2">${esc(d.address)}</textarea></div>
      <div class="f"><label for="e_web">웹사이트</label><input id="e_web" inputmode="url" value="${esc(d.website)}"></div>
      <div class="f"><label for="e_cat">분류</label><select id="e_cat">${CATS.map(o=>`<option ${o===d.category?"selected":""}>${o}</option>`).join("")}</select></div>
      <div class="f"><label for="e_memo">메모 (만난 곳, 용건 등)</label><textarea id="e_memo">${esc(d.memo)}</textarea></div>
      ${d.ocrText?`<details class="raw"><summary>인식된 원문 보기 (복사해서 빈칸 채우기)</summary><pre>${esc(d.ocrText)}</pre></details>`:""}
    </form>
  </div></div>`;
  $("#fFront").onchange=e=>pickFile(e,"front");$("#fBack").onchange=e=>pickFile(e,"back");
}
function setStat(h){const s=$("#stat");if(s)s.innerHTML=h}
function readForm(){
  const d=draft,v=id=>($("#"+id)?.value||"").trim();
  Object.assign(d,{name:v("e_name"),nameAlt:v("e_alt"),company:v("e_company"),department:v("e_dept"),title:v("e_title"),fax:v("e_fax"),address:v("e_addr"),website:v("e_web"),category:v("e_cat")||d.category,memo:($("#e_memo")?.value||"").trim()});
  d.phones=d.phones.map((p,i)=>({label:$("#e_pl"+i)?.value||p.label,number:($("#e_pn"+i)?.value||"").trim()}));
  d.emails=d.emails.map((m,i)=>($("#e_em"+i)?.value||"").trim());
}
async function pickFile(e,side){
  const f=e.target.files&&e.target.files[0];if(!f)return;readForm();
  try{const url=await compress(f,1400,.8);if(side==="front")draft.image=url;else draft.imageBack=url}
  catch(err){drawEditor(`<div class="status err">${esc(err.message)}</div>`);return}
  drawEditor();runOcr();
}
let ocrBusy=false;
async function runOcr(){
  if(ocrBusy)return;ocrBusy=true;readForm();
  setStat(`<div class="status">글자 인식 준비 중… 처음 한 번은 10~30초 걸려요.</div>`);
  try{
    const w=await getWorker(m=>{const s=STAGE[m.status]||"처리 중";setStat(`<div class="status">${s}${m.progress?` ${Math.round(m.progress*100)}%`:""}</div>`)});
    let text="";
    for(const src of [draft.image,draft.imageBack].filter(Boolean)){const cv=await prep(src);const r=await w.recognize(cv);text+=(r.data.text||"")+"\n"}
    const p=parseCard(text),d=draft,isEmpty=k=>!d[k];
    ["name","nameAlt","company","department","title","fax","address","website"].forEach(k=>{if(p[k]&&isEmpty(k))d[k]=p[k]});
    if(p.phones.length&&!d.phones.some(x=>x.number))d.phones=p.phones;
    if(p.emails.length&&!d.emails.some(Boolean))d.emails=p.emails;
    if(!d.id&&p.category)d.category=p.category;
    d.ocrText=text.trim();
    drawEditor(`<div class="status" style="color:var(--ok)">읽기 완료. 틀린 곳이 있을 수 있으니 확인하고 저장하세요.</div>`);
  }catch(err){
    ocrWorker=null;
    drawEditor(`<div class="status err">${esc(err.message||"글자를 읽지 못했어요")}. 직접 입력하거나 '다시 읽기'를 눌러 주세요.</div>`);
  }finally{ocrBusy=false}
}
$("#editor").addEventListener("click",async e=>{
  const t=e.target.closest("button");if(!t)return;
  if(t.hasAttribute("data-x")){$("#editor").hidden=true;return}
  if(t.hasAttribute("data-ocr")){readForm();["name","nameAlt","company","department","title","fax","address","website"].forEach(k=>draft[k]="");draft.phones=[{label:"휴대폰",number:""}];draft.emails=[""];drawEditor();runOcr();return}
  if(t.hasAttribute("data-addp")){readForm();draft.phones.push({label:"사무실",number:""});drawEditor();return}
  if(t.hasAttribute("data-adde")){readForm();draft.emails.push("");drawEditor();return}
  if(t.dataset.rmp!==undefined){readForm();draft.phones.splice(+t.dataset.rmp,1);if(!draft.phones.length)draft.phones=[{label:"휴대폰",number:""}];drawEditor();return}
  if(t.dataset.rme!==undefined){readForm();draft.emails.splice(+t.dataset.rme,1);if(!draft.emails.length)draft.emails=[""];drawEditor();return}
  if(t.hasAttribute("data-save")){
    readForm();const d=draft;
    if(!d.name&&!d.company&&!d.image){setStat(`<div class="status err">이름, 회사, 명함 사진 중 하나는 있어야 저장할 수 있어요.</div>`);return}
    const body={id:d.id||uid(),name:d.name,nameAlt:d.nameAlt,company:d.company,department:d.department,title:d.title,
      phones:d.phones.filter(p=>p.number),emails:d.emails.filter(Boolean),fax:d.fax,address:d.address,website:d.website,
      category:d.category,memo:d.memo,image:d.image||"",imageBack:d.imageBack||"",ocrText:d.ocrText||"",createdAt:d.createdAt||Date.now(),updatedAt:Date.now()};
    try{await DB.put(body);$("#editor").hidden=true;await reload();if(!$("#detail").hidden)openDetail(body.id);toast("저장했어요")}
    catch(err){setStat(`<div class="status err">저장하지 못했어요. 폰 저장 공간을 확인해 주세요.</div>`)}
  }
});
$("#fab").onclick=()=>openEditor(null);

/* ---------- 백업·복원 ---------- */
$("#menuBtn").onclick=async()=>{
  const el=$("#settings");let est="";
  try{const e=await navigator.storage.estimate();est=`사용 중 ${(e.usage/1048576).toFixed(1)}MB`}catch(e){}
  let pers=false;try{pers=await navigator.storage.persisted()}catch(e){}
  el.innerHTML=`<div class="wrap"><div class="bar"><button class="tbtn l" data-close>닫기</button><h2>백업·설정</h2><span class="tbtn"></span></div>
  <div class="body">
    <div class="rows">
      <div class="row"><div class="v"><b>백업 파일 만들기</b><div class="small">명함 ${cards.length}장과 사진을 파일 하나로 저장. 구글 드라이브나 메일로 보관하세요.</div></div><button class="btn" style="flex:none;min-width:84px" data-export>백업</button></div>
      <div class="row"><div class="v"><b>백업에서 복원</b><div class="small">백업 파일을 고르면 같은 명함은 덮어쓰고 없는 명함은 추가해요.</div></div><label class="btn pick" style="flex:none;min-width:84px;display:grid;place-items:center">복원<input id="fImport" type="file" accept=".json,application/json"></label></div>
      <div class="row"><div class="v"><b>엑셀용 목록 (CSV)</b><div class="small">이름·회사·번호·이메일·주소를 표로 내보내기</div></div><button class="btn" style="flex:none;min-width:84px" data-csv>내보내기</button></div>
    </div>
    <p class="small">모든 명함은 이 폰의 이 브라우저 안에만 저장되고, 어디로도 전송되지 않아요. 앱을 지우거나 브라우저 데이터를 삭제하면 명함도 사라지니 한 달에 한 번쯤 백업해 두세요. ${est} · 영구 저장 ${pers?"켜짐":"요청 안 됨"}</p>
  </div></div>`;
  el.hidden=false;
  $("#fImport").onchange=importFile;
  el.onclick=async e=>{const t=e.target.closest("button");if(!t)return;
    if(t.hasAttribute("data-close"))el.hidden=true;
    else if(t.hasAttribute("data-export")){const day=new Date().toISOString().slice(0,10);saveFile(`명함첩-백업-${day}.json`,new Blob([JSON.stringify({app:"myeonham",version:1,exportedAt:new Date().toISOString(),cards})],{type:"application/json"}))}
    else if(t.hasAttribute("data-csv")){const q=s=>'"'+String(s||"").replace(/"/g,'""')+'"';
      const rows=[["이름","영문","회사","부서","직함","분류","휴대폰","사무실","기타번호","팩스","이메일","주소","웹사이트","메모"].map(q).join(",")];
      cards.forEach(c=>{const ph=l=>(c.phones||[]).filter(p=>p.label===l).map(p=>p.number).join(" / ");
        rows.push([c.name,c.nameAlt,c.company,c.department,c.title,c.category,ph("휴대폰"),ph("사무실"),ph("기타"),c.fax,(c.emails||[]).join(" / "),c.address,c.website,c.memo].map(q).join(","))});
      saveFile(`명함첩-${new Date().toISOString().slice(0,10)}.csv`,new Blob(["﻿"+rows.join("\r\n")],{type:"text/csv"}))}
  };
};
async function importFile(e){
  const f=e.target.files&&e.target.files[0];if(!f)return;
  try{const j=JSON.parse(await f.text());const list=Array.isArray(j)?j:j.cards;
    if(!Array.isArray(list))throw 0;let n=0;
    for(const c of list){if(c&&typeof c==="object"&&(c.name||c.company||c.image)){c.id=c.id||uid();await DB.put(c);n++}}
    await reload();toast(`${n}장 복원했어요`);$("#settings").hidden=true;
  }catch(err){toast("명함첩 백업 파일이 아니에요")}
}

/* ---------- 시작 ---------- */
reload();
try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist()}catch(e){}
if("serviceWorker" in navigator&&location.protocol==="https:")navigator.serviceWorker.register("sw.js").catch(()=>{});
