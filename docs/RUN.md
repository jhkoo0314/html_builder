아래는 너의 최종 결정(✅  **Boot-time spawn: 항상 L1/L2/L3 3개 서버 상시 실행** , ✅  **L3 From L1 = outline 중심 코드 렌더** , ✅  **연결 = artifact_id(runId) 방식** , ✅  **UI는 Launcher 단일 UI에서 모드 선택** )을 모두 반영한 **PRD v0.2 (Final)** 입니다.

요구사항을 다시 SSOT로 고정합니다:

* **각 Layer는 완전히 격리된 독립 폴더/독립 파일/독립 의존성**을 가진다.
* **레이어 간 import/require 금지** , 공용 패키지/워크스페이스 공유 금지.
* 사용자는 **Launcher 하나만 실행**한다.
* Launcher는  **부팅 시 L1/L2/L3 서버를 항상 띄운다(Boot-time spawn)** .
* Launcher는 UI + API Gateway + Process Manager 역할만 하며, 레이어 코드를 import하지 않는다.
* **Layer2는 안정화 버전으로서 기능 로직 변경은 금지** (단, /healthz 같은 운영용 엔드포인트는 “동작을 바꾸지 않는 최소 추가”로만 허용 범위에 포함시키는 것으로 본 PRD에서는 정의한다.  *추가도 절대 싫다면, 아래 /healthz의 Layer2 구현을 “GET /로 대체” 옵션으로 바꿀 수 있음* ).
* **[SSOT: Layer3 is a fork/clone of Layer2 (one-time copy), then diverges]**
  * Layer3는 안정화 태그 `v0.1.0-stable.1` 기준 Layer2를 **파일 단위 1회 복제(COPY)** 하여 생성한다.
  * 복제 이후 Layer3는 독립 진화한다. Layer2와 **코드 공유/상호 import/공용 패키지/공용 스크립트**를 금지한다.
  * 디자인/템플릿/렌더링 모드 개선은 Layer3에만 반영한다. Layer2는 본 PRD의 명시적 운영용 예외(예: `GET /healthz`) 외 기능 로직을 동결 유지한다.
  * 복제 메커니즘은 **COPY only** 이며 workspace/shared module/git submodule/runtime dependency 방식은 금지한다.

---

# PRD v0.2 (Final)

## 1. 제품 개요

### 목표

문서 기반 프레젠테이션 생성 시스템을 **3개 레이어(L1/L2/L3)**로 격리하고, **Launcher 단일 UI**에서 모드를 선택하여 실행한다.

* **L1 Report2Text** : 문서 분석 → `outline.md + outline.json + extract.txt` 생성 및 웹 편집
* **L2 Stable** : 안정화 HTML 생성(동결 유지)
* **L3 Advanced** :
* **Direct** : 문서 업로드 → LLM HTML 직접 생성(디자인 고도화)
* **From L1** : runId 기반으로 artifacts 읽기 → **outline 중심 코드 렌더(Tailwind CDN)**

---

## 2. 핵심 원칙(강제)

### 2.1 격리(Isolation)

* 레이어 간 코드 공유 금지:
  * `layer1`이 `layer2`/`layer3` 코드를 import/require 금지
  * `layer3`가 `layer1`/`layer2` 코드를 import/require 금지
  * `launcher`는 어떠한 레이어 코드도 import/require 금지
* 의존성 공유 금지:
  * 각 폴더가 **자기 package.json / package-lock.json** 보유
  * 루트 workspace/monorepo 공유 설치 금지(공유 node_modules 금지)
* 파일 규칙 공유 금지:
  * 각 layer는 artifacts 생성/저장도 **자기 구현**으로 수행(단, 경로/레이아웃은 프로토콜로 합의)

### 2.2 단일 진입점(Single Entry UX)

* 사용자는 `launcher`만 실행한다.
* Launcher는 부팅 시 **항상** L1/L2/L3 서버를 띄운다(Boot-time spawn).
* UI는 launcher에서만 제공(레이어 UI는 “있어도 되지만” 운영 UX에서는 사용하지 않음).

### 2.3 L2→L3 복제 및 독립 진화(Fork-by-copy)

* Layer3 초기 베이스라인은 Layer2(`v0.1.0-stable.1`)에서 1회 복제한 코드다.
* 이후 Layer2와 Layer3 사이의 코드/의존성/스크립트 공유를 금지한다.
* Layer2 변경은 운영용 엔드포인트 수준 최소 변경만 허용하고, 기능 고도화는 Layer3에서만 수행한다.

---

## 3. 리포지토리/폴더 구조(최종)

```text
repo-root/
  launcher/                         # 단일 진입점(UI+Gateway+ProcessManager)
    package.json
    package-lock.json
    .env.example
    README.md
    src/
      server.js                     # Express: UI 제공 + /api/* gateway
      processManager.js             # Boot-time spawn + health polling + restart + shutdown
      proxyRoutes.js                # API 라우팅(모드별)
      statusStore.js                # 프로세스 상태/헬스/재시작 카운트 메모리 저장
    public/
      index.html                    # 모드 선택 UI + 결과/메타 표시
      app.js                        # (선택) UI 스크립트
      styles.css                    # (선택)
    scripts/
      bootstrap-install.js          # (선택) 각 레이어 npm install 자동 실행(공유 설치 아님)
  layer1-report2text/
    package.json
    package-lock.json
    .env.example
    README.md
    src/
      server.js
      api/
      parsers/
      llm/                          # (L1이 LLM을 쓰면 여기에)
      artifacts/
    public/                         # (선택) L1 단독 UI. 운영에서는 launcher UI 사용.
    scripts/
    docs/
  layer2-stable/
    (v0.1.0-stable.1 기반. 기능 로직 동결)
    package.json
    package-lock.json
    .env.example
    README.md
    src/
      server.js
      api/
      pipelines/
      parsers/
      llm/
      html/
      diagnostics/
    public/
    scripts/
    docs/
  layer3-advanced/
    package.json
    package-lock.json
    .env.example
    README.md
    src/
      server.js
      api/
      llm/                          # Direct 모드용
      render/                       # From L1 코드 렌더(templates)
      artifacts/
    public/                         # (선택) L3 단독 UI. 운영에서는 launcher UI 사용.
    scripts/
    docs/
  PRD_v0.2_FINAL.md
```

---

## 4. 포트/환경변수(Launcher가 SSOT)

### 4.1 고정 포트(기본값)

* Launcher: `5170`
* Layer1: `5171`
* Layer2: `5172`
* Layer3: `5173`

### 4.2 launcher/.env.example (권장)

* `LAUNCHER_PORT=5170`
* `L1_PORT=5171`
* `L2_PORT=5172`
* `L3_PORT=5173`
* `ARTIFACTS_ROOT=<repo-root>/.artifacts` (절대경로 권장)
* `HEALTH_CHECK_INTERVAL_MS=2000`
* `HEALTH_CHECK_TIMEOUT_MS=800`
* `HEALTH_CHECK_STARTUP_GRACE_MS=30000`
* `RESTART_MAX_ATTEMPTS=5`
* `RESTART_WINDOW_MS=300000` (5분)
* `RESTART_BACKOFF_BASE_MS=500`

### 4.3 각 레이어 .env.example (독립)

* `PORT=<각 레이어 포트>`
* `ARTIFACTS_ROOT=<launcher와 동일한 경로>` ← **L1과 L3는 반드시 동일**
* L2/L3 Direct가 LLM 사용 시:
  * `GEMINI_API_KEY=...` 등(레이어별로 독립 파일에서 로드)

> Launcher는 spawn 시 `PORT`와 `ARTIFACTS_ROOT`를 **강제 주입**한다(override).
> 키/기타 옵션은 각 레이어가 자기 `.env`에서 로드(launcher가 간섭하지 않음).

---

## 5. Launcher ProcessManager 동작 규칙(필수)

### 5.1 Boot-time spawn (항상 3개 실행)

Launcher 시작 시 즉시 아래를 수행:

1. `layer1-report2text` 서버 spawn
2. `layer2-stable` 서버 spawn
3. `layer3-advanced` 서버 spawn
   → 병렬로 실행 가능(권장)

Spawn 방식:

* Node `child_process.spawn()` 사용
* `cwd`: 해당 레이어 폴더
* `env`:
  * 기존 process.env + 레이어별 `PORT`, `ARTIFACTS_ROOT`
* 실행 커맨드(레이어별 독립):
  * 기본: `npm run dev`
  * 운영: `npm start`
  * Launcher는 레이어의 scripts 이름을 “문서로” 알고 있을 뿐, 코드로 공유하지 않음.

### 5.2 Health check (표준)

* Launcher는 각 레이어에 대해 다음 URL로 주기적 체크:
  * `http://127.0.0.1:<PORT>/healthz`
* 체크 주기: `HEALTH_CHECK_INTERVAL_MS` (기본 2초)
* 타임아웃: `HEALTH_CHECK_TIMEOUT_MS` (기본 800ms)
* startup grace: `HEALTH_CHECK_STARTUP_GRACE_MS` (기본 30s)
  * grace 동안은 헬스 실패해도 “starting” 상태로 유지

### 5.3 상태 머신(launcher 내부)

* `starting` → (health ok) → `healthy`
* `healthy` → (연속 실패 N회, 기본 3회) → `unhealthy`
* `unhealthy` → (자동 재시작 성공) → `healthy`
* 프로세스 종료 감지(exit) → `crashed`

### 5.4 자동 재시작(Auto restart)

재시작 트리거:

* child process `exit` 이벤트 발생(비정상 종료)
* 또는 `unhealthy` 상태가 `X초` 이상 지속(기본 10초)

재시작 정책:

* window 내 최대 재시작 횟수 제한
  * `RESTART_WINDOW_MS` 내 `RESTART_MAX_ATTEMPTS` 초과 시 `failed` 상태로 전환
* backoff:
  * `delay = RESTART_BACKOFF_BASE_MS * 2^(attempt-1) + jitter(0~250ms)`
* 재시작 시:
  * 기존 프로세스가 남아있으면 종료 시도 후 재spawn
  * 재spawn 후 startup grace 적용

### 5.5 종료(Shutdown) 규칙

Launcher 종료(SIGINT/SIGTERM) 시:

1. 모든 child에 `SIGTERM` 전송
2. `5000ms` 대기
3. 아직 살아있으면 `SIGKILL` (Windows에서는 가능한 범위에서 process.kill, 필요 시 tree-kill 대응은 추후)
4. Launcher 종료

### 5.6 로그 스트리밍(운영 필수)

* child stdout/stderr를 launcher가 수집
* 각 라인에 prefix 부여:
  * `[L1] ...`
  * `[L2] ...`
  * `[L3] ...`
* UI에서 “최근 200줄 보기” 가능(선택)

---

## 6. /healthz 표준(레이어별 개별 구현, 공유 코드 없음)

각 레이어는 **독립적으로** `/healthz`를 구현한다. (코드 복사도 금지, 각자 작성)

### 6.1 요청/응답

* `GET /healthz`
* 응답 status: `200` (정상), `503` (비정상/준비 안됨)

#### 응답 JSON 스키마(표준)

```json
{
  "ok": true,
  "service": "layer1-report2text|layer2-stable|layer3-advanced",
  "version": "0.2.0",
  "port": 5171,
  "pid": 12345,
  "uptimeMs": 123456,
  "startedAt": "2026-02-27T00:00:00.000Z",
  "artifactsRoot": "C:\\...\\.artifacts",
  "ready": true,
  "details": {
    "hasApiKey": true,
    "llmEnabled": true,
    "mode": "direct|from-run|stable|analyze"
  }
}
```

* `details.hasApiKey`: LLM 사용하는 레이어는 키 보유 여부를 표시(키가 없어도 서버는 ready일 수 있음)
* `ready`: 서버가 요청 처리 가능한 상태인지(라우트 등록/필수 디렉토리 접근 가능 여부 등)
* `service/version`: 런처 UI 표시와 디버그를 위해 필수

> Layer2가 “진짜 완전 동결”로 인해 /healthz 추가도 불가하다면:
> 예외 규칙으로 launcher는 L2에 한해 `GET /` 200 응답을 health로 간주하도록 설정할 수 있다. (본 PRD 기본안은 /healthz 추가 허용)

---

## 7. API Gateway(Launcher) — 모드 선택/프록시 규칙

Launcher는 UI에서 들어오는 요청을 레이어 서버로 프록시한다.

### 7.1 런처 자체 API

* `GET /api/status`
  * L1/L2/L3의 상태(starting/healthy/unhealthy/failed), lastHealth, restartCount, ports
* `GET /api/logs?service=L1|L2|L3`
  * 최근 로그 n줄(선택)

### 7.2 실행 API(프록시)

UI는 **항상 launcher로만** 요청:

* L1 분석
  * `POST /api/run/l1/analyze` → `http://127.0.0.1:L1_PORT/api/l1/analyze`
* L2 안정화 빌드
  * `POST /api/run/l2/build` → `http://127.0.0.1:L2_PORT/api/generate-llm`
* L3 Direct
  * `POST /api/run/l3/build-direct` → `http://127.0.0.1:L3_PORT/api/l3/build-direct`
* L3 From runId(=From L1 artifacts)
  * `POST /api/run/l3/build-from-run` → `http://127.0.0.1:L3_PORT/api/l3/build-from-run`

---

## 8. Artifact Protocol (runId) — 연결의 SSOT

### 8.1 ARTIFACTS_ROOT(공유 데이터, 공유 코드 아님)

* Launcher가 `ARTIFACTS_ROOT`를 L1/L3에 동일 값으로 주입
* L1이 생성한 runId artifacts를 L3가 읽는다.

### 8.2 runId 레이아웃(표준)

L1 생성(필수):

```text
{ARTIFACTS_ROOT}/{runId}/
  manifest.json
  source/original.(pdf|docx|txt)
  extract/extracted.txt
  extract/extract.meta.json
  layer1/outline.json
  layer1/outline.md
  layer1/layer1.meta.json
```

L3 생성(필수):

```text
{ARTIFACTS_ROOT}/{runId}/layer3/deck.html
{ARTIFACTS_ROOT}/{runId}/layer3/meta.json
```

### 8.3 From L1 연결 UX(launcher UI)

* L1 분석 실행 후 결과 카드에:
  * “Build Advanced (From this runId)” 버튼 제공
  * 버튼 클릭 시 runId를 `POST /api/run/l3/build-from-run`에 전달

---

## 9. Layer별 기능 명세(요약)

### 9.1 Layer1 Report2Text

* `POST /api/l1/analyze`:
  * 업로드 문서 → 텍스트 추출 → outline JSON/MD 생성 → artifacts 저장
* UI에서 outline 편집(웹에서만)
* 저장:
  * `POST /api/l1/runs/:runId/save-outline` (outline.json/md 업데이트)

### 9.2 Layer2 Stable

* 기존 안정화 파이프라인 유지
* Launcher에서 “Stable Build” 클릭하면 L2에 프록시 호출

### 9.3 Layer3 Advanced

* Direct: 문서 업로드 → LLM HTML 생성(디자인 고도화, Tailwind CDN)
* From-run: runId 기반으로 artifacts 읽기 → **outline 중심 코드 렌더**
  * LLM polish: MVP 비활성

---

## 10. UI(Launcher public/index.html) 요구사항

### 10.1 상단 상태바(필수)

* L1/L2/L3 상태 표시:
  * starting/healthy/unhealthy/failed
* 포트, 재시작 카운트, last health timestamp 표시

### 10.2 모드 선택(필수)

* 탭/카드로 4가지 액션 제공:
  1. Analyze (L1)
  2. Build Stable (L2)
  3. Build Advanced Direct (L3)
  4. Build Advanced From runId (L3)

### 10.3 결과 표시(필수)

* 실행 결과는 “Run 카드”로 누적
* 각 카드에:
  * runId
  * action/mode
  * 성공/실패(OK/FALLBACK)
  * 핵심 메트릭(슬라이드 수, timings, 모델 사용)
  * 다운로드 링크(outline/md/json or deck.html)
  * Raw meta 펼치기(JSON)

---

## 11. UI 결과 표시 메타 스키마(LauncherMeta v0.2)

Launcher는 레이어 응답을 그대로 보여주되, UI에서 일관된 카드 렌더를 위해 **표준화된 UI 메타**를 가진다.
(정규화는 launcher에서만 수행. 레이어 코드 import 없음.)

### 11.1 LauncherMeta (정규화)

```json
{
  "uiMetaVersion": "launcher-meta-v0.2",
  "runId": "20260227_153012_abcd",
  "action": "l1-analyze|l2-build|l3-direct|l3-from-run",
  "layer": "L1|L2|L3",
  "ok": true,
  "status": "SUCCESS|FALLBACK|FAILED",
  "whyFallback": "N/A|LLM_TIMEOUT|LLM_ERROR|NO_SLIDES|...",
  "artifactsRoot": "C:\\...\\.artifacts",
  "outputs": [
    { "kind": "outline.json", "path": "/artifacts/<runId>/layer1/outline.json", "mime": "application/json" },
    { "kind": "deck.html", "path": "/artifacts/<runId>/layer3/deck.html", "mime": "text/html" }
  ],
  "metrics": {
    "slideCount": 16,
    "rawLength": 21026,
    "extractedLength": 21026,
    "extractionMethod": "doctype|pdf|docx|text|none"
  },
  "timings": {
    "totalMs": 58000,
    "extractMs": 1200,
    "generateMs": 57520,
    "repairMs": 0,
    "renderMs": 0
  },
  "llm": {
    "attempted": true,
    "modelUsed": "gemini-2.5-flash",
    "attemptCount": 1,
    "attempts": [
      { "model": "gemini-2.5-flash", "ok": true, "ms": 57520, "timeoutMs": 120000, "reasonCode": "OK" }
    ]
  },
  "rawMeta": { }
}
```

### 11.2 레이어별 rawMeta 보존

* launcher는 원본 메타를 `rawMeta`에 그대로 저장/표시
* UI 카드 렌더는 `metrics/timings/llm`만 사용(필드 없으면 미표시)

### 11.3 Artifact 파일 서빙(launcher)

* `GET /artifacts/<runId>/...` 형태로 제공(정적 서버)
* 보안:
  * path traversal 방지(`..`, absolute path 차단)
  * runId whitelist(디렉토리 존재 여부 확인)

---

## 12. DoD(완료 기준)

### 런처 DoD

* `npm run dev` 한 번으로 L1/L2/L3가 모두 실행됨
* `/api/status`에서 3개 모두 `healthy` 표시
* 프로세스 종료/비정상 종료 시 자동 재시작 동작
* Ctrl+C 종료 시 child 프로세스 모두 종료

### /healthz DoD

* 각 레이어가 `/healthz` JSON을 반환
* launcher health polling이 안정적으로 상태를 갱신

### UI DoD

* 모드 선택 + 실행 + 결과 카드 표시
* runId 기반으로 L1 → L3(from-run) 버튼 연결
* outputs 다운로드 링크 정상

---

## 13. 구현 순서(추천)

1. Launcher skeleton + ProcessManager(boot-time spawn) + /api/status + UI 상태바
2. 각 레이어 `/healthz` 개별 구현
3. Launcher proxy routes 4개 연결
4. Artifact static serving(`/artifacts/*`)
5. UI 결과 카드 + LauncherMeta 정규화

---
