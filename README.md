# html_builder

문서(PDF/DOCX/TXT)에서 프레젠테이션 HTML 슬라이드를 생성하는 서버 프로젝트입니다.

## 버전 / 상태
- App Version: `0.1.0`
- Stabilization Version: `v0.1.0-stable.1` (2026-02-27)
- Stabilization Status: `성공` (LLM 생성 경로 정상 동작 확인)

## 목차
- [Quickstart (1분 실행)](#quickstart-1분-실행)
- [API 재현 예시 (cURL/HTTP)](#api-재현-예시-curlhttp)
- [Environment Variables](#environment-variables)
- [운영 메타 판정 요약 (SSOT)](#운영-메타-판정-요약-ssot)
- [Stability Contract (LTS 불변 규칙)](#stability-contract-lts-불변-규칙)
- [테스트/검증 전략 (최소 세트)](#테스트검증-전략-최소-세트)
- [보안/키 관리](#보안키-관리)
- [프로젝트 폴더 구조 (역할 주석)](#프로젝트-폴더-구조-역할-주석)
- [상세 운영 문서](#상세-운영-문서)

## Quickstart (1분 실행)
목적: 신규 사용자가 1회 성공 실행을 빠르게 재현한다.

### 필수 환경
- Node.js: `>=18`
- OS: Windows/WSL 모두 가능
- 네트워크: `generativelanguage.googleapis.com:443` 접근 가능

### .env 설정
```bash
# Windows PowerShell
Copy-Item .env.example .env
```

`.env` 필수 항목:
```env
GEMINI_API_KEY=your_api_key
# optional
PORT=3000
```

### 가장 짧은 성공 경로
```bash
npm install
npm run dev
```

브라우저: `http://localhost:3000`

CLI 1회 호출:
```bash
curl -X POST "http://localhost:3000/api/generate-llm" \
  -F "documents=@./samples/report.txt"
```

### 성공 판정 기준
- `mode == "llm-gemini"`
- `htmlVariants[0].whyFallback == ""` (UI에서는 `N/A`로 보일 수 있음)
- `htmlVariants[0].meta.slideCount >= 2`

## API 재현 예시 (cURL/HTTP)
목적: 입력/출력 재현과 자동 판정을 가능하게 한다.

### 1) 슬라이드 생성
```bash
curl -X POST "http://localhost:3000/api/generate-llm" \
  -F "documents=@./samples/report.txt"
```

### 2) 네트워크 진단
```bash
curl "http://localhost:3000/api/network-diagnostics"
```

### 3) 응답에서 meta만 추출
```bash
curl -s -X POST "http://localhost:3000/api/generate-llm" \
  -F "documents=@./samples/report.txt" \
| jq '{mode, renderMode: .htmlVariants[0].renderMode, whyFallback: .htmlVariants[0].whyFallback, meta: .htmlVariants[0].meta}'
```

### 4) 자동 성공 판정 예시
```bash
curl -s -X POST "http://localhost:3000/api/generate-llm" \
  -F "documents=@./samples/report.txt" \
| jq '(.mode=="llm-gemini") and (.htmlVariants[0].whyFallback=="") and (.htmlVariants[0].meta.slideCount>=2)'
```

## Environment Variables
목적: 운영에 필요한 변수와 고정 정책(SSOT)을 명확히 구분한다.

### 런타임 환경변수
| 변수명 | 필수 | 기본값 | 설명 |
|---|---|---:|---|
| `GEMINI_API_KEY` | Yes | `""` | Gemini API 키. 없으면 `NO_API_KEY` fallback |
| `PORT` | No | `3000` | 서버 포트 |
| `REPORT2SLIDE_TINY_SMOKE` | No | `0` | `1`이면 tiny smoke 프롬프트 + 네트워크 진단 메타 활성화 |
| `HTTPS_PROXY` | No | `""` | HTTPS 프록시 |
| `HTTP_PROXY` | No | `""` | HTTP 프록시 |
| `NO_PROXY` | No | `""` | 프록시 제외 대상 |

### Stable.1 SSOT 고정값
| 정책 항목 | 값 |
|---|---:|
| `gemini-2.5-flash timeout` | `120000ms` |
| `gemini-3-flash-preview timeout` | `15000ms` |
| `TOTAL_LLM_BUDGET_MS` | `135000ms` |
| `ATTEMPT_TIMEOUT_MS` | `120000ms` |
| `LLM_REPAIR_TIMEOUT_MS` | `40000ms` |
| `REQUEST_TIMEOUT_MS` | `150000ms` |
| `MIN_LLM_REMAINING_BUDGET_MS` | `5000ms` |

## 운영 메타 판정 요약 (SSOT)
목적: 메타 필드만으로 성공/실패를 즉시 판정한다.

핵심 필드:
- `mode`
- `htmlVariants[0].renderMode`
- `htmlVariants[0].whyFallback`
- `htmlVariants[0].meta.slideCount`
- `htmlVariants[0].meta.timings.totalMs`
- `htmlVariants[0].meta.timings.generateMs`
- `htmlVariants[0].meta.timings.repairMs`
- `htmlVariants[0].meta.llmAttempts[]`

요약 판정 규칙:
- If `mode=="llm-gemini"` and `whyFallback==""` and `slideCount>=2` then `SUCCESS`
- Else `FAIL_OR_FALLBACK`

`whyFallback` / `llmAttempts.reasonCode` 상세 정의:
- [docs/META_SCHEMA.md](./docs/META_SCHEMA.md)

## Stability Contract (LTS 불변 규칙)
목적: 안정화 범위 밖 변경을 차단하고 회귀를 방지한다.

불변 파이프라인:
1. 1-shot generate
2. optional repair 1회
3. finalize
4. navigation 보강
5. meaningful/slide 검증
6. 실패 시 fallback

금지 사항:
- 다중 pass 생성/복구 루프 추가
- 과도한 sanitize로 본문/구조를 임의 축소하는 변경
- 안정성 검증 없이 프롬프트 제약을 강하게 추가하는 변경

운영 교훈(정책 반영):
- 스몰패치(후처리/언어 제약)도 `NO_SLIDES` 재발 요인이 될 수 있음
- 정책 변경 시 fallback 비율과 `whyFallback` 분포를 반드시 함께 검증

## 테스트/검증 전략 (최소 세트)
목적: 릴리스 직전 필수 안정성만 빠르게 확인한다.

테스트별 보장 범위:
- `npm run test:smoke`: 파이프라인 기본 동작성
- `npm run test:nav`: 내비게이션 감지/보강 안정성
- `npm run test:contamination`: 출력 오염 방지
- `npm run check:encoding`: UTF-8 인코딩 게이트

릴리스 전 체크리스트:
1. smoke 통과
2. `/api/network-diagnostics` 정상
3. encoding gate 통과
4. 샘플 문서 2종에서 `mode=llm-gemini` 성공
5. fallback 케이스 1종에서 `whyFallback` 기대 코드 확인

## 보안/키 관리
목적: API 키 유출과 배포 사고를 방지한다.

규칙:
- `GEMINI_API_KEY`는 `.env`에만 저장하고 Git에 커밋하지 않는다.
- `.env`는 배포/아티팩트에 포함하지 않는다.
- `public/index.html` 및 클라이언트 코드에 API 키를 하드코딩하지 않는다.
- 로그 공유 시 키/토큰/프록시 인증정보를 마스킹한다.

## 프로젝트 폴더 구조 (역할 주석)
```text
html_builder/
├─ src/                                 # 서버 애플리케이션 핵심 코드
│  ├─ server.js                         # Express 서버 엔트리포인트, 정적파일/라우트 연결
│  ├─ api/
│  │  └─ routes/
│  │     └─ generate-llm.js             # 문서 업로드 -> 파이프라인 실행 API
│  ├─ pipelines/
│  │  └─ generatePipeline.js            # 파싱 -> LLM -> 추출/검증/repair -> fallback 전체 흐름
│  ├─ parsers/
│  │  ├─ index.js                       # 파서 진입점/조합
│  │  ├─ pdf.js                         # PDF 텍스트 추출
│  │  ├─ docx.js                        # DOCX 텍스트 추출
│  │  └─ text.js                        # TXT 텍스트 추출
│  ├─ llm/
│  │  └─ gemini/
│  │     ├─ client.js                   # 모델 fallback, timeout, budget, 재시도 제어
│  │     └─ prompts/
│  │        └─ htmlPrompts.js           # HTML 생성/repair 프롬프트
│  ├─ html/
│  │  ├─ extract/
│  │  │  └─ extractHtmlFromText.js      # LLM 응답 텍스트에서 HTML 추출
│  │  ├─ finalize/
│  │  │  └─ finalizeHtmlDocument.js     # doctype/head/body 보정
│  │  ├─ postprocess/
│  │  │  ├─ navigation.js               # Prev/Next/키보드 내비게이션 보강
│  │  │  └─ meaningful.js               # 최소 슬라이드/의미성 검증
│  │  └─ fallback/
│  │     └─ houseRenderer.js            # LLM 실패 시 규칙 기반 HTML 생성
│  ├─ config/
│  │  ├─ defaults.js                    # 모델 후보, timeout, 예산, 정책 기본값
│  │  └─ env.js                         # 환경변수 로딩
│  └─ diagnostics/
│     └─ network.js                     # DNS/HTTPS 네트워크 진단
├─ public/
│  └─ index.html                        # 업로드/미리보기/메타 로그 UI
├─ scripts/                             # 개발/검증 스크립트
│  ├─ smoke-html-pipeline.js
│  ├─ test-navigation-detection.js
│  ├─ test-contamination.js
│  ├─ network-diagnostics.js
│  └─ check-encoding.js
├─ docs/
│  ├─ SPEC.md
│  ├─ TechStack.md
│  ├─ TODO.md
│  ├─ META_SCHEMA.md                    # 운영 메타 스키마 상세
│  └─ RUNBOOK.md                        # 장애 대응 절차
├─ package.json
├─ package-lock.json
├─ .env.example
├─ .env
├─ encoding.allowlist.json
├─ AGENT.md
└─ README.md
```

## 상세 운영 문서
- 메타 스키마 상세: [docs/META_SCHEMA.md](./docs/META_SCHEMA.md)
- 장애 대응 런북: [docs/RUNBOOK.md](./docs/RUNBOOK.md)
