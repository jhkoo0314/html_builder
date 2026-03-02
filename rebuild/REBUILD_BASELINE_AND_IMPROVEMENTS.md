# Rebuild 기준/비교/개선 명세서

작성일: 2026-03-01  
대상 프로젝트: `C:\html_builder`

## 1) 문서 목적
- 현재 코드베이스를 **실무 재구축 기준(Baseline)** 으로 정리한다.
- 현재 상태(As-Is)와 목표 상태(To-Be)를 비교해 **구체 개선사항**을 명시한다.
- 재구축 시 우선순위와 단계별 완료 기준(Definition of Done)을 제공한다.

## 2) 현재 프로젝트 기준선 (As-Is)

### 아키텍처/실행
- 진입점은 `launcher`이며 `layer2-stable`, `layer3-advanced`를 프로세스로 기동.
- 라우팅:
  - `POST /api/run/l2/build` -> L2 `/api/generate-llm`
  - `POST /api/run/l3/build-direct` -> L3 `/api/l3/build-direct`
- L3는 `analyze -> render` 2-step 경로를 사용.

### 기능
- 문서 업로드(PDF/DOCX/TXT) -> HTML 슬라이드 생성.
- LLM 실패/무응답 시 룰 기반 fallback 렌더링.
- 스타일 모드(`normal|creative|extreme`) 및 톤 모드(`auto|light|dark`) 지원.

### 운영/품질
- 헬스 체크와 재시작 정책(launcher process manager) 존재.
- 스모크 테스트 스크립트 중심 검증.
- API 인증/권한/레이트리밋은 미적용.

## 3) 실무 재구축 목표 (To-Be)

### 목표 원칙
- 안전성: 인증/권한/입력 제한/비용 보호가 기본값.
- 이식성: OS 의존 제거(Windows 고정 제거), 컨테이너 우선.
- 단순성: 중복 코드 제거, 단일 책임 구조.
- 관측성: 로그/메트릭/트레이싱으로 운영 가시성 확보.
- 검증력: 단위/통합/E2E 자동화와 CI 게이트.

### 목표 아키텍처 (권장)
- `api-gateway` + `orchestrator` + `worker` 분리.
- 업로드 파일은 object storage/S3 호환 저장 후 비동기 처리(큐 기반) 권장.
- 생성 작업은 `jobId` 기반 상태 추적(`queued/running/succeeded/failed`).
- 장기적으로 L2/L3를 플러그인 전략으로 통합(공통 파서/공통 파이프라인).

## 4) As-Is vs To-Be 비교 및 개선사항

| 구분 | 현재(As-Is) | 목표(To-Be) | 개선사항 |
|---|---|---|---|
| 업로드 처리 | 메모리 저장(`multer.memoryStorage`) | 파일 크기/개수 제한 + 스트리밍/임시저장 | `limits` 적용, 업로드 크기 정책(예: 파일당 20MB, 총 50MB), 스트리밍 처리 |
| 프록시 처리 | 본문 전체 Buffer 후 업스트림 전송 | 스트리밍 프록시 + 역압(backpressure) | `http-proxy`/`undici` 기반 스트리밍으로 변경 |
| 보안 | 인증/인가/레이트리밋 부재 | API Key/JWT + RBAC + Rate Limit | `/api/run/*`, `/api/logs`, `/api/status` 보호 |
| 런타임 이식성 | `npm.cmd`, Windows 분기 다수 | OS 중립 실행 + Docker/K8s 친화 | `npm`/`node` cross-platform spawn, 컨테이너 엔트리포인트 표준화 |
| 코드 구조 | `src/layer2/layer3` 중복 다수 | 공통 모듈화 + 버전 전략 분리 | parser/pipeline/prompt 공통 패키지로 분리 |
| 장애 복구 | 프로세스 재시작 위주 | 프로세스 + 작업 레벨 재시도 + DLQ | retry policy, idempotency key, 실패 사유 표준화 |
| 관측성 | 콘솔/상태 API 중심 | 구조화 로그 + metrics + tracing | pino + OpenTelemetry + Prometheus 도입 |
| 테스트 | smoke 스크립트 중심 | unit/integration/e2e + 계약 테스트 | CI 파이프라인 게이트(coverage, contract, lint) |
| API 계약 | 일부 필드 하드코딩(`purposeMode=general`) | 버전드 API 계약(OpenAPI) | OpenAPI 명세 + schema validation(zod/ajv) |
| 문서 인코딩 | 일부 문서 깨짐 이슈 | UTF-8 규약 강제 | pre-commit 인코딩 검사와 변환 정책 확정 |

## 5) 우선순위 로드맵

### Phase 0 (즉시, 1주)
- 입력/메모리 보호:
  - 업로드 제한(`limits.fileSize`, `limits.files`) 적용.
  - 요청 timeout/body limit 재점검.
- 접근 통제:
  - 최소한의 API Key 인증 및 레이트리밋 추가.
- 운영 위험 차단:
  - `/api/logs`, `/api/status` 외부 노출 차단(내부망/인증 뒤).

완료 기준:
- 대용량 업로드 시 정상 거절(413) 확인.
- 무인증 요청이 보호 엔드포인트에서 401/403 반환.

### Phase 1 (단기, 2~3주)
- 코드 통합:
  - 중복 parser/pipeline 공통 모듈화.
  - launcher/runtime 설정 스키마화(env validation).
- 테스트 체계:
  - unit + integration 기본 세트 구축.
  - L3 direct API 계약 테스트 도입.

완료 기준:
- 중복 파일 30% 이상 축소.
- CI에서 테스트/린트/계약검증 통과 시에만 merge.

### Phase 2 (중기, 3~6주)
- 아키텍처 고도화:
  - 큐 기반 비동기 job 처리.
  - 결과 저장소/아티팩트 관리 표준화.
- 관측성 고도화:
  - tracing + 메트릭 + 에러 예산 기반 알람.

완료 기준:
- `jobId` 기반 비동기 API 운영.
- P95 처리시간, 실패율, fallback율 대시보드 제공.

## 6) 실무 품질 기준 (NFR)
- 성능:
  - API P95 < 2s(접수), 작업 완료 SLA 별도 정의.
- 안정성:
  - 월 가용성 99.9% 목표.
- 보안:
  - OWASP API Top10 대응 체크리스트 적용.
- 비용:
  - 요청당 LLM 토큰/시간/재시도 상한 강제.
- 추적성:
  - 모든 요청에 `requestId`, 작업에 `jobId` 부여.

## 7) 재구축 체크리스트
- [ ] 업로드/프록시 메모리 보호 적용
- [ ] 인증/인가/레이트리밋 적용
- [ ] OS 중립 실행 방식으로 교체
- [ ] 중복 모듈 공통화
- [ ] OpenAPI/스키마 검증 도입
- [ ] CI 파이프라인 구축
- [ ] 관측성 스택 적용
- [ ] 장애 복구/재시도 정책 문서화

## 8) 결론
- 현재 프로젝트는 기능적으로 빠르게 동작하는 프로토타입-실전 사이 단계다.
- 실무 재구축 핵심은 **보안/입력제어**, **구조 단순화**, **운영 가시성**, **검증 자동화**다.
- 위 로드맵대로 진행하면, 기능 유지하면서도 운영 가능한 제품 품질로 전환 가능하다.
