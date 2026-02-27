
---

```md
# TechStack.md — Report2Slide v1 (80점 LTS)

이 문서는 Report2Slide v1(Direct-only, Variant=1, Ref=off, House style 고정)을 **재현 가능하게 빌드**하기 위한 기술 스택/패키지/설치 가이드를 정의합니다.

> 목표: “항상 동작하는 HTML 덱” + “항상 응답” + “fallback + 관측 메타”  
> 고도화(프리미엄 polish/DOM 변형/A4/export)는 v2로 격리합니다.

---

## 1) Runtime / Platform

- **Node.js**: 18 LTS 이상 권장 (최소 18, 권장 20)
- **OS**: Windows 10/11, macOS, Linux 지원
- **Package manager**: npm (기본), pnpm/yarn도 가능하나 v1은 npm 기준

---

## 2) Backend (Node/Express)

### 핵심 역할
- 파일 업로드 수신
- 텍스트 추출(PDF/DOCX/TXT/MD)
- Gemini 호출(1-shot doc→HTML + 선택적 repair 1회)
- HTML 후처리(finalize + nav/print 보장)
- 실패 시 rule-based fallback
- 응답 메타(whyFallback/timings/rawLength 등) 반환

### 필수 패키지
- `express` — HTTP 서버
- `multer` — multipart/form-data 업로드 처리
- `dotenv` — 환경변수(.env) 로딩

설치:
```bash
npm install express multer dotenv
```

---

## 3) Document Parsing (Text Extraction)

### PDF

* `pdfjs-dist` — PDF 텍스트 추출(페이지별)

설치:

```bash
npm install pdfjs-dist
```

### DOCX

* `mammoth` — DOCX → 텍스트 변환

설치:

```bash
npm install mammoth
```

### TXT / MD

* Node 내장 `fs`로 buffer→utf8 string (인코딩 정책 준수)

> v1은 OCR/이미지 기반 PDF 처리 범위 밖(비목표)

---

## 4) LLM (Gemini) Integration

### SDK

* `@google/generative-ai` — Gemini API 호출

설치:

```bash
npm install @google/generative-ai
```

### 모델 후보(v1 기본)

* Primary: `gemini-3-flash-preview`
* Secondary: `gemini-2.5-flash`

### 호출 정책

* Generate: primary 1회, 실패 시 secondary 1회 (총 2회 내)
* Repair: 조건부 1회 (Generate 성공했지만 구조 실패일 때만)
* 타임아웃:
  * request 150s
  * generate 60s
  * repair 40s

### 환경 변수

`.env` (UTF-8 without BOM)

```env
GEMINI_API_KEY=your_api_key_here
PORT=3000
```

> API 키는 **서버에서만** 사용. 클라이언트/public으로 노출 금지.

---

## 5) Frontend (v1 Minimal UI)

### 핵심 역할

* 파일 업로드 UI
* `/api/generate-llm` 호출
* 결과 메타 표시
* 결과 HTML 미리보기(iframe srcdoc 권장)
* 다운로드(Blob URL + revoke)

### 기술 선택(v1)

* **Vanilla HTML/CSS/JS** (프레임워크 사용하지 않음)
* 이유: 안정성/간결성/빌드 도구 의존 최소화

### Tailwind/CSS 라이브러리

* **v1에서는 앱 UI에 Tailwind 불필요**
  (프롬프트/생성 HTML 덱 내부에서 Tailwind CDN을 쓰는 것은 가능하지만, v1에서는 “후처리로 동작 보장”이 우선)

> 권장: 생성된 덱 HTML은 “순수 CSS + :root 토큰” 기반을 기본으로 유지
> (Tailwind CDN은 네트워크/차단/일관성 이슈가 있어 v2에서 옵션화 권장)

---

## 6) HTML Deck Engine (Output Contract)

### 출력 덱 최소 계약(v1)

* `<section>` 기반 슬라이드(최소 6장 권장, 최소 2장 필수)
* 첫 슬라이드 visible (active 없으면 서버가 강제 부여)
* 키보드/버튼 네비게이션
* print CSS: 슬라이드별 page-break
* 진행바(progress-bar)는 선택 요소(존재해도 nav 판정에 사용 금지)

### 서버 후처리 기능(v1)

* extractHtmlFromText(raw): fenced > doctype > htmlTag
* finalizeHtmlDocument: stripAfterHtmlClose + scaffold + meta charset
* ensureInteractiveDeckHtml:
  * nav 로직 없으면 표준 nav 엔진(deck-nav-engine) 주입
  * 버튼 id가 달라도 동작하도록 유연 바인딩(prev/prevBtn/첫 버튼 등)

---

## 7) Testing / Tooling

### 필수 스크립트(v1)

* `scripts/smoke-html-pipeline.js` — end-to-end 스모크
* `scripts/test-navigation-detection.js` — nav 오탐/바인딩 회귀 방지
* `scripts/test-contamination.js` — 기본 오염(스크립트 in attr/unclosed quote 등) 방지

### 권장 개발 의존성(선택)

* `nodemon` — 개발 중 자동 재시작

```bash
npm install -D nodemon
```

package.json 예시:

```json
{
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js",
    "test:smoke": "node scripts/smoke-html-pipeline.js"
  }
}
```

---

## 8) Encoding / Repository Policy

* 모든 텍스트 파일은 **UTF-8 without BOM**
* Node.js 파일 I/O는 `utf8` 명시
* PowerShell 저장은 `-Encoding utf8` 명시
* Pre-commit 수준 체크: `scripts/check-encoding.js --staged` 사용

(자세한 규칙은 `AGENTS.md` 참조)

---

## 9) Optional (v2로 격리 권장)

다음 항목은 안정성 리스크/복잡도 증가로 v1에서 제외:

* A4/PDF export 변환(최종 HTML → print 변환으로만 접근)
* DOM sanity(jsdom) 게이트(성능/무한대기 위험)
* premium polish(Glass/CodePanel/Timeline) DOM 변형 기반 승격
* expand pass(저슬라이드 자동 확장)
* variantCount>1 (다중 시안)
* reference templates on/off/auto (레퍼런스 라이브러리)

---

## 10) Install Quickstart

```bash
# 1) install
npm install

# 2) .env 작성 (UTF-8 without BOM)
# GEMINI_API_KEY=...
# PORT=3000

# 3) run
npm start

# 4) smoke test
node scripts/smoke-html-pipeline.js
```

---

## 11) Dependency List (Summary)

Runtime deps:

* express
* multer
* dotenv
* pdfjs-dist
* mammoth
* @google/generative-ai

Dev deps (optional):

* nodemon
