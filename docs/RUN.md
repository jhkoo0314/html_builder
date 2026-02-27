좋아요. 네 답변 기준으로 **“Layer2(안정화)는 절대 불변”**을 전제로, **Layer1/Layer3를 독립 실행 가능한 제품처럼 분리**하면서도 **Layer1 UI에서 전체 플로우를 오케스트레이션**하는 형태로 초기 기획안을 내려줄게요. (Tailwind CDN 1차, Web UI 편집만, L3 From L1 MVP에서 LLM polish 비활성)

---

# 1) 제품 개념 설계

## 레이어별 역할

### Layer1: Report2Text

* **입력** : PDF/DOCX/TXT
* **출력** : `docs` (사용자가 편집 가능한 슬라이드 설계도 + 요약)
* **목적** : 문서 내용을 “슬라이드 단위 의미 구조(Outline)”로 정리하고, 사용자가 편집/다운로드/고급 빌드 연결을 할 수 있게 함.

### Layer2: Stable HTML (동결)

* **입력** : 원문
* **출력** : 안정화 HTML 슬라이드
* **정책** : 현재 stable.1 그대로 동작(코드/동작/예산/검증/후처리 포함)
* **원칙** : “절대 수정하지 않음”. 문제가 생기면 Layer3에서 해결.

### Layer3: Advanced HTML

* **두 경로 지원(사용자 선택)**
  1. **Direct 업로드 → LLM HTML 직접 생성** (자유도 높임, 최소 제약)
  2. **From Layer1 → docs + 원문(본문) 동시 전달 → 고급 HTML 렌더**
     * MVP:  **LLM polish 비활성** , 하지만 “본문도 같이 전달/저장”해 맥락을 유지 (향후 옵션/확장 대비)
* **1차 목표** : L2 기반에서  **더 예쁘고 현대적인 디자인** (Tailwind CDN + 미리 준비된 컴포넌트/레이아웃)
* **2차 목표** : 발표 대상별 컨셉/테마(추후)

---

# 2) 독립 실행 + 연결이 동시에 가능한 운영 구조

요구사항 “각 레이어 독립 실행”을 지키면서, 유저 플로우는 Layer1에서 이어지게 하려면 아래가 가장 안전합니다.

## 권장: “3개 서버 + Layer1이 메인 UI”

* Layer1 서버(메인 UI 포함): `http://localhost:5171`
* Layer2 stable 서버: `http://localhost:5172`
* Layer3 advanced 서버: `http://localhost:5173`

### 독립성

* 각 레이어는 자기 서버만으로 단독 실행 가능
* Layer1은 Layer2/Layer3이 꺼져 있어도 분석/다운로드까지는 가능

### 연결

* Layer1 UI에서 “Build Stable / Build Advanced” 버튼 누르면 각 서버 API 호출
* 로컬 개발자용이므로 CORS는 간단히 허용(또는 동일 origin 프록시)

---

# 3) Artifact(산출물) 중심 설계: 레이어 간 전달을 ‘파일’로 SSOT화

“원문 + 설계도”를 Layer3로 넘겨야 한다는 요구는  **브라우저에서 대용량 payload로 넘기지 말고** , 로컬 아티팩트로 SSOT화하는 게 안정적입니다.

## 아티팩트 디렉토리 (로컬 전용)

* `./.artifacts/{runId}/`

구성 예시:

```text
.artifacts/2026-02-27_153012_abcd/
  source/
    original.pdf
  extract/
    extracted.txt
    extract.meta.json
  layer1/
    outline.md
    outline.json
    layer1.meta.json
  layer2/
    deck.html
    meta.json
  layer3/
    deck.html
    meta.json
```

**핵심 포인트**

* Layer1이 `runId` 생성 → 원문/추출텍스트/outline 저장
* Layer3 From L1은 `runId`만 받으면 **원문 + 추출텍스트 + outline**를 모두 읽어 맥락 유지 가능

---

# 4) 데이터 계약: Layer1 docs 포맷 정의 (MVP)

사용자는 웹 UI에서만 편집, 다운로드는 docs.
→ 사람이 보기 좋고 편집하기 쉬운 **MD**를 주력으로, 파이프라인 안정성을 위해 **JSON sidecar**를 함께 저장/다운로드하는 걸 추천합니다(로컬 개발자용이라 부담 없음).

## outline.md (사람용, 다운로드 기본)

* 예: `# Title`, `## Slide 1`, `- bullet` …

## outline.json (기계용, L3 렌더 SSOT)

최소 스키마:

```json
{
  "version": "r2t-0.1",
  "title": "…",
  "summary": "…",
  "slides": [
    {
      "id": "s1",
      "title": "…",
      "bullets": ["…", "…"],
      "notes": "",
      "layoutHint": "title|two-col|kpi|table|timeline|quote"
    }
  ]
}
```

> 너가 말한 “맥락”은 JSON에 담기기 어렵기 때문에,  **extract/extracted.txt** (본문)를 항상 같이 보관/전달합니다.

---

# 5) API 설계(초안)

## Layer1 API

* `POST /api/l1/report2text`
  * multipart: `documents[]`
  * 응답: `{ runId, outlinePreview, meta }`
* `GET /api/runs`
  * runId 목록
* `GET /api/runs/:runId`
  * 메타/파일 링크
* `GET /api/runs/:runId/layer1/outline.md`
* `GET /api/runs/:runId/layer1/outline.json`
* `GET /api/runs/:runId/extract/extracted.txt`

## Layer2 API(동결)

* 기존 stable의 `POST /api/generate-llm` 유지
* 추가 연결만 필요하면(코드 건드리지 않기 원칙이니까) Layer1에서 “파일 업로드를 다시” 하거나,
  * 또는 Layer2 앞단에 프록시 서버를 두는 방식(추후)

## Layer3 API

### A) Direct 업로드

* `POST /api/l3/build-direct`
  * multipart: `documents[]`
  * 옵션: `themePreset`, `density`, `languageHint` 등(하지만 **제약 최소화**가 원칙이므로 MVP는 최소 옵션)

### B) From L1 (runId 기반)

* `POST /api/l3/build-from-run`
  * body: `{ runId, themePreset? }`
  * Layer3는 로컬 `.artifacts/runId/`에서:
    * `extract/extracted.txt`(본문)
    * `layer1/outline.json`(설계도)
    * `source/*`(원본)
      를 읽어 빌드

---

# 6) Layer3 구현 전략(중요): “자유도 높이되, 충돌 지점은 시스템이 통제”

너의 요구: **제약옵션 최소화 + LLM 자유도**
하지만 우리가 과거에 터진 포인트는 거의 항상 “스크립트 충돌/검증 실패/NO_SLIDES” 같은 **구조 계약 붕괴**였음.

그래서 L3에서 자유도를 높이는 방법은 “규칙을 많이 없애기”가 아니라:

## L3 Direct (LLM HTML 생성)에서 LLM이 건드리지 말아야 할 것

* **JS 내비게이션 로직은 LLM에게 맡기지 않고** , 시스템(finalize)에서 주입
* LLM은 “슬라이드 콘텐츠”와 “스타일링(Tailwind class 중심)”에만 집중
  → 자유도는 콘텐츠/레이아웃에 주고, 안정성은 시스템이 보장

### L3 Direct 프롬프트의 “최소 계약(필수 3개만)”

1. HTML만 반환 (doctype/head/body)
2. `<section class="slide">`로 슬라이드 구분, 최소 2장
3. Tailwind CDN 포함(또는 시스템이 삽입)

이 정도면 제약이 적으면서도 NO_SLIDES 확률이 낮아집니다.

---

# 7) Tailwind CDN 기반 디자인 시스템 초안(L3 MVP)

## 기본 구조(공통)

* 배경/타이포 스케일/그리드만 고정하고, 나머지는 자유
* 예: `min-h-screen`, `p-12`, `max-w-6xl`, `leading-snug` 같은 편집적 규칙

## MVP 테마 프리셋 2개(1차 목표에 적합)

* `Executive Dark`: 다크 배경 + 카드/라인 강조
* `Editorial Light`: 화이트 배경 + 타이포 강조(잡지 느낌)

## 레이아웃 템플릿(From L1 렌더용, 8개)

* title / agenda / section divider
* bullets
* two-col
* kpi cards
* table
* timeline
* quote/case

> From L1은 “코드 렌더”라서 디자인 품질이 안정적으로 나오고, LLM이 없어도 예쁩니다.

---

# 8) 구현 로드맵(MVP 우선순위)

## Sprint 1: Layer1 완성 (docs 생성 + 편집 + 다운로드 + runId 저장)

* 가장 먼저: “분석 결과를 사람이 다룰 수 있게” 만드는 게 전체 플로우의 시작점

## Sprint 2: Layer3 From L1 (LLM 없이 코드 렌더)

* docs(JSON) + 본문(txt) 동시 저장/전달
* Tailwind 프리셋 + 템플릿 렌더
* nav/print는 L3 자체 엔진(=L2에서 검증된 엔진 복제)로 주입

## Sprint 3: Layer3 Direct (LLM HTML 생성, 최소 계약)

* 제약 옵션 최소화
* JS는 시스템 주입(충돌 방지)

---

# 9) 여기서 내가 추가로 확인해야 하는 부분(질문 2개만)

이미 거의 다 확정됐고, 아래 2개만 확정하면 설계를 “API/폴더/스크립트” 수준으로 바로 고정할 수 있어요.

1. **Layer1 docs 다운로드 포맷** :
   “MD만” 다운로드면 충분해요? 아니면 “MD + JSON 둘 다”가 좋아요?
   (웹 UI 편집만이라도, L3 From L1 렌더는 JSON이 SSOT라서 **JSON도 같이**를 강력 추천하긴 합니다.)
2. **Layer3 From L1에서 본문(extracted.txt)을 어떻게 쓰길 원해요?**
   * MVP에서는 “저장/전달만 하고 사용은 안 함(향후 대비)”
   * 아니면 MVP에서도 “evidence 패널(본문 검색/근거 표시)” 정도는 바로 쓰길 원함?

답을 주면 다음 단계로, **정확한 실행 스크립트(npm workspaces), 포트/라우팅 설계, runId/파일 저장 규칙, UI 화면 구성(컴포넌트 단위)**까지 한번에 내려줄게요.
