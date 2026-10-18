// 명함 OCR 텍스트를 항목별로 나누는 규칙 (폰 안에서만 실행)
(function (root) {
  const TITLES = ["대표이사","대표","회장","사장","부사장","전무","상무","이사","본부장","실장","센터장","원장","부장","차장","과장","팀장","대리","주임","사원","매니저","책임","선임","수석","연구원","교수","변호사","세무사","회계사","의사","약사","간호사","총괄","CEO","CFO","COO","CTO","President","Vice President","VP","Director","Manager","Owner","Founder","Partner","Engineer","Consultant","Specialist","Coordinator","Representative","Agent","Broker","Realtor","Officer","Executive","Associate","Supervisor","Sales","Attorney","CPA","Doctor","MD","DDS","RN","Principal","Teacher","Professor","Advisor","Analyst","Assistant"];
  const COMPANY_RE = /(주식회사|\(주\)|㈜|유한회사|합자회사|재단|협회|조합|그룹|은행|병원|의원|치과|한의원|약국|학교|대학교|법무법인|세무법인|회계법인|공인중개사|부동산|코퍼레이션|\bCo\.?,?\s*Ltd\.?|\bInc\.?\b|\bLLC\b|\bL\.L\.C\.|\bCorp\.?\b|Corporation|Company|\bGroup\b|\bBank\b|Hospital|Clinic|Realty|Insurance|University|College|School|Law\s*(Firm|Office|Group)|\bLLP\b|\bPLLC\b|\bP\.?C\.?$|Associates|Logistics|Trading|Global|Solutions|Services)/i;
  const DEPT_RE = /([가-힣A-Za-z0-9]+(부|팀|실|본부|센터|사업부|그룹))$|Department|Dept\.?|Division|Team\b/i;
  const ADDR_RE = /(특별시|광역시|특별자치|[가-힣]+시\s|[가-힣]+도\s|[가-힣]+구\s|[가-힣]+군\s|[가-힣0-9]+(로|길|번길)\s*\d|[가-힣]+동\s|[가-힣]+읍|[가-힣]+면\s|\bSuite\b|\bSte\.?\b|\bSt\.?\b|Street|\bAve\.?\b|Avenue|\bRd\.?\b|Road|\bBlvd\.?\b|Boulevard|\bDr\.?\b|Drive|\bLn\.?\b|Lane|\bHwy\b|Highway|\bPkwy\b|Parkway|\bFloor\b|\bFl\.?\b|\b[A-Z]{2}\s+\d{5}(-\d{4})?\b|\d+층|빌딩|타워|\bB\/D\b)/;
  const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
  const WEB_RE = /\b((https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|co\.kr|kr|io|biz|us|ca|info|shop|store|co|gov|edu|ac\.kr|go\.kr|or\.kr)(\/[^\s]*)?)\b/i;
  const PHONE_RE = /(\+?\(?\d{1,4}\)?[\s.\-]?)?\(?\d{2,4}\)?[\s.\-]?\d{3,4}[\s.\-]?\d{4}/g;

  function clean(t) {
    return String(t || "").replace(/[|¦]/g, " ").replace(/[“”]/g, '"').replace(/[ \t]+/g, " ");
  }
  function guessLabel(line, num, pre) {
    pre = String(pre || "").toLowerCase();
    const l = line.toLowerCase();
    const digits = num.replace(/\D/g, "");
    if (/fax|팩스|(^|\s)f[\s.:)]/.test(pre) || /^f\s*[.:]/.test(l)) return "팩스";
    if (/mobile|cell|휴대|핸드폰|(^|\s)(m|hp|c)[\s.:)]/.test(pre) || /^(\+?82)?0?1[016789]/.test(digits.replace(/^82/, "0"))) return "휴대폰";
    if (/tel|phone|office|direct|전화|직통|대표|(^|\s)(t|o|d|p)[\s.:)]/.test(pre)) return "사무실";
    return "기타";
  }
  function guessCategory(all) {
    const t = all.toLowerCase();
    const rules = [
      ["병원·의료", /병원|의원|치과|한의원|약국|clinic|hospital|medical|dental|pharmacy|\bmd\b|\bdds\b|health/],
      ["세무·법무", /세무|회계|법무|변호사|법률|노무|cpa|tax|accounting|attorney|\blaw\b|legal|\bllp\b/],
      ["금융·보험", /은행|보험|증권|투자|자산|bank|insurance|financial|invest|wealth|capital|credit union/],
      ["부동산·주택", /부동산|공인중개|realty|realtor|real estate|mortgage|homes?\b|title co|builder/],
      ["학교·교육", /학교|대학|학원|교육|school|university|college|academy|isd\b|education/],
      ["공급·물류", /물류|운송|택배|배송|포워딩|logistics|shipping|freight|cargo|express|fedex|ups\b|dhl|warehouse|supply/],
      ["관공서", /\.gov\b|go\.kr|시청|구청|군청|주민센터|세관|영사관|대사관|city of|county|department of|consulate|embassy/]
    ];
    for (const [c, re] of rules) if (re.test(t)) return c;
    return "";
  }

  function parseCard(raw) {
    const text = clean(raw);
    const lines = text.split(/\n+/).map(s => s.trim()).filter(s => s.length > 1);
    const used = new Set();
    const out = { name: "", nameAlt: "", company: "", department: "", title: "", phones: [], fax: "", emails: [], address: "", website: "", category: "" };

    // 이메일
    lines.forEach((l, i) => {
      const m = l.replace(/\s*@\s*/g, "@").match(EMAIL_RE);
      if (m) { m.forEach(e => { if (!out.emails.includes(e)) out.emails.push(e); }); if (l.replace(EMAIL_RE, "").replace(/[^A-Za-z가-힣0-9]/g, "").length < 8) used.add(i); }
    });
    // 전화/팩스
    lines.forEach((l, i) => {
      if (/@/.test(l)) return;
      const m = l.match(PHONE_RE);
      if (!m) return;
      let hit = false, from = 0;
      m.forEach(n => {
        const at = l.indexOf(n, from), pre = l.slice(from, at < 0 ? from : at); from = at < 0 ? from : at + n.length;
        const d = n.replace(/\D/g, "");
        if (d.length < 8 || d.length > 15) return;
        if (/^\d{5}$/.test(d)) return;
        const num = n.trim().replace(/^[).\s-]+/, "");
        const lab = guessLabel(l, num, pre);
        hit = true;
        if (lab === "팩스") { if (!out.fax) out.fax = num; }
        else if (!out.phones.some(p => p.number.replace(/\D/g, "") === d)) out.phones.push({ label: lab, number: num });
      });
      if (hit && l.replace(PHONE_RE, "").replace(/[^가-힣A-Za-z]/g, "").length < 12) used.add(i);
    });
    // 웹사이트
    lines.forEach((l, i) => {
      if (out.website || /@/.test(l)) return;
      const m = l.match(WEB_RE);
      if (m && !/^\d/.test(m[1])) { out.website = m[1].replace(/[.,;]+$/, ""); if (l.length - m[1].length < 8) used.add(i); }
    });
    // 주소 (연속된 줄은 합치기)
    let ai = -1;
    lines.forEach((l, i) => { if (ai < 0 && !used.has(i) && ADDR_RE.test(l + " ") && /\d/.test(l) && !COMPANY_RE.test(l.replace(/\d+층|빌딩|타워/g, ""))) ai = i; });
    if (ai < 0) lines.forEach((l, i) => { if (ai < 0 && !used.has(i) && ADDR_RE.test(l + " ") && /\d/.test(l)) ai = i; });
    if (ai >= 0) {
      let a = lines[ai].replace(/^(주소|addr(ess)?|a)\s*[.:)]\s*/i, ""); used.add(ai);
      const nx = lines[ai + 1];
      if (nx && !used.has(ai + 1) && (ADDR_RE.test(nx + " ") || /^\s*[\d(]/.test(nx) || /\b[A-Z]{2}\s*\d{5}/.test(nx)) && !EMAIL_RE.test(nx)) { a += " " + nx; used.add(ai + 1); }
      out.address = a.trim();
    }
    // 회사
    lines.forEach((l, i) => { if (!out.company && !used.has(i) && COMPANY_RE.test(l) && l.length < 50) { out.company = l; used.add(i); } });
    // 이름·직함
    const titleRe = new RegExp("(" + TITLES.sort((a, b) => b.length - a.length).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "i");
    lines.forEach((l, i) => {
      if (used.has(i)) return;
      const compact = l.replace(/\s+/g, "");
      // "영업팀장 김민준" / "김민준 대표"
      const ko = l.match(/([가-힣](\s?[가-힣]){1,3})/g) || [];
      if (!out.name) {
        if (/^[가-힣]{2,4}$/.test(compact) && !titleRe.test(compact) && !DEPT_RE.test(compact)) { out.name = compact; used.add(i); return; }
        const tm = l.match(titleRe);
        if (tm && /[가-힣]/.test(l)) {
          const rest = l.replace(tm[0], " ").replace(/\s+/g, " ").trim();
          const restC = rest.replace(/\s+/g, "");
          if (/^[가-힣]{2,4}$/.test(restC)) { out.name = restC; if (!out.title) out.title = tm[0]; used.add(i); return; }
        }
      }
      if (!out.title && titleRe.test(l) && l.length < 40 && !/\d{3}/.test(l)) {
        const parts = l.split(/[\/,·|]/).map(s => s.trim());
        const dp = parts.find(p => DEPT_RE.test(p) && !titleRe.test(p.replace(DEPT_RE, "")));
        if (dp && !out.department) out.department = dp;
        out.title = parts.filter(p => p !== dp).join(" ").trim() || l; used.add(i); return;
      }
      if (!out.department && DEPT_RE.test(compact) && l.length < 30 && !/\d{3}/.test(l)) { out.department = l; used.add(i); }
    });
    // 영문 이름
    lines.forEach((l, i) => {
      if (used.has(i)) return;
      if (/^[A-Z][a-zA-Z'\-]+(\s+[A-Z]\.?)?(\s+[A-Z][a-zA-Z'\-]+){1,2}$/.test(l) && !COMPANY_RE.test(l) && !ADDR_RE.test(l + " ")) {
        const nm = l === l.toUpperCase() ? l.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : l;
        if (!out.name) out.name = nm; else if (!out.nameAlt) out.nameAlt = nm;
        used.add(i);
      } else if (/^[A-Z][A-Z'\-]+(\s+[A-Z][A-Z'\-]+){1,2}$/.test(l) && l.length < 30 && !COMPANY_RE.test(l)) {
        const nm = l.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
        if (!out.name) out.name = nm; else if (!out.nameAlt) out.nameAlt = nm;
        used.add(i);
      }
    });
    // 회사가 없으면: 남은 줄 중 가장 위쪽의 짧은 줄
    if (!out.company) {
      const i = lines.findIndex((l, k) => !used.has(k) && l.length >= 2 && l.length < 40 && !/\d{4}/.test(l));
      if (i >= 0) { out.company = lines[i]; used.add(i); }
    }
    if (!out.website && out.emails[0]) {
      const dom = out.emails[0].split("@")[1];
      if (dom && !/(gmail|naver|daum|hanmail|yahoo|hotmail|outlook|icloud|kakao|nate|aol|live|msn|me)\./i.test(dom)) out.website = dom;
    }
    out.category = guessCategory(text) || (out.company ? "거래처" : "기타");
    return out;
  }
  root.parseCard = parseCard;
  if (typeof module !== "undefined") module.exports = { parseCard };
})(typeof window !== "undefined" ? window : globalThis);
