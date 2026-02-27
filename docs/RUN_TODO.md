# RUM TODO (Based on `docs/RUN.md`)

## 1) 구현계획 검토 결과

### 확정된 SSOT (그대로 준수)
- Launcher 단일 진입점 + Boot-time spawn으로 `L2/L3` 상시 실행
- 레이어 간 코드/의존성 공유 금지 (import/require 금지, 각자 lockfile 유지)
- Launcher는 UI/API Gateway/Process Manager 역할만 수행
- Launcher는 전역 추론 없이 레이어별 명시적 커맨드 맵을 사용
- Layer2(stable) spawn 커맨드는 `npm.cmd start`로 고정
- Health/Restart 고정값:
  - `STARTUP_GRACE_MS=30000`
  - 연속 health 실패 임계치 `N=3`
  - unhealthy 지속 임계치 `X=10s`
  - 재시작 정책: `5분 내 최대 5회`, exponential backoff base `500ms`
- L2 health 원칙: `GET /healthz` 제공 (운영용, 비즈니스 로직 변경 없음)
- L3는 L2(`v0.1.0-stable.1`) 기준 one-time file-level clone(COPY)로 시작 후 독립 진화
  - 복제 이후 L2↔L3 코드 공유/상호 import/공용 패키지/공용 스크립트 금지
  - 고도화(디자인/템플릿/렌더링 모드)는 L3에서만 구현
  - 금지: workspace/shared module/git submodule/runtime dependency 기반 연동
  - L3 direct build 통과
  - launcher boot-time spawn + `/healthz` polling 통과
  - L3 `ARTIFACTS_ROOT` 주입값 일치 검증 통과

### 리스크/주의점
- “코드 복사도 금지” 제약으로 `/healthz`는 레이어별 독립 작성 필요
- Windows 종료 처리에서 자식 프로세스 트리 정리가 불완전할 수 있음
- Artifact 정적 서빙 시 path traversal 방어 누락 위험

---

## 2) 상세 구현 계획 (Task Breakdown)

  - [ ] 사용자 실제 실행 확인(acceptance) 완료

## Phase 0. 기준선 고정
- [x] P0-1. 환경변수 계약 문서화 (`docs/PHASE0_BASELINE.md`)
- [x] P0-2. 포트/경로 SSOT 고정 (`5170~5173`, `ARTIFACTS_ROOT`)
- [x] P0-3. 런처-레이어 API 매핑표 확정 (`/api/run/*` 프록시 타깃)
- [x] P0-4. 레이어별 spawn 커맨드 맵 고정 문서화 (명시적 매핑)
  - [x] L2: `npm.cmd start` (고정)
  - [x] L3: `npm.cmd start`
- [x] P0-5. Health/Restart 상수 고정 (`30000`, `N=3`, `X=10s`, `5회/5분`, `500ms`)
- [x] P0-6. L3 초기 생성 방식 고정 (L2 `v0.1.0-stable.1`에서 one-time COPY)
- [x] P0-7. 복제 이후 독립성 규칙 문서화 (공유 금지 목록 명시)
  - [x] 금지: workspace/shared module/git submodule/runtime dependency
  - [x] 금지: L2↔L3 import/require, 공용 scripts/packages

완료기준
- [x] 모든 팀원이 동일한 env 키/포트/엔드포인트로 실행 가능
- [x] L3 베이스라인 출처(태그/복제시점)가 문서에 추적 가능

## Phase 1. Launcher 프로세스 관리 뼈대
- [x] P1-1. `processManager` 서비스 레지스트리 정의 (L2/L3)
- [x] P1-2. Boot-time 병렬 spawn 구현 (`cwd`, `env override`)
- [x] P1-2a. per-layer command map 적용 (전역 dev/prod 추론 제거)
- [x] P1-2b. L2는 항상 `npm.cmd start` 사용 강제
- [x] P1-3. 상태 저장소 구현 (`starting/healthy/unhealthy/crashed/failed`)
- [x] P1-4. graceful shutdown 구현 (`SIGTERM`→5s→`SIGKILL`)
- [x] P1-5. stdout/stderr 수집 + `[L2|L3]` prefix 로그 버퍼(최근 200줄)

완료기준
- [x] Launcher 1회 실행으로 L2/L3 프로세스가 모두 기동
- [x] Ctrl+C 시 자식 프로세스가 종료됨
- [x] 실행/의존성 관점에서 L2-L3 결합점이 없음(독립 실행 확인)

## Phase 1.5. L3 Fork Baseline 검증
- [x] P1.5-1. Layer3가 Layer2 `v0.1.0-stable.1` 기반 one-time copy인지 증적화
- [x] P1.5-2. Layer2/L3 간 상호 import 경로 스캔(금지 규칙 위반 탐지)
- [x] P1.5-3. package/script 공유 여부 점검 (락파일/스크립트 독립성 확인)
- 실행 도구: `npm.cmd run verify:fork-baseline`
- 증적 파일: `docs/L3_FORK_BASELINE_EVIDENCE.json`
- 검증 리포트: `docs/PHASE1_5_REPORT.md`

완료기준
- [x] Layer3는 복제 후 독립 코드베이스로 운영됨

## Phase 2. Health polling + auto-restart
- [x] P2-1. 주기적 health check 구현 (`interval/timeout/startup grace`)
- [x] P2-2. `N=3` 연속 실패 카운트 기반 `healthy→unhealthy` 전이
- [x] P2-3. `exit`/`X=10s` 지속 unhealthy 트리거 재시작
- [x] P2-4. 재시작 window 제한(`5분 내 5회`) + exponential backoff(base `500ms`) + jitter
- [x] P2-5. `GET /api/status`, `GET /api/logs` 제공

완료기준
- [x] 비정상 종료 또는 health 실패 시 자동 재시작 동작
- [x] 재시도 한도 초과 시 `failed` 상태 전이 확인

## Phase 3. 레이어별 `/healthz` 표준화
- [x] P3-2. L2 `/healthz` 구현 (ops-only, 비즈니스 로직 비변경)
- [x] P3-3. L3 `/healthz` 구현 (Direct/From-run mode 정보 포함)
- [x] P3-4. 응답 스키마 필드 점검 (`ok, service, port, pid, uptimeMs, artifactsRoot`)

완료기준
- [x] 세 레이어 health 응답이 launcher polling과 정상 연동

## Phase 4. API Gateway 프록시 연결
- [x] P4-2. `POST /api/run/l2/build` 프록시
- [x] P4-3. `POST /api/run/l3/build-direct` 프록시
- [x] P4-4. `POST /api/run/l3/build-from-run` 프록시
- [x] P4-5. 공통 오류 매핑(타임아웃/5xx/연결실패) 및 UI 친화 에러 포맷

완료기준
- [x] UI는 launcher만 호출해 4개 액션을 모두 실행 가능

- [ ] P5A-5. 사용자 실행 시나리오 검증 및 수용 확인

완료기준
- [ ] 사용자 관점 재현 절차 1회 이상 성공

- [ ] P6-1. `POST /api/l3/build-direct` 실제 구현
- [ ] P6-2. `POST /api/l3/build-from-run` 실제 구현
- [ ] P6-3. L3 outputs 저장 (`layer3/deck.html`, `layer3/meta.json`)
  - [ ] L3 standalone DoD 통과 (direct build)
  - [ ] launcher spawn + `/healthz` polling DoD 통과
  - [ ] L3 `ARTIFACTS_ROOT` 주입값 일치 확인

완료기준
- [ ] L3 direct/from-run 성공

## Phase 7. Artifact protocol + 정적 서빙
- [ ] P7-1. Launcher `GET /artifacts/<runId>/...` 정적 서빙
- [ ] P7-2. 보안 처리 (path traversal 차단, runId whitelist)
- [ ] P7-3. 결과 파일 다운로드 링크 검증

완료기준
- [ ] 결과 파일 다운로드 링크가 정상 동작

## Phase 8. Launcher UI 구현
- [ ] P8-1. 상단 상태바 (상태/포트/재시작횟수/lastHealth)
- [ ] P8-2. 4개 모드 액션 UI (Analyze/Stable/Direct/From-run)
- [ ] P8-3. 실행 결과 Run 카드 누적 렌더
- [ ] P8-5. 로그 뷰어(선택) + 최근 200줄 표시

완료기준
- [ ] 모드 선택→실행→결과/다운로드까지 launcher UI 단독으로 완결

## Phase 9. LauncherMeta 정규화
- [ ] P9-1. 레이어 raw 응답 수집 및 `rawMeta` 보존
- [ ] P9-2. `launcher-meta-v0.2` 정규화 모듈 구현
- [ ] P9-3. metrics/timings/llm 필드 없을 때 안전 렌더 처리
- [ ] P9-4. `SUCCESS|FALLBACK|FAILED` 판정 규칙 정리

완료기준
- [ ] 서로 다른 레이어 응답도 동일한 UI 카드 스키마로 렌더

## Phase 10. 통합 검증/릴리스 체크
- [ ] P10-1. DoD 시나리오 테스트 스크립트화
- [ ] P10-2. 장애 시나리오 테스트 (강제 kill, health timeout, restart limit)
- [ ] P10-3. 문서 동기화 (`RUN.md`, runbook, env 예시, known issues)
- [ ] P10-4. 최종 수용 점검표 작성

완료기준
- [ ] RUN.md의 DoD 항목 전부 통과

---

## 3) 우선순위 (실행 순서)
1. Phase 0~2 (런처 생명주기 안정화)
2. Phase 3~4 (health + 프록시 연결)
5. Phase 6 (L3 구현)
6. Phase 7~9 (artifact/UI/메타 통합)
7. Phase 10 (통합 검증 및 문서화)

## 4) 최소 마일스톤
- M1: Launcher 기동/상태/재시작까지 동작 (UI 상태바 포함)
- M2: 4개 모드 프록시와 runId 연동 동작
- M4: L3 기능 완성(direct/from-run)
- M5: 결과 카드/다운로드/메타 정규화 완성
- M6: DoD 전체 통과

## 5) SSOT 운영 상수(고정)
- Spawn command map: per-layer explicit map 사용
- L2 spawn command: `npm.cmd start`
- `STARTUP_GRACE_MS=30000`
- Health failure threshold: `N=3`
- Unhealthy sustain threshold: `X=10s`
- Restart policy: `5 attempts / 5 minutes`, backoff base `500ms`
- L2 health endpoint: `GET /healthz` (ops-only)
- L3 baseline: Layer2 `v0.1.0-stable.1` one-time file-level COPY
- Post-clone policy: no shared code/imports/packages/scripts between L2 and L3
- Clone mechanism constraints: not workspace, not shared module, not git submodule import path, not runtime dependency
