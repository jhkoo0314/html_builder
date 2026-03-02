# Observability Design

작성일: 2026-03-01

## 1. 목표
- 장애를 "감지-진단-복구" 가능한 수준으로 만든다.

## 2. 로그
- 구조화 JSON 로그 사용.
- 필수 필드:
  - `timestamp`
  - `level`
  - `service`
  - `requestId`
  - `jobId`
  - `event`
  - `durationMs`
  - `error.code`

## 3. 메트릭
- 카운터:
  - `jobs_total{status}`
  - `llm_attempt_total{model,result}`
- 히스토그램:
  - `job_duration_ms`
  - `stage_duration_ms{stage}`
- 게이지:
  - `queue_depth`
  - `worker_active`

## 4. 트레이싱
- Trace root: API request.
- Span:
  - upload validate
  - extract
  - analyze
  - render
  - repair/fallback

## 5. 대시보드
- 서비스 상태(성공률/지연/에러율)
- LLM 품질(timeout, fallback, model별 성능)
- 큐/워커 상태

## 6. 알람
- Error budget burn alert.
- Queue backlog alert.
- 인증 실패 급증 alert.

