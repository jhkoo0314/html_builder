# Phase 0 Baseline (SSOT Lock)

이 문서는 `docs/RUN.md`와 `docs/RUM_TODO.md`의 Phase 0(P0-1~P0-7)을 실제 적용 가능한 기준선으로 고정한다.

## 1. 환경변수 계약 (P0-1)

현재 저장소는 단일 루트 구조이며 `launcher/layer*` 디렉토리는 아직 생성 전이다.  
아래 계약은 레이어 분리 시 그대로 적용한다.

### 1.1 launcher `.env.example` 계약
- `LAUNCHER_PORT=5170`
- `L1_PORT=5171`
- `L2_PORT=5172`
- `L3_PORT=5173`
- `ARTIFACTS_ROOT=<repo-root>/.artifacts` (절대경로 권장)
- `HEALTH_CHECK_INTERVAL_MS=2000`
- `HEALTH_CHECK_TIMEOUT_MS=800`
- `HEALTH_CHECK_STARTUP_GRACE_MS=30000`
- `RESTART_MAX_ATTEMPTS=5`
- `RESTART_WINDOW_MS=300000`
- `RESTART_BACKOFF_BASE_MS=500`

### 1.2 layer 공통 `.env.example` 계약
- `PORT=<layer-port>`
- `ARTIFACTS_ROOT=<launcher와 동일 경로>`
- `GEMINI_API_KEY=...` (필요 레이어만)

## 2. 포트/경로 SSOT (P0-2)
- Launcher: `5170`
- Layer1: `5171`
- Layer2: `5172`
- Layer3: `5173`
- 공통 artifacts 경로: `ARTIFACTS_ROOT` 단일값을 launcher가 주입

## 3. 런처-레이어 API 매핑 (P0-3)
- `POST /api/run/l1/analyze` -> `http://127.0.0.1:${L1_PORT}/api/l1/analyze`
- `POST /api/run/l2/build` -> `http://127.0.0.1:${L2_PORT}/api/generate-llm`
- `POST /api/run/l3/build-direct` -> `http://127.0.0.1:${L3_PORT}/api/l3/build-direct`
- `POST /api/run/l3/build-from-run` -> `http://127.0.0.1:${L3_PORT}/api/l3/build-from-run`

## 4. Spawn 커맨드 맵 (P0-4)

전역 `dev/prod` 추론 금지. 레이어별 명시 커맨드만 사용.

```json
{
  "L1": ["npm.cmd", "start"],
  "L2": ["npm.cmd", "start"],
  "L3": ["npm.cmd", "start"]
}
```

고정 규칙:
- Layer2(stable)는 항상 `npm.cmd start`

## 5. Health/Restart 상수 (P0-5)
- `STARTUP_GRACE_MS=30000`
- Health failure threshold `N=3`
- Unhealthy sustain threshold `X=10s`
- Restart max `5` attempts in `5` minutes
- Exponential backoff base `500ms`

## 6. L3 초기 생성 방식 (P0-6)
- Layer3는 Layer2의 안정화 태그 `v0.1.0-stable.1`에서 **one-time file-level COPY**로 생성한다.
- COPY 이후 Layer3는 독립 진화한다.

추적 필수 항목:
- Source tag: `v0.1.0-stable.1`
- Clone method: `file-level copy (one-time)`
- Clone timestamp: `<when executed>`

## 7. 복제 이후 독립성 규칙 (P0-7)

금지:
- workspace 공유
- shared module 패턴
- git submodule import path
- runtime dependency로 Layer2 참조
- L2<->L3 상호 `import/require`
- L2/L3 공용 `package.json`/`package-lock.json`/scripts 공유

허용:
- 동일한 인터페이스를 각자 독립 구현
- 문서 수준의 계약 공유(코드 공유 아님)
