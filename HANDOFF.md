# 명함첩 인수인계서

작성: 2026-10-19 · 저장소: `hhuh-svg/myeonham` · 사용자: Lena (혼자 사용, 한국어로 소통, 간결하고 실용적인 안내 선호)

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
