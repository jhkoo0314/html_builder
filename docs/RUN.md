# PRD v0.2 Final (RUN SSOT)

본 문서는 현재 운영/개발의 SSOT다.
Layer1(Report2Text)은 철회되었고, 시스템은 `launcher + layer2 + layer3`만으로 운영한다.

## 1. 제품 목표
- 사용자 UX는 1-step 유지: 문서 업로드 후 고급 덱 생성
- 내부 L3 파이프라인은 2-step 고정: `analyze -> render`
- Layer2는 안정화 버전 동결(운영 관측 `/healthz` 제외 로직 변경 금지)

## 2. 아키텍처 원칙
- 단일 진입점: 사용자는 `launcher`만 실행
- Boot-time spawn: `L2`, `L3`만 상시 구동
- 코드/패키지 격리: 레이어 간 import/require 및 공유 패키지 금지
- launcher 역할: UI + API Gateway + Process Manager
- From-L1 연계: 삭제. 향후 필요 시 신규 RFC로 재도입

## 3. 포트/환경변수
### 3.1 기본 포트
- Launcher: `5170`
- Layer2: `5172`
- Layer3: `5173`

### 3.2 launcher 환경변수
- `LAUNCHER_PORT=5170`
- `L2_PORT=5172`
- `L3_PORT=5173`
- `ARTIFACTS_ROOT=<repo-root>/.artifacts`
- `HEALTH_CHECK_INTERVAL_MS=2000`
- `HEALTH_CHECK_TIMEOUT_MS=800`
- `HEALTH_CHECK_STARTUP_GRACE_MS=30000`
- `RESTART_MAX_ATTEMPTS=5`
- `RESTART_WINDOW_MS=300000`
- `RESTART_BACKOFF_BASE_MS=500`

## 4. Launcher 동작 규칙
### 4.1 Process
- 시작 시 즉시 L2/L3 spawn
- health polling 대상: `http://127.0.0.1:<PORT>/healthz`
- 상태 전이: `starting -> healthy -> unhealthy -> failed`
- 재시작 정책: window + backoff + jitter

### 4.2 API Gateway
- `POST /api/run/l2/build` -> `L2 /api/generate-llm`
- `POST /api/run/l3/build-direct` -> `L3 /api/l3/build-direct`

운영 API:
- `GET /api/status`
- `GET /api/logs?service=L2|L3`
- `GET /healthz`

## 5. Layer3 Advanced: Direct only + 내부 2-step
### 5.1 외부 UX(1-step)
- 입력: 문서 업로드
- 호출: `POST /api/run/l3/build-direct`
- 출력: 고급 덱(`deck.html`)

### 5.2 내부 파이프라인(2-step)
1. `analyze()`
- 문서 분석 후 구조화 결과를 `analysis.json`으로 저장
- 동일 runId 하위 중간 산출물/캐시로 사용

2. `render()`
- `analysis.json`을 입력으로 템플릿 렌더링 수행
- 최종 `deck.html` 생성

규칙:
- 두 단계는 동일 `runId`에서 수행
- `render()` 실패 시 `analysis.json` 보존
- 동일 `runId`에서 `render()` 재실행 가능해야 함

## 6. 분석 스키마 (analysis.json 최소 스키마)
```json
{
  "docTitle": "string",
  "docSummary": "string",
  "headings": ["string"],
  "slidePlan": [
    {
      "title": "string",
      "bullets": ["string"],
      "evidenceHints": ["string"],
      "layoutHint": "string"
    }
  ],
  "warnings": ["LOW_STRUCTURE"],
  "stats": {
    "extractedLength": 0,
    "headingCount": 0
  }
}
```

제약 원칙:
- 분석은 최소 제약만 강제: 필수 필드 + `evidenceHints`
- 장수/레이아웃 과도 강제 금지(품질 저하 방지)

## 7. 렌더링 정책 (MVP 선택)
- Tailwind CDN을 L3 기본 렌더 기반으로 사용
- 생성 경로 MVP: "템플릿/토큰 기반 코드 렌더"를 우선 채택
- LLM HTML 직접 생성은 선택 옵션(후속)으로 유지

## 8. 실패 처리 정책
### 8.1 정책 옵션
- 옵션 A: analyze 실패 시 즉시 실패 반환
- 옵션 B: analyze 실패 시 최소 규칙 기반 fallback analysis 생성 후 render 진행

### 8.2 MVP 선택
- 기본은 옵션 A(분석 실패 시 실패 반환)
- 단, 실패 원인/입력 요약을 `meta.json`에 기록
- render 실패 시: fallback 렌더 경로 시도 + `analysis.json` 보존

## 9. Artifacts SSOT
### 9.1 L2 (Stable)
- `{runId}/layer2/deck.html`
- `{runId}/layer2/meta.json`

### 9.2 L3 (Advanced)
- `{runId}/layer3/analysis.json`
- `{runId}/layer3/deck.html`
- `{runId}/layer3/meta.json`

`meta.json` 최소 타이밍 필드:
- `analyzeMs`
- `renderMs`
- `totalMs`

launcher UI 결과 카드:
- `deck.html`, `meta.json`, `analysis.json` 링크 노출(analysis는 디버그 용도)

## 10. 품질 가드레일 (80점 LTS)
- 분석: 스키마 및 근거 힌트 중심 최소 제약
- 생성: 템플릿 + 테마 토큰 중심 렌더
- 후처리: 가독성(폰트/대비/행간), 밀도(텍스트량), 구조(내비게이션) 점검
- L2 영향 0: L3 변경이 L2 경로/로직에 영향을 주지 않아야 함

## 11. 변경 이력
- 2026-02-27: Layer1 철회, L2/L3 체계 전환
- 2026-02-27: L3 Direct only + 내부 Analyze Cache/Render 2-step SSOT 확정
