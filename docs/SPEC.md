
---

# spec.md — Report2Slide Agent (v1 / 80점 기준 안정 빌드)

## 0) 한 줄 요약

문서(PDF/DOCX/TXT/MD)를 업로드하면 **Gemini가 “Next-gen executive + modern editorial” 하우스 스타일**로 **단일 HTML 덱(슬라이드형 웹 프레젠테이션)**을 생성한다.
실패 시에는 **rule-based 하우스 템플릿**으로 fallback한다.
“한 장만 보임/버튼 먹통/무한 로딩”은 구조적으로 재발하지 않도록 **후처리와 관측(메타)**를 기본 제공한다.

---

## 1) 목표 / 비목표

### 목표 (80점 기준)

* **Direct-only** : 문서 → HTML 덱을 한 번에 생성한다.
* HTML 덱이 **항상 동작**한다:
  * 첫 슬라이드 표시
  * Prev/Next/키보드 네비
  * Print(슬라이드별 페이지)
* 생성 실패/불완전 시에도  **사용자는 항상 결과를 받는다** (최소 fallback 덱).
* 사용자/운영자는 “왜 fallback 됐는지”를 즉시 알 수 있다(메타 표시).

### 비목표 (80점 기준에서 제외)

* analyze→edit→render 워크플로우(디자인 자율성 제한, 복잡도 증가)
* variant 다중 시안 생성/선택(무료티어/불안정성 증가)
* reference template on/off/auto (80점 기준에서는  **OFF 고정** )
* 과도한 DOM 변형 polish / 다단계 “리디자인 패스” (불안정성 증가)

---

## 2) 고정 정책(기본값) — “단순화가 정답”

* workflow: `direct-html` 고정
* variantCount: `1` 고정
* referenceMode: `off` 고정
* pageMode: `default` 고정 (A4는 v2에서 “후처리 변환”으로만 고려)
* style/persona 입력값은 받더라도 **하우스 스타일로 무시(고정)**
  * `HOUSE_STYLE_ID = "house-nextgen-exec"`
  * Art direction: “Next-gen executive + modern editorial hybrid”

LLM 호출 예산 (80점 기준 권장):

* **최대 2회** : Generate 1회 + 조건부 Repair 1회
  (3회 예산은 안정화에 도움이 되지만, 복잡도/비용 증가. v1에서는 2회가 더 관리가 쉽다.)

타임아웃(무한로딩 방지, v1 필수):

* Request Timeout: 150s
* LLM Generate Timeout: 60s
* LLM Repair Timeout: 40s

---

## 3) 사용자 UX 흐름

### Flow A: Generate

1. 사용자가 문서 업로드 → Generate 클릭
2. 서버가 텍스트 추출
3. LLM이 HTML 덱 생성(1회)
4. 서버가 후처리(finalize + nav 보장 + print 보장)
5. 결과를 브라우저에 렌더 + 다운로드(Blob URL) 제공
   * Blob URL은 **revoke**하여 누수 방지

### Flow B: 실패 시

* LLM 실패 / HTML 추출 실패 / 슬라이드 구조 0 / 덱 동작 불능
  → **rule-based fallback 덱**을 반환
  → 메타에 WHY 표시 (`LLM_ERROR`, `NO_SLIDES`, `TRUNCATED`, …)

---

## 4) API 스펙 (v1)

### `POST /api/generate-llm`

* Content-Type: `multipart/form-data`
* Request:
  * `documents[]` 파일 배열
  * (옵션 입력은 받아도 고정 정책 우선): style/workflow/variantCount/referenceMode/pageMode 등
* Response (핵심 shape)

```json
{
  "mode": "llm-gemini" | "fallback-rule-based",
  "sourceFiles": ["..."],
  "title": "...",
  "design": { "style": "house-nextgen-exec" },
  "html": "<!doctype html>...",
  "htmlVariants": [
    {
      "id": "v1",
      "renderMode": "llm" | "repair" | "fallback",
      "referenceUsed": false,
      "extractionMethod": "fenced" | "doctype" | "htmlTag" | "none",
      "finalizeApplied": true | false,
      "repairAttempted": true | false,
      "whyFallback": "",
      "score": 0 | null,
      "scoreBreakdown": { },
      "meta": {
        "hasApiKey": true,
        "llmAttempted": true,
        "rawLength": 12345,
        "extractedLength": 12000,
        "slideCount": 10,
        "navLogic": true,
        "timings": { "totalMs": 45678, "generateMs": 32100, "repairMs": 0 }
      }
    }
  ],
  "variantRequested": 1,
  "variantProduced": 1,
  "workflowUsed": "direct-html",
  "referenceModeUsed": "off"
}
```

### `POST /api/render-llm` (v1 optional)

* v1에서는 “편집 UI”를 제외하므로 최소 구현 또는 제거 가능
* 남긴다면: slides JSON → HTML 덱 재생성 (generate와 동일 후처리 적용)

---

## 5) LLM 출력 계약(Contract) — **이게 80점의 핵심**

LLM에게 “자유롭게 멋지게 만들라”고 하되, 아래 계약을 권장/요구한다.

### LLM이 생성해야 하는 HTML 최소 조건

* 완전한 문서: `<!doctype html><html><head>...<body>...`
* UTF-8: `<meta charset="utf-8">`
* 슬라이드 래퍼: `<section ...>` 최소 6~12장 권장
* 첫 슬라이드가 보이도록:
  * `class="active"`를 첫 section에 주거나
  * JS에서 `show(0)` 수행
* 네비게이션:
  * 키보드(←/→, PageUp/PageDown, Home/End)
  * 버튼(Prev/Next) 최소 2개
  * 버튼 ID는  **고정 권장** : `prev`, `next`, `print`
    (하지만 LLM이 깨먹을 수 있으므로 서버 엔진이 유연 바인딩해야 함)
* Print 지원:
  * `@media print`에서 모든 슬라이드 표시 + slide별 page break

### 시스템 프롬프트(요지)

* “Return HTML only. No markdown.”
* “Use Next-gen executive + modern editorial hybrid.”
* “Avoid bullet-only slides; use cards, KPI bands, tables, timeline, code panel.”
* “Ensure navigation works. Ensure first slide visible.”
* “Use per slide.”

---

## 6) 파이프라인(서버) — 단계별 처리 규칙

### 6.1 텍스트 추출

* PDF: `pdfjs-dist`
* DOCX: `mammoth`
* TXT/MD: plain parsing
* 합산 텍스트 상한: 예) 15000~25000 chars (너무 크면 품질/시간/비용 악화)
* 메타: source file names 저장

### 6.2 LLM Generate (1회)

* 모델 후보(2개):
  1. `gemini-3-flash-preview`
  2. `gemini-2.5-flash`
* 정책: **실패 시에만** secondary로 1회 재시도
  (성공했는데도 secondary를 쓰지 않는다)

### 6.3 Extract HTML (중요)

* `extractHtmlFromText(raw)` 우선순위:
  1. ```html

     ```
  2. `<!doctype html ... </html>` (non-greedy, 마지막 `</html>`까지)
  3. `<html ... </html>` (non-greedy)
  4. 실패 → `extractionMethod="none"`

> 80점 시점에서 반복되던 핵심 실패가 `extraction:none`이었음.
> 그래서 rawLength/extractedLength를 반드시 기록한다.

### 6.4 Finalize HTML (안정화)

* `stripAfterHtmlClose()` : `</html>` 뒤의 찌꺼기 제거
* `finalizeHtmlDocument()` :
  * `<html/head/body>` 없으면 scaffold 래핑
  * `</body></html>` 닫기 보정 (가능한 범위)
  * `<meta charset="utf-8">` 보장

### 6.5 동작 보장(네비/active) — “한 장만 보임” 재발 방지

* 슬라이드 감지: `<section>` count
* NAV_REQUIRED 판정:
  * section >= 2
  * CSS/구조상 active만 보이는 패턴(또는 기본 숨김)을 쓰는 경우
* `hasNavLogic(html)` 판정(오탐 금지):
  * keydown(ArrowRight/ArrowLeft) 핸들러, 또는
  * nextSlide/prevSlide/show 함수 존재, 또는
  * 버튼 click 바인딩 존재
    ※ progress-bar 클래스는 nav 판정에 절대 사용하지 않음(오탐 재발 방지)

#### ensureInteractiveDeckHtml 규칙(v1)

* hasNavLogic가 이미 있으면: 유지
* 없으면: **표준 nav 엔진(deck-nav-engine) 주입**
  * 첫 슬라이드 active 보장
  * 버튼 바인딩은 유연하게:
    * #prev/#next → 없으면 #prevBtn/#nextBtn → 없으면 `.nav-ui button` 1/2번 → 없으면 키보드만
  * progress-bar 있으면 width 업데이트(없어도 문제 없음)
* Print CSS:
  * print에서 모든 slide visible + page-break-after

### 6.6 품질 판단(Score) — **게이트로 쓰지 않는다**

* v1에서는 variant=1이므로 “선택”보다 “표시” 목적
* Score는 참고값이며 **fallback 강등 조건이 아니다**
* fallback score는  **null** , UI는 `N/A (fallback)` 표시
* fallback이 점수 높게 나오는 혼선을 구조적으로 제거(우리가 실제로 개선했던 포인트)

### 6.7 Repair (조건부 1회, v1)

Repair는 “디자인 향상”이 아니라 **구조 복구** 전용.

* 트리거(예):
  * TRUNCATED (닫는 태그 불완전)
  * NO_SLIDES (slides 0)
  * NAV_REQUIRED인데 nav 로직이 주입 불가(오염/심각 손상)
* Repair 프롬프트:
  * “Fix HTML validity, remove broken tags, ensure navigation works.”
  * “Return complete HTML only.”
* Repair 실패 시 fallback

### 6.8 Fallback (rule-based)

* personaRenderer 기반의 안정 덱(하우스 스타일)
* 항상 동작(nav/print)
* 점수 null, whyFallback 명시

---

## 7) 폴더 구조(권장) — v1 안정형

```text
agent_a/
├─ src/
│  ├─ api/
│  │  └─ routes/
│  │     ├─ generate-llm.js
│  │     └─ render-llm.js            # (선택) 유지/삭제
│  ├─ config/
│  │  ├─ defaults.js                 # 고정 정책 + timeout + 모델 후보
│  │  └─ env.js                      # GEMINI_API_KEY 로딩(서버 전용)
│  ├─ parsers/
│  │  ├─ index.js                    # extractUploadedTexts(files)
│  │  ├─ pdf.js
│  │  ├─ docx.js
│  │  └─ text.js
│  ├─ pipelines/
│  │  ├─ generatePipeline.js         # 전체 오케스트레이션(예산/타임아웃/메타)
│  │  └─ renderPipeline.js           # (선택)
│  ├─ llm/
│  │  └─ gemini/
│  │     ├─ client.js                # runWithModelFallback + timeout
│  │     └─ prompts/
│  │        └─ htmlPrompts.js         # system/user prompt (house-nextgen-exec)
│  ├─ html/
│  │  ├─ extract/
│  │  │  └─ extractHtmlFromText.js    # fenced/doctype/htmlTag
│  │  ├─ finalize/
│  │  │  └─ finalizeHtmlDocument.js   # stripAfterHtmlClose + scaffold
│  │  ├─ postprocess/
│  │  │  ├─ navigation.js             # ensureInteractiveDeckHtml + deck-nav-engine
│  │  │  ├─ meaningful.js             # isMeaningfulHtml + hasNavLogic + NAV_REQUIRED
│  │  │  └─ polish.js                 # v1은 CSS-only safe (최소)
│  │  ├─ scoring/
│  │  │  └─ score.js                  # score + breakdown (정보용)
│  │  └─ fallback/
│  │     └─ houseRenderer.js          # rule-based house-nextgen-exec
│  ├─ server.js
│  └─ presets/
│     └─ houseTokens.js               # 하우스 토큰/색상/타이포
├─ public/
│  ├─ index.html                      # 업로드 UI + 메타 표시 + Blob revoke
│  └─ app.js (선택, 분리 권장)
├─ scripts/
│  ├─ smoke-html-pipeline.js
│  ├─ test-contamination.js
│  └─ test-navigation-detection.js
├─ README.md
└─ spec.md                            # (이 문서)
```

---

## 8) 파일별 역할(핵심)

### `src/config/defaults.js`

* 고정 정책:
  * WORKFLOW, VARIANT, REFERENCE_MODE, PAGE_MODE
* 모델 후보:
  * PRIMARY/SECONDARY
* 타임아웃:
  * REQUEST_TIMEOUT_MS, LLM_GENERATE_TIMEOUT_MS, LLM_REPAIR_TIMEOUT_MS

### `src/llm/gemini/client.js`

* `runWithModelFallback({ candidates, callFn, timeoutMs })`
* 후보 모델을 순회하되 **실패 시에만** 다음 후보
* 오류 분류(reasonCode) + attempts 메타

### `src/llm/gemini/prompts/htmlPrompts.js`

* 하우스 아트 디렉션 + 덱 계약(섹션/네비/프린트)
* “HTML only” 강제

### `src/html/extract/extractHtmlFromText.js`

* fenced/doctype/htmlTag 추출
* `extractionMethod` 반환

### `src/html/finalize/finalizeHtmlDocument.js`

* `stripAfterHtmlClose`
* scaffold 래핑
* 닫기 보정 + utf-8 메타 보장

### `src/html/postprocess/navigation.js`

* `ensureInteractiveDeckHtml(html)`:
  * `hasNavLogic` false면 deck-nav-engine 주입
  * **버튼 ID 유연 바인딩** (prev/prevBtn/첫 버튼 등)
  * 초기 active 보장
  * print 지원 보장

### `src/html/postprocess/meaningful.js`

* `isMeaningfulHtml(html)`:
  * 문서 구조 존재
  * 텍스트 길이
  * 슬라이드 수(권장: >= 6, 최소: >= 2)
* `detectNavRequired(html)` + `hasNavLogic(html)`
  * progress-bar 오탐 금지

### `src/html/postprocess/polish.js` (v1 최소)

* CSS-only safe patch(토큰 alias 정도)
* DOM 변형/스크립트 삽입 금지 (v1 안정성 우선)

### `src/html/fallback/houseRenderer.js`

* rule-based 덱 생성(항상 동작)
* 하우스 디자인 토큰 반영

### `src/pipelines/generatePipeline.js`

* 전체 orchestration:
  * 파서 → LLM → extract → finalize → ensure nav → (optional) repair → fallback
  * 타임아웃/예산 관리
  * **메타 기록** (hasApiKey/rawLength/extractedLength/slideCount/navLogic/timings)

### `public/index.html`

* 업로드/생성 UI
* 결과 미리보기 iframe
* 다운로드 링크: Blob URL 생성 + 이전 URL revoke
* 상단 메타 표시:
  * Mode/RenderMode/WHY/extraction/finalized/repairAttempted/rawLength/extractedLength/slideCount/timings

---

## 9) 템플릿 정의(하우스 스타일) — house-nextgen-exec

### 기본 레이아웃(권장)

* `<main id="deck" class="deck">`
* 각 슬라이드: `<section class="slide deck-slide"> ... </section>`
* 슬라이드 구조: header / body / footer(메타)
* 색/타이포 토큰:
  * `--bg0 --bg1 --ink --muted --primary --accent`
  * `--font-head --font-body`
  * spacing scale `--s1..--s6`

### 컴포넌트(LLM 권장, v1은 강제 아님)

* card grid (2col/3col)
* KPI band
* timeline rail
* table zebra
* code panel(코드 슬라이드)

### 네비게이션(엔진이 처리)

* `.nav-ui` 또는 `#controls` 지원
* 키보드 지원 필수
* progress-bar는 옵션

---

## 10) 테스트/검증(필수)

### `scripts/smoke-html-pipeline.js`

* 샘플 텍스트 입력으로 end-to-end:
  * LLM mock 또는 실제 호출(옵션)
  * extract/finalize/nav 주입까지 실행
* 결과 HTML이:
  * 슬라이드 >=2
  * nav 로직 존재
  * 첫 슬라이드 visible

### `scripts/test-navigation-detection.js`

* progress-bar만 있는 경우 nav 오탐 방지
* 버튼 ID가 prevBtn/nextBtn이어도 엔진이 바인딩 가능한지(유연 바인딩)

### `scripts/test-contamination.js`

* script in attr/unclosed script/style/unclosed quote 등 기본 오염 감지(최소)

---

## 11) 운영/보안 원칙(필수)

* GEMINI_API_KEY는 **서버에서만** 사용
* UI/응답/로그에 키 출력 금지
* 에러 응답에도 키 포함 금지
* raw LLM 텍스트는 저장하지 말고 길이(rawLength)만 기록(선택)

---

## 12) v2(90점+)로 갈 때의 안전한 확장 방향(참고)

* A4 변환은 “최종 HTML → print CSS 변환”으로만 (생성 단계 옵션으로 제한하지 않기)
* DOM sanity(jsdom)는 v1에서 OFF, v2에서 1회만(성능/복잡도 고려)
* “저슬라이드(<=4)”는 v2에서 expand pass 고려 (v1은 경고만)
* Phase2/3 프리미엄 컴포넌트 승격은 **polish strong 모드**로 분리하여 LTS 안정성과 격리

---

## 13) “80점 기준” 체크리스트(이 스펙의 Done Definition)

* 같은 PDF로 3회 생성 시:
  * (1) 버튼/키보드 슬라이드 전환이 항상 동작
  * (2) 첫 슬라이드가 항상 보임
  * (3) 무한 로딩 없음(150s 내 종료)
  * (4) fallback 시 WHY가 명확히 표시됨
* LLM 성공 케이스에서:
  * extractedLength > 0, slideCount >= 6(권장)
  * finalizeApplied true
* fallback 케이스에서:
  * score null, UI는 N/A 표시
  * 다운로드/미리보기 정상

---
