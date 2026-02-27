---
# 전체 전략

* **P0 (필수)** : 서버가 문서를 받아서 “동작하는 HTML 덱”을 **반드시 반환**
* LLM 성공이면 LLM HTML + 최소 후처리
* 실패면 rule-based fallback
* 무한로딩/한 장/버튼먹통/메타 미표시 = P0 실패
* **P1 (개선)** : 품질 메타/스코어(정보용), UI 개선, 스모크 테스트 강화
* **P2 (실험/고도화)** : A4, expand pass, premium polish, domSanity(jsdom) 등
---
# P0 — v1을 “돌아가게” 만드는 최소 작업(최우선)

## P0-1) 새 프로젝트 스캐폴딩

1. Node/Express 기본 설치

* 필수 deps:
  * `express`, `multer`, `dotenv`
  * `pdfjs-dist`, `mammoth`
  * `@google/generative-ai`
* dev deps(테스트/스모크):
  * `node`만으로도 가능하지만, 최소 `rimraf` 정도는 선택

3. 폴더 구조 생성(빈 파일로라도 먼저)

* `src/server.js`
* `src/config/defaults.js`, `src/config/env.js`
* `src/api/routes/generate-llm.js`
* `src/pipelines/generatePipeline.js`
* `src/parsers/index.js`, `src/parsers/pdf.js`, `src/parsers/docx.js`, `src/parsers/text.js`
* `src/llm/gemini/client.js`
* `src/llm/gemini/prompts/htmlPrompts.js`
* `src/html/extract/extractHtmlFromText.js`
* `src/html/finalize/finalizeHtmlDocument.js`
* `src/html/postprocess/meaningful.js`
* `src/html/postprocess/navigation.js`
* `src/html/fallback/houseRenderer.js`
* `public/index.html`
* `scripts/smoke-html-pipeline.js`

✅ 완료 기준

* 서버 기동(`node src/server.js`) + `/`에서 index.html 서빙

---

## P0-2) UI 최소 기능 (public/index.html)

**기능만** 구현합니다(디자인 X).

* 파일 업로드 `<input type="file" multiple>`
* “Generate” 버튼 → `/api/generate-llm` 호출
* 응답 메타를 상단에 출력:
  * `mode`, `renderMode`, `whyFallback`, `extractionMethod`, `finalizeApplied`, `repairAttempted`
  * `rawLength`, `extractedLength`, `slideCount`
  * `timings.totalMs`, `timings.generateMs`, `timings.repairMs`
* 결과 HTML 미리보기:
  * iframe에 `srcdoc`로 넣기 (Blob URL보다 간단)
* 다운로드:
  * Blob 생성 + download 링크
  * **이전 Blob URL revoke** (누수 방지)

✅ 완료 기준

* 성공/폴백 상관없이 “결과 HTML이 화면에 보이고 다운로드 됨”
* 메타가 항상 뜸(값이 없으면 `N/A`)

---

## P0-3) 문서 텍스트 추출 (parsers)

* `extractUploadedTexts(files)` 구현:
  * PDF: pdfjs로 페이지 텍스트 결합
  * DOCX: mammoth
  * TXT/MD: buffer→string
* output:
  * `{ extracted: [{ name, text }], combinedText }`
* `combinedText`가 비면 즉시 에러(사용자에게 “추출 실패”)

✅ 완료 기준

* PDF 하나 올리면 combinedText 길이가 0이 아님

---

## P0-4) LLM 호출 (1-shot doc→HTML) + 모델 2개 폴백

* `src/llm/gemini/client.js`
  * 후보 모델:
    1. `gemini-3-flash-preview`
    2. `gemini-2.5-flash`
  * 실패하면 다음 후보 1회만(무한 재시도 금지)
  * 타임아웃 적용(Generate 60s)
* 프롬프트: `htmlPrompts.js`
  * “HTML만 반환, 마크다운 금지”
  * `<section>` 슬라이드 여러 장
  * 네비/키보드/프린트 포함(하지만 깨먹어도 됨 → 서버가 보장)

✅ 완료 기준

* API 키가 있으면 LLM 시도 1~2회 안에 응답
* 실패 시 에러코드(LLM_ERROR/LLM_TIMEOUT)를 메타로 남김

---

## P0-5) HTML Extract + Finalize (이게 80점 안정성의 핵심)

* `extractHtmlFromText(raw)`
  1. ```html

     ```
  2. `<!doctype html ... </html>`
  3. `<html ... </html>`
  4. 못 찾으면 `""` + `extractionMethod="none"`
* `finalizeHtmlDocument(html)`
  * `</html>` 뒤 내용 제거
  * `<meta charset="utf-8">` 보장
  * `<html><head><body>` scaffold 보정
  * `</body></html>` 닫기 보정

✅ 완료 기준

* “HTML이 조금 깨져도” finalize 후 브라우저가 렌더 가능한 형태로 최대한 보정

---

## P0-6) “한 장만 보임 / 버튼 먹통” 재발 방지: ensureInteractiveDeckHtml

* `meaningful.js`
  * `countSlides(html)` : `<section` 개수
  * `hasNavLogic(html)` : **keydown/slide show 함수/버튼 바인딩 존재**만 인정
    * progress-bar 같은 클래스는 절대 nav 판정에 쓰지 말기(오탐 방지)
* `navigation.js`
  * `ensureInteractiveDeckHtml(html)`:
    * 슬라이드가 2장 이상인데 nav 로직이 없다면 → **표준 nav 엔진(deck-nav-engine) 주입**
    * 주입 엔진은 “버튼 ID가 달라도” 동작해야 함:
      * `#prev/#next` → 없으면 `#prevBtn/#nextBtn` → 없으면 `.nav-ui button[0/1]` → 없으면 키보드만
    * 첫 슬라이드 active 보장
    * print CSS: print에서 모든 슬라이드 표시 + 페이지 브레이크

✅ 완료 기준

* 어떤 LLM HTML이 와도 “최소한 다음/이전/키보드로 넘어감”
* “첫 장만 보임”이 구조적으로 사라짐

---

## P0-7) Fallback (항상 동작하는 하우스 렌더러)

* `houseRenderer.js`
  * `combinedText`를 적당히 요약/분해해서 8~12장 정도의 `<section>` 덱 생성
  * 네비/print 포함(표준 엔진을 그대로 재사용하는 게 최선)

✅ 완료 기준

* LLM이 완전히 실패해도 fallback 덱이 나오고 동작함

---

## P0-8) generatePipeline 오케스트레이션 + 타임아웃(무한로딩 방지)

* `generatePipeline.js`에서 순서 고정:
  1. extract texts
  2. LLM generate (timeout 60s)
  3. extract html
  4. finalize
  5. ensureInteractiveDeckHtml
  6. 구조 체크(슬라이드 2장 이상 아니면 → repair 1회 또는 fallback)
  7. (선택) repair 1회 (timeout 40s) — v1에서는 **구조 복구 전용**
  8. fallback
* 전체 요청 타임아웃 150s (`Promise.race`)
* 메타는 반드시 채워서 내려보냄:
  * `hasApiKey`, `llmAttempted`, `rawLength`, `extractedLength`, `slideCount`
  * `timings`
  * `whyFallback`

✅ 완료 기준

* 어떤 상황에서도 150초 안에 응답 종료
* NO_SLIDES가 나와도 “왜 그런지” 메타로 추적 가능

---

# P1 — 80점 “유지/운영”을 위한 개선(중요하지만 P0 다음)

## P1-1) smoke script

* `scripts/smoke-html-pipeline.js`
  * 입력 샘플 텍스트로 pipeline 함수 직접 호출
  * 결과 HTML 파일로 저장(optional)
  * 체크:
    * slideCount >= 2
    * nav 엔진 포함(또는 hasNavLogic true)
    * `<html>...</html>` 완결

✅ 완료 기준

* 코드 변경 후 smoke가 항상 통과(회귀 방지)

---

## P1-2) UI 메타 표시 강화

* 상단에:
  * `Mode / RenderMode / WHY / extractionMethod / finalizeApplied / repairAttempted`
  * `rawLength / extractedLength / slideCount`
  * `timings.totalMs`
* fallback이면 WHY 빨간 강조 등(간단히)

✅ 완료 기준

* 운영 중 “왜 fallback인지” 즉시 확인 가능

---

## P1-3) Score는 “정보용”으로만

* `score.js` 만들되:
  * **fallback score는 null**
  * 점수로 fallback 강등 금지(우리가 망가졌던 지점)

✅ 완료 기준

* “fallback인데 고득점” 같은 혼선이 구조적으로 불가능

---

# P2 — 다시 망가뜨리기 쉬운 고도화(반드시 격리해서 실험)

## P2-1) A4 옵션

* 생성 단계에서 강제하지 말고
* “최종 HTML → print CSS 변환”으로만 접근

## P2-2) Expand pass(저슬라이드 자동 확장)

* slideCount <= 4면 1회 확장 패스
* 하지만 무료티어/비용/불안정성 증가 → 실험 브랜치에서만

## P2-3) Premium polish(Glass/CodePanel/Timeline)

* DOM 변형은 항상 사고 원인
* “CSS-only safe polish”로 시작하고, DOM 래핑은 조건부(오염 없을 때만)

## P2-4) domSanity(jsdom)

* 성능/무한대기/복잡도 원인 가능
* v1 LTS에는 넣지 말 것(넣더라도 1회 제한)

---

# “구현 순서” 한 줄 요약(진짜 순서)

1. 서버/라우트/정적서빙 → 2) UI 업로드/미리보기/다운로드
2. 파서 → 4) LLM 호출(2모델) → 5) HTML extract/finalize
3. nav 엔진 주입(동작 보장) → 7) fallback 덱
4. pipeline 오케스트레이션 + 타임아웃 + 메타
5. smoke 테스트로 회귀 방지
6. (그 다음에만) 점수/폴리시/고도화

---
