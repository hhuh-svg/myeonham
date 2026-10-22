# 명함첩 인수인계서

작성: 2026-10-19 · 저장소: `hhuh-svg/myeonham` · 사용자: Lena (혼자 사용, 한국어로 소통, 간결하고 실용적인 안내 선호)

> 이 저장소에는 서로 무관한 앱 2개가 들어있습니다. 명함첩은 저장소 루트(`/`), 자산 대시보드는 `/finance/` 폴더입니다. 자산 대시보드 안내는 이 문서 맨 아래 **8번 섹션** 참고.

## 1. 목표
명함을 찍으면 자동으로 읽어 분류·저장하는 **개인용 명함 관리 앱**.
- 명함 이미지도 함께 저장, 나중에 쉽게 검색
- 번호 → 전화/문자, 이메일 → 메일 작성, 주소 → 구글지도
- **핵심 요구사항: 데이터는 Claude/외부 서버가 아니라 본인 폰에만 저장.** ("내 토큰 써서 만든 건데 진짜 내 것처럼")
- 폰 홈 화면 아이콘으로 실행

## 2. 현재 상태
| 항목 | 상태 |
|---|---|
| 앱 코드 (PWA) | ✅ 완성, 이 저장소 `main`에 푸시됨 |
| 헤드리스 브라우저 테스트 | ✅ OCR → 자동 입력 → 저장 → 새로고침 후 유지 확인 |
| GitHub Pages 호스팅 | ⏳ **미완료** — Lena가 Settings → Pages에서 Branch `main` / `(root)` → Save 해야 함 (API로는 프록시가 막아서 Claude가 못 켬) |
| 폰 설치 (홈 화면 추가) | ⏳ 호스팅 후 진행 |

배포 주소(예정): **https://hhuh-svg.github.io/myeonham/**

사용자 폰: **Samsung Android, 삼성 인터넷 브라우저**. GitHub 폰 앱은 설정 메뉴가 없어 Pages 설정 불가 → 반드시 브라우저로 `github.com/hhuh-svg/myeonham/settings/pages` 접속.

## 3. 구조
```
index.html            화면 틀, PWA 메타태그, 스타일 (시스템 폰트, 라이트/다크 대응)
app.js                앱 로직: IndexedDB 저장, 목록/검색/분류, 상세, 편집, OCR 호출, 백업·복원, CSV, vCard
parse.js              OCR 텍스트 → 항목 분리 규칙 (이름/영문명/회사/부서/직함/전화/팩스/이메일/주소/웹/분류)
sw.js                 서비스워커: 앱 파일 전체 캐시 → 오프라인 실행
manifest.webmanifest  앱 이름·아이콘·standalone
icon-*.png, apple-touch-icon.png   아이콘 (파란 바탕 명함 그림)
lib/                  Tesseract.js 5.1.1 (로컬 내장)
  tesseract.min.js, worker.min.js
  core/ tesseract-core-lstm.wasm.js, tesseract-core-simd-lstm.wasm.js
  lang/ kor.traineddata.gz, eng.traineddata.gz  (4.0.0_best_int)
.nojekyll             GitHub Pages가 파일을 가공하지 않게
```

## 4. 주요 설계 결정
- **저장:** IndexedDB DB `myeonham`, store `cards` (keyPath `id`). 이미지는 JPEG dataURL(최대 1400px, q0.8)로 카드 문서 안에 저장. `navigator.storage.persist()` 요청.
- **OCR:** Tesseract.js를 CDN이 아니라 `lib/`에 내장 → 사진이 폰 밖으로 안 나감. 인식 전 흑백·대비 보정(`prep()`), kor+eng.
- **파싱:** `parse.js` 규칙 기반. 라벨(M/T/F, Mobile/Office/Fax, 010 등)로 휴대폰/사무실/팩스 구분. 미국식 주소(St, Suite, TX 76092 등)도 처리. 분류는 키워드로 추정.
- **분류 목록:** 거래처, 고객, 공급·물류, 세무·법무, 금융·보험, 부동산·주택, 병원·의료, 학교·교육, 관공서, 개인, 기타
- **백업:** 설정 → JSON 백업 파일(Web Share로 구글 드라이브 저장 가능) / 복원(id 기준 덮어쓰기) / CSV(엑셀용, BOM 포함)
- **연락처:** vCard 3.0 파일 생성 → 폰 연락처에 추가
- 외부 네트워크 호출 없음 (구글지도는 링크로만 이동).

## 5. 알려진 한계 / 다음 할 일
1. **[우선] Pages 켜기 → 폰에서 열기 → 홈 화면 추가** 안내 마무리
2. OCR 정확도: 크고 굵은 이름 글씨를 틀리게 읽음 (테스트: 김민준 → 기미즈). 다른 항목은 정확. 개선 아이디어: 이름 후보 영역만 확대해 재인식, 기울기 보정, 사용자 확인 UX 강화
3. 사진은 정면·밝게 찍어야 함 (자동 크롭/원근 보정 없음)
4. 폰 분실·브라우저 데이터 삭제 시 명함 소실 → 정기 백업 안내 필요. 구글 드라이브 자동 백업은 미구현
5. 저장소가 Public (Pages 무료 조건). 코드만 공개, 데이터는 저장소에 없음

## 6. 이전 버전 (참고)
claude.ai 아티팩트 버전도 있음 (Claude 서버 저장 + Claude 비전 OCR). 사용자가 "왜 클로드에 저장해?"라며 거부 → 현재 독립 PWA로 전환. 다시 쓰지 말 것.

## 7. 로컬 테스트
```bash
python3 -m http.server 8000   # 저장소 폴더에서
# http://localhost:8000 접속 (서비스워커는 https/localhost에서만 동작)
```

## 8. 자산 대시보드 (`/finance/`) — 별도 앱, 2026-10-19 추가
명함첩과 완전히 별개인 두 번째 PWA. 환율·ETF·지수·지방채·CD·미국채 금리를 한 화면에서 보는 개인용 참고 도구. Lena가 피델리티(Fidelity) 계좌를 쓰는 걸 전제로 설계.

**배포 주소(Pages 켜진 뒤):** `https://hhuh-svg.github.io/myeonham/finance/`

**탭 5개 (2026-10-19 저녁 기준, 금리 탭은 삭제하고 뉴스로 교체함):**
| 탭 | 내용 | 데이터 소스 |
|---|---|---|
| 환율 | USD→KRW 실시간가, 전일 대비, 기간별(1주/1개월/6개월/1년/3년) 차트+고점저점+기간변동률, 양방향 환전 계산기($1 기본값으로 입력 없이도 바로 표시) | frankfurter.app → frankfurter(latest) → open.er-api.com → jsdelivr 정적 JSON, 4단계 fallback(각 단계 독립 try/catch, 실패 사유 화면에 표시) |
| ETF | 상단에 S&P500·나스닥 지수 고정 표시 + **실제 보유 종목(개인주식+ETF 26개, 두 계좌 합산)**을 기본 목록으로 교체함(2026-10-19, `DEFAULT_ETFS` + `ETF_DEFAULTS_VERSION` 마이그레이션). 각 행에 **보유수량 입력칸**(로컬 저장, 평가금액 자동계산) + **배당수익률·배당금**(Yahoo quoteSummary) + 수량 있으면 연간 예상배당까지 표시. 티커 직접 추가/삭제 가능 | Yahoo Finance chart API + quoteSummary API(query1→query2→corsproxy.io→allorigins.win 순 fallback) |
| 지방채 | 화면 맨 위에 "지금 신규로 살 만한 수익률 기준선"을 자동 계산(미국채 3개월/5년/10년/30년 중 선택 × 세후환산) + 후보 종목 수익률 입력하면 기준 충족 여부·TEY 즉시 비교. 피델리티 링크는 맨 아래 작은 텍스트 링크 하나뿐 | 기준값은 Yahoo Finance(^IRX,^FVX,^TNX,^TYX)에서 실시간 자동 조회 |
| CD | **피델리티 공개 CD 페이지를 CORS 프록시로 가져와 금리표 직접 파싱 시도**(정규식 기반, 페이지가 JS로 렌더링되면 실패할 수 있음 — 그 경우 사유를 화면에 보여주고 아래 미국채 3개월/5년 벤치마크로 자동 대체) | 1차: 피델리티 공개 페이지 스크래핑(corsproxy.io/allorigins.win), 실패시 Yahoo(^IRX,^FVX) 벤치마크 |
| 뉴스 | CNBC·MarketWatch·Yahoo Finance RSS를 모아 최신순으로 표시, 클릭하면 원문으로 이동 | 각 매체 공개 RSS, corsproxy.io/allorigins.win 경유 |

**설계가 여러 번 바뀐 이유 (중요 — 다시 되돌리지 말 것):**
1. 처음엔 "피델리티에서 본 금리를 앱에 직접 기록"하는 방식으로 만들었다가 사용자가 "내가 앱에 적으라구?"라며 거부함. 지방채·CD 둘 다 목적은 "지금 새로 살 만한 게 있는지 판단"이어서, 미국채 수익률 자동조회 기반 기준선 계산으로 재설계(수동 기록 기능 전부 제거).
2. "자산관리앱인데 피델리티 가라고 하는건 의미없어" → 지방채·CD 탭 상단의 피델리티 버튼(primary CTA) 제거, 자동 계산 카드를 맨 위로. 피델리티 링크는 맨 아래 한 줄 텍스트 링크로 축소.
3. "CD는 CD금리 알려주면 되잖아, 왜 못해" → 벤치마크만 보여주는 데 그치지 않고 실제로 피델리티 공개 페이지 스크래핑을 시도하도록 구현(위 CD 탭 설명 참고). **단, 그 페이지가 JS로 렌더링되는 SPA라면 원문 HTML에 숫자가 없어 실패할 수 있음 — 사용자 실제 폰에서 성공 여부 확인 전까지는 미검증 상태.**
4. "금리는 관심없어, 뉴스피드 가져올 수 있나" → 금리 탭(미국채 커브) 완전 삭제, 뉴스 탭으로 교체.
5. "가지고 있는 ETF나 주식도 분배금 궁금해, 수량은 내가 업데이트할게" → ETF 탭에 보유수량(수동, 사용자가 동의함) + 배당정보(자동) 추가.
6. 지방채 계산은 AMT·NIIT 등은 반영하지 않는 단순 참고치(투자 조언 아님 고지 포함).

**UI 폰트:** "동글동글한 예쁜 폰트"(Dongle) 시도 → "너무 작고 팬시채다" 피드백으로 바로 되돌림. 시스템 기본 폰트, 15px. **다시 시도하지 말 것** (두 번 반려됨).

**구조:** `finance/index.html`(UI+스타일), `finance/app.js`(로직, 외부 라이브러리 없음), `finance/manifest.webmanifest`, `finance/sw.js`(앱 셸만 네트워크 우선 캐시), 아이콘 4종(명함첩과 구분되는 초록색 테마). 계산기 입력값·환율 차트 기간·ETF 보유수량은 `localStorage`에만 저장(서버 전송 없음).

**[완료, 2026-10-19 밤]** 지방채 탭에 **보유현황 + 쿠폰 지급 추적** 추가함. 사용자가 피델리티 포지션 화면 캡처를 보내줘서 실제 보유 6종목(CUSIP·쿠폰율·만기·액면가·당시 가격)을 `DEFAULT_MUNI_HOLDINGS`(`finance/app.js`)에 시딩. 다음 쿠폰일은 만기 월/일 기준 6개월 간격 지급을 가정해 자동 계산(실제 발행조건과 다를 수 있다고 고지), 가장 가까운 종목 카드 강조. 가격은 자동조회 불가라 수동 입력칸으로 가끔 업데이트하게 함. **주의: 처음 구현 시 강조 카드에 `class="top"`을 썼다가 페이지 헤더의 `.top{display:flex}` 범용 클래스와 충돌해 레이아웃이 깨짐 → `nearest`로 이름 변경해 해결. 앞으로 bare 클래스명(top/active/selected 등 흔한 단어)은 꼭 전역 중복 확인할 것.** 참고로 같은 포지션 캡처에 미국채 장기채(912810TW8 등) 3종목도 보였는데, 이건 지방채가 아니라서 이번엔 반영 안 함 — 필요하면 "채권" 통합 탭으로 확장 가능.

**알려진 한계:**
1. 이 개발 환경(Claude 샌드박스)은 외부 금융 API 호스트로 나가는 네트워크가 막혀 있어 Claude가 직접 테스트 못 함 — 매번 Playwright로 응답을 모킹해서 로직만 검증함. 실제 동작 여부는 전부 사용자 폰/데스크탑에서 확인받아야 함.
2. **[해결, 2026-10-19] 서비스워커 캐시 버그.** `sw.js`가 cache-first였고 `VER`을 한 번도 안 바꿔서 폰에 초기 버전이 계속 고정됨 — "당연히 안돼"로 발견. network-first로 바꾸고 `VER`을 `findash-v2`로 올려 해결. 이제부턴 배포 즉시 반영됨.
3. **[해결, 2026-10-21] "조회 실패"/"불러오는 중…"에서 멈춘 것처럼 보이던 문제 — 근본 원인은 네트워크 전체 차단이 아니라 fetch 구조였음.** 원래 모든 조회(환율/ETF/CD/뉴스/번역)가 "직접호출 실패 → 프록시1 실패 → 프록시2 실패"를 순서대로 하나씩 기다리는 구조라, 소스 중 하나라도 막힌 환경에서는 실패할 소스마다 타임아웃을 전부 채우고 나서야 다음 걸 시도함 — 환율의 경우 전부 실패 시 최악 90초 이상, 느껴지기엔 "영원히 멈춤". `fetchFirstOk`/`fetchFirstOkText`를 "같은 단계끼리는 동시에 race, 그 단계가 전부 실패해야 다음 단계로" 구조로 전면 개편(`raceOk` 헬퍼 + tier 배열 `[[직접호출들], [프록시들]]`)해서 실패 시 대기시간을 20~25초로, 성공 시엔 즉시(~0.2초)로 줄임. **주의: ETF는 심볼 26개를 동시에 조회하므로, 직접호출 자체를(query1/query2) 같이 race하면 호스트당 동시 연결 수가 두 배로 늘어 이전에 고쳤던 "다른 탭이 줄서서 멈추는" 문제가 재발함 — ETF 쪽(`yahooUrls`/`quoteSummaryUrls`)만 직접호출 1개 + 프록시 2개 race로 조정했고, FX처럼 한 번만 호출하는 곳은 query1/query2를 그대로 같이 race해도 무방함. 앞으로 기존 `fetchFirstOk(urls, ms)` 호출부를 건드릴 땐 평평한 배열이 아니라 `[[tier1 소스들], [tier2 소스들]]` 형태로 넘겨야 하는 걸 잊지 말 것.**
4. ETF·지수·미국채 벤치마크·배당정보 전부 Yahoo 비공식 엔드포인트를 씀 — 정책 변경 시 한꺼번에 깨질 수 있음.
5. CD 탭은 피델리티+체이스 스크래핑을 시도함(둘 다 `CD_SOURCES` 배열, `scrapeCdRates`로 공용 처리). 피델리티는 JS 렌더링 SPA라 원문 HTML에 숫자가 없어 거의 항상 실패 → "자동으로 가져오지 못했습니다" 메시지로 우아하게 대체. 체이스는 정적 HTML이라 성공하는 경우가 있음. 로빈후드는 개별 CD/채권 상품이 없어(현금 스윕 이자만 제공) 스크래핑 대상에서 제외하고 "현금이자" 안내 링크만 둠. 실패해도 벤치마크로 자연스럽게 대체되니 치명적이진 않음.
6. "브로커드 CD가 미국채보다 0.1~0.3%p 높다"는 일반적인 시장 경험칙이고 항상 성립하진 않음.
7. Pages가 켜지면 명함첩과 같은 저장소이므로 같은 주소에서 `/`와 `/finance/`로 두 앱이 함께 호스팅됨.
8. 지방채/국채 보유 카드의 통계 줄(`bondStats`)은 2x2 grid(flex 아님)로 고정폭임 — 예전엔 flex+wrap이라 숫자 자릿수가 긴 종목만 줄바꿈되어 그 카드만 유독 커 보이는 버그가 있었음(강조 표시인 줄 오해받음). grid로 바꿔서 모든 카드 높이가 통일됨 — 다시 flex로 되돌리지 말 것.
9. "nearest"(가장 가까운 쿠폰일 카드 강조) 기능은 사용자 요청으로 **제거함**("강조필요없어") — 다시 추가하지 말 것.
17. **[2026-10-22] 지방채 수익률 카드 = 대표 지방채 ETF 분배율만.** 처음엔 FMSbonds AAA 곡선 → 실패 시 ETF로 만들었는데, 사용자 폰에서 FMSbonds가 타임아웃("signal is aborted")으로 실패하고 "아예 처음부터 지방채 ETF 수익률 보여줘" 요청 → AAA 곡선 스크래핑 코드 **전부 제거**. `fetchMuniEtfYields`가 `MUNI_ETFS`(SUB·VTES·MUB·VTEB·HYD)를 Yahoo(되면)→CNBC/Stooq로 받아 `#muniRateCard`에 분배율(`div.yield`)·가격 표시. 사용자 폰에서 CNBC가 배당률을 주는 건 ETF 탭 캡처로 확인됨. 같은 캡처에서 **미 재무부 고시 금리표는 정상 동작 확인**(10/21/2026 기준 표시됨). MMF 7일 수익률은 CNBC에서 안 와서(캡처에 9월 MMF 이자 $0) "머니마켓펀드는 왜 이자 안 나와? 그나마 이자 때문에 하는 건데" 피드백 → `fetchMmfYieldAuto`: Yahoo 펀드 페이지(`finance.yahoo.com/quote/MJMXX/`)와 Google Finance(`google.com/finance/quote/MJMXX:MUTF`)를 r.jina.ai(직접, CORS 허용)와 codetabs/allorigins로 동시에 받아 태그 제거 후 "Yield x.xx%" 정규식으로 추출, 먼저 성공한 값 사용(30일 캐시, 실패 시 캐시값). 카드에 출처/실패 사유 표시, 직접 입력값이 우선. **6개 경로 모두 사용자 폰에서 미검증** — 카드의 "자동 조회 실패 (…)" 사유로 추적할 것.
16. **[2026-10-22] ETF 행 오른쪽에 종목별 재무정보.** 사용자 폰에서 ETF 탭이 CNBC 대체 소스로 정상 표시되는 것 확인됨(캡처). "배당 오른쪽 빈칸에 종목당 재무정보" 요청 → 시세 응답에 같이 오는 값(추가 조회 없음)으로 `.fin` 블록(52주 고·저, 시총, PER, EPS, β, 거래량, 당일 고·저)을 행의 2~3열(이름·배당 줄 오른쪽)에 표시. `pickFin`이 CNBC(`yrhiprice/yrloprice/pe/eps/mktcapView/volume/...`)·Yahoo chart meta(`fiftyTwoWeekHigh/...`)·quoteSummary(`marketCap/trailingPE/beta`)의 키 후보를 넓게 받아 있는 것만 보여줌(CNBC 키 이름은 미검증 — 안 보이는 항목이 있으면 응답 키 이름부터 확인). `mergeFin`은 null로 기존 값을 덮지 않음(Yahoo meta+quoteSummary 병합용).
15. **[2026-10-22] 배당 지급 내역 대체 소스(stockanalysis.com) + 지방채 AAA 수익률 카드.** "배당쪽 조회 하나도 안돼": Yahoo가 막히면 CNBC 시세엔 지급 내역이 없어 배당 탭이 전부 $0이었음. `fillDividendHistoryAlt`가 시세를 대체 소스에서 받은(`d.src` 있음) 보유 종목에 대해 `https://stockanalysis.com/etf/{sym}/dividend/` → `/stocks/{sym}/dividend/` HTML(프록시 경유)을 `parseDividendTable`로 파싱(첫 칸 날짜, 금액 칸, 마지막 날짜 칸=지급일), 동시 3개, 결과는 `LS divHist.{sym}`에 7일 캐시(새로고침 버튼은 캐시 비움). 페이지는 받았는데 표가 없으면 무배당으로 간주(실패 아님). 배당 탭 상단 note에 "조회 중 n/26", 실패 종목, 시세 출처가 보임. **stockanalysis HTML 구조·프록시 통과 여부는 미검증** — 폰에서 "배당 내역 조회 실패 N개: …" 메시지가 뜨면 그 사유로 추적. 채권 탭: "국채 고시 금리 자리에 지방채는 못 넣나?" → 정부 고시 금리는 없고, 지방채 딜러 FMSbonds의 AAA 수익률 곡선(`https://www.fmsbonds.com/market-yields/`, 프록시 경유, "N Year … x.xx%" 정규식)을 `#muniRateCard`로 추가(미검증, 실패 시 안내 문구). 
14. **[2026-10-22] 배당 탭은 주식·ETF 배당만, 채권 탭에서 이자 계산 + MMF 추가.** 사용자: "배당은 주식 배당만 / 채권쪽에서 이자 계산하자 / 지방채 섹션은 실제 받은 이자 월별 보여주고 연간 누계 / 올해 9월부터 보유했다고 가정" + MMF 계좌 캡처(MJMXX $1,270,013.88). (1) 배당 탭(`computeIncome`)에서 채권 부분 제거, "올해 받은 배당(보유 시작일 이후 지급 내역 × 수량)" 추가. (2) 채권 탭에 `#mmfCard`(잔액·7일 수익률 입력, 월/연 이자 예상; 수익률은 `loadMuniBench`에서 CNBC `dividendyield`로 자동 시도 → `mmfAutoYield`, 직접 입력값이 우선; **CNBC가 MMF 수익률을 실제로 주는지는 미검증**) + `#bondIncomeCard` "받은 이자(월별)": 보유 시작일(`LS holdStart`, 기본 2026-09-01, 카드 안 date 입력으로 변경 가능) 이후 쿠폰 일정 + MMF 월말 지급을 월별로 나열, 올해 받은 누계/남은 예정/합계. 실제 입금 내역이 아니라 일정 기반 계산임을 note로 명시. MMF 데이터는 `LS mmf`(`MMF_VERSION` 시딩 플래그).
13. **[2026-10-21] 채권 탭(구 지방채 탭) 단순화.** 사용자: "이 기능은 의미가 없네. 지방채 국채 고시된 이자율 보여주고 내 국채들 이자 보여주는걸로 고쳐" → 매수 기준선 계산기(연방/주 세율 입력, 세후환산)와 후보 종목 확인 카드를 **삭제**(`muniThreshold`/`calcMuni`/`muniCalc` 저장값 전부 제거, 다시 넣지 말 것). 대신 (1) 보유 지방채/국채 카드 상단에 **연 이자 합계**, 카드마다 쿠폰금액(반기)·**연 이자** 표시(현재수익률 칸은 뺌), (2) `#treasCard` "국채 고시 금리": 미 재무부 일별 수익률 곡선 CSV(`home.treasury.gov/.../daily-treasury-rates.csv/{년}/all?type=daily_treasury_yield_curve...`, 최신일이 첫 줄, 프록시 경유)를 1개월~30년 9개 만기로 표시, 실패 시 Yahoo/CNBC 벤치마크 4개 만기로 대체(출처 라벨 다름). 지방채는 공개 고시 금리가 없어 피델리티 링크 안내만. `loadBenchmark`는 이제 이 대체 경로에서만 쓰임. 재무부 CSV URL/컬럼명("1 Mo","3 Mo",…,"30 Yr")은 샌드박스에서 실제 호출 검증 못 함.
12. **[2026-10-21] ETF 시세 대체 소스(CNBC → Stooq).** 사용자 폰에서 ETF가 "하나도" 안 떠서(지수·국채 벤치마크·환율 Yahoo 경로도 전부 동시 실패) Yahoo Finance 자체가 직접호출·프록시 모두 막힌 것으로 판단. `loadEtfInner`가 첫 종목 하나로 Yahoo를 탐침하면서 **동시에** `fetchQuotesFallback`(CNBC 공개 시세 API `quote.cnbc.com/quote-html-webservice/restQuote` 배치 1회 → 실패 시 Stooq CSV `stooq.com/q/l/?s=a.us+b.us`)을 출발시키고, 먼저 오는 쪽을 그린다(Yahoo가 되면 종목별 Yahoo 값으로 덮어씀, 배당 지급내역은 Yahoo에서만 나옴). Yahoo 탐침 실패 시 `yahooBlocked=true`가 되어 지방채 탭 벤치마크(`loadBenchmark`)도 Yahoo를 건너뛰고 CNBC(US3M/US5Y/US10Y/US30Y)로 간다. ETF 목록 아래 "시세 출처: …" 줄로 어느 소스가 쓰였는지 보임. CNBC 응답 필드(`FormattedQuoteResult.FormattedQuote[].last/change_pct/name/dividend/dividendyield`)와 Stooq 배치 구분자(`+`)는 **샌드박스에서 실제 호출로 검증 못 함** — 폰에서 "시세 출처" 줄이 "대체 소스도 실패"로 나오면 그 메시지로 원인 추적. 지수는 CNBC `.SPX`/`.IXIC`, Stooq `^spx`/`^ndq`. Stooq는 전일대비가 없어 당일 시가 대비로 표시(라벨에 명시). 지방채 탭 이름은 사용자 요청으로 "채권"으로 변경.
11. **[2026-10-21] CD 탭 삭제 → "배당" 탭(배당·이자 현황)으로 교체.** 사용자 요청("CD 탭 없애고 배당현황 넣어봐"). CD 금리 스크래핑(피델리티=JS 렌더링이라 원천 불가, 체이스=페이지 구조 바뀌면 깨짐)은 전부 제거(`scrapeCdRates`/`CD_SOURCES`/`renderCdBench` 등 삭제, 미국채 벤치마크 `loadBenchmark`는 지방채 탭 기준선 계산용으로 유지). 새 탭(`#pane-income`, `incomeSkeleton`/`computeIncome`/`renderIncome`/`loadIncome`): 보유 ETF·주식은 Yahoo chart의 `events=div`로 받은 **지난 1년 실제 지급 내역(날짜·주당금액)을 +1년으로 투영**해 보유수량을 곱하고(`fetchQuote`의 `divHistory`를 3개 제한에서 전체로 바꿈), 지급 내역이 없고 연배당률만 있으면 12개월 균등 분배(라벨에 "월 균등 추정" 표시). 지방채·국채는 만기 월/일 기준 반기 쿠폰을 `couponDatesInWindow`로 계산. 월별 12개월 표 + 월평균/합계/이번달/다음달 + 종목별 연간 표. ETF 조회는 ETF 탭과 promise를 공유(`etfLoadPromise`/`ensureEtfLoaded`)해 두 번 조회하지 않음. 탭은 볼 때마다 재계산(수량이 ETF 탭에서 바뀔 수 있어서). 저장된 lastTab이 "cd"였던 사용자는 환율 탭으로 폴백.
10. **[2026-10-21] 환율 차트의 최후 수단 = jsDelivr 날짜별 파일 조립.** 이 사용자 환경은 frankfurter가 막혀 있고 Yahoo FX도 타임아웃되는 걸로 보여(진단에서 열려 있던 호스트는 jsDelivr·Google 번역뿐), `fetchFxHistoryJsdelivr`가 `@fawazahmed0/currency-api@YYYY-MM-DD/v1/currencies/usd.min.json`을 날짜별로 모아 차트를 만든다(최대 ~60개 지점 샘플링, 없는 날짜는 건너뜀, 데이터는 2024-03 이후만 있음). frankfurter/Yahoo와 같은 race에 넣되 **1.5초 지연 후 출발**(hedge)해서 정상 환경에선 요청이 아예 안 나가고(검증됨: 0건), 막힌 환경에선 ~1.7초 안에 차트가 뜸(검증됨). 또 마지막 성공값을 `localStorage.findash.fxLast`에 저장해 전부 실패 시 "마지막 성공값(N분 전)" 표시로 대체. **jsDelivr 날짜 태그 형식은 샌드박스에서 실제 호출로 검증 못 했음 — 사용자 폰에서 차트가 안 뜨면 이 URL 형식부터 의심할 것.**

**다음 할 일:** 사용자 폰에서 환율/ETF 탭이 몇 초 안에 뜨는지 실제 확인 필요(위 3번 조치가 실제 체감 개선으로 이어지는지). 추가로 요청 가능성 있던 기능(사용 안 하기로 함: 환율 목표가 알림, 홈 요약 탭, 네트워크 진단 카드) — 필요해지면 다시 제안.
---

# 비밀번호 금고 (`password/`) 인수인계서

작성: 2026-10-22 · 같은 저장소의 **별도 PWA**. 배포 주소(예정): **https://hhuh-svg.github.io/myeonham/password/** (Pages는 저장소 단위라 명함첩을 켜면 같이 켜짐). 폰에서 이 주소를 열어 홈 화면에 추가하면 명함첩과 별개 아이콘(초록 자물쇠)으로 설치됨.

## 목표
사이트마다 헷갈리는 비밀번호를 **내 폰에만 암호화해 보관**하는 개인용 금고. 명함첩과 같은 원칙: 외부 서버 호출 없음, 데이터는 브라우저 안에만.

## 구조
```
password/index.html   화면·스타일 (명함첩과 같은 레이아웃 문법, 초록 테마)
password/vault.js     암호화·저장 계층 (아래 설계 참고)
password/app.js       UI: 잠금화면, 목록/검색/분류/즐겨찾기, 상세, 편집+생성기, 설정(백업·복원·CSV·마스터 변경·전체 삭제)
password/sw.js        오프라인 캐시 (pwvault-v1)
password/manifest.webmanifest, icon-*.png, apple-touch-icon.png
```

## 설계
- **암호화:** 마스터 비밀번호 → PBKDF2-SHA256 60만 회 + 16바이트 salt → AES-GCM 256 키. 키는 메모리에만 있고 잠그면 버림. 항목마다 IV 새로 생성해 개별 암호화. 마스터 비밀번호 검증은 `verifyCt`(고정 문자열 암호문) 복호화 성공 여부로 판단.
- **저장:** IndexedDB `pwvault` — `meta`(salt, iter, verify), `entries`(id, iv, ct, updatedAt). 평문은 저장소 어디에도 없음(헤드리스 테스트로 확인).
- **항목 필드:** site, url, username, password, note, category, favorite, createdAt, updatedAt, lastUsed
- **분류:** 업무, 금융, 쇼핑, 소셜, 이메일, 엔터테인먼트, 공공·행정, 기타
- **기능:** 비밀번호 생성기(8~40자, 문자종류, 헷갈리는 글자 제외), 강도 표시(엔트로피+흔한 패턴 감점), 재사용·약함 경고 태그, 즐겨찾기(맨 위 고정), 정렬(이름/최신/최근 사용), 복사 후 30초 뒤 클립보드 비움, 자동 잠금(1/5/15/30분/안 함, 다른 앱 갔다 와도 시간 지났으면 잠금).
- **백업:** 암호화된 JSON(= IndexedDB 내용 그대로) → Web Share로 드라이브 저장 가능. 복원 시 현재 키로 먼저 시도, 안 되면 그 백업의 마스터 비밀번호를 물음(id 기준 덮어쓰기). 마스터 변경 시 전체 재암호화.
- **CSV:** 크롬/삼성패스/Bitwarden 형식(name,url,username,password,note 열) 가져오기 — 같은 사이트+아이디는 갱신. 내보내기는 **평문**이라 경고 후 진행.
- 사이트 아이콘은 외부 파비콘 서비스 대신 **첫 글자 아바타**로 처리 (어느 사이트를 쓰는지 외부에 안 알리기 위해).

## 알려진 한계 / 다음 할 일
1. 웹사이트 자동 입력(autofill)은 PWA로는 불가 — 복사해서 붙여넣는 방식. 필요하면 안드로이드 자동완성 서비스는 네이티브 앱이어야 함.
2. 마스터 비밀번호 분실 시 복구 수단 없음(의도된 설계). 지문 잠금(WebAuthn) 미구현 — 추가하려면 키 래핑 방식으로 확장 필요.
3. 브라우저 데이터 삭제/폰 분실 대비 정기 백업 필요(설정 화면에 안내 있음).

## 로컬 테스트
```bash
python3 -m http.server 8000   # 저장소 루트에서 → http://localhost:8000/password/
```
