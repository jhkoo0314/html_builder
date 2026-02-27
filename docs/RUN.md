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
- 출력: 생성 HTML + 메타 + analysis 객체(응답 내 포함)

### 5.2 내부 파이프라인(2-step)
1. `analyze()`
- 업로드 문서에서 텍스트 추출
- 최소 분석 스키마 생성(`docTitle`, `docSummary`, `headings`, `slidePlan`, `warnings`, `stats`)

2. `render()`
- `analysis` + 추출 텍스트를 입력으로 렌더 호출
- 최종 HTML 생성 + 후처리 + fallback 처리

규칙:
- 두 단계는 하나의 요청 안에서 순차 실행
- 파일 시스템 아티팩트(`analysis.json`, `deck.html`, `meta.json`)는 기본 생성하지 않음

## 6. 분석 스키마 (응답 내 analysis 최소 스키마)
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
    "headingCount": 0,
    "sourceFileCount": 0
  }
}
```

## 7. 실패 처리 정책
- analyze 실패: 즉시 실패 반환(`INVALID_INPUT`, `NO_CONTENT`, `ANALYZE_FAILED`)
- render 실패: 즉시 실패 반환(`RENDER_FAILED`)
- 렌더 내부 LLM 실패 시 기존 fallback 규칙은 유지

## 8. L3 응답 메타 SSOT (Direct)
- top-level: `ok`, `runId`, `mode`, `status`, `html`, `analysis`, `htmlVariants`
- `htmlVariants[0].meta.timings`: `analyzeMs`, `renderMs`, `totalMs`, `generateMs`, `repairMs`
- `htmlVariants[0].meta.stats`: `extractedLength`, `headingCount`, `slideCount`

판정 규칙:
- `status == "SUCCESS"` and `slideCount >= 2` -> PASS
- `status == "FALLBACK"` -> FALLBACK
- 그 외 -> FAIL

## 9. 품질 가드레일 (80점 LTS)
- 분석: 스키마 및 근거 힌트 중심 최소 제약
- 생성: 템플릿 + 테마 토큰 중심 렌더
- 후처리: 가독성(폰트/대비/행간), 밀도(텍스트량), 구조(내비게이션) 점검
- L2 영향 0: L3 변경이 L2 경로/로직에 영향을 주지 않아야 함

## 10. 변경 이력
- 2026-02-27: Layer1 철회, L2/L3 체계 전환
- 2026-02-27: L3 Direct only + 내부 Analyze/Render 2-step SSOT 확정
- 2026-02-27: L3 검증 규칙을 PASS-FUNCTIONAL / PASS-META 분리 기준으로 확정
- 2026-02-27: L3 Direct는 파일 아티팩트 비생성(in-memory) 운영으로 전환

