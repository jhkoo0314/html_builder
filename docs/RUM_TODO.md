# RUM TODO (Layer1 철회 반영)

본 문서는 `docs/RUN.md` 기준 실행 계획이다.
운영 범위는 `launcher + layer2 + layer3`이며, L3는 Direct only로 진행한다.

## 1) 확정 사항 (SSOT)
- launcher 단일 진입점 유지
- Boot-time spawn 대상: `L2`, `L3`
- L3 외부 UX: 1-step(업로드 -> 고급 덱 생성)
- L3 내부 파이프라인: 2-step(`analyze -> render`)
- From-L1 연계: 삭제(RFC 보류)
- Layer2 동결 유지(`/healthz` 외 로직 변경 금지)

## 2) Phase별 진행 현황
### Phase 0. 기준선/계약
- [x] 포트/환경변수 기준 정리
- [x] 런처-레이어 API 매핑 정리
- [x] spawn command map 정리

완료기준
- [x] 팀 공통 실행 기준(포트/환경변수/API)이 문서로 고정되어 있다.
- [x] launcher/L2/L3 실행 계약이 충돌 없이 정리되어 있다.

### Phase 1. Launcher 프로세스 관리
- [x] 서비스 레지스트리(L2/L3) 정리
- [x] Boot-time spawn 구현
- [x] 상태 저장소(`starting/healthy/unhealthy/crashed/failed`) 반영
- [x] graceful shutdown 반영
- [x] 로그 prefix/버퍼링 반영

완료기준
- [x] launcher 1회 실행으로 L2/L3가 기동된다.
- [x] 종료 신호 시 자식 프로세스가 정리된다.
- [x] 상태/로그 조회가 운영에 필요한 수준으로 제공된다.

### Phase 2. Health polling + Auto-restart
- [x] health polling 주기/타임아웃/그레이스 반영
- [x] 실패 임계치 기반 상태 전이 반영
- [x] exit/unhealthy 트리거 재시작 반영
- [x] restart window/backoff/jitter 반영
- [x] `/api/status`, `/api/logs` 제공

완료기준
- [x] health 실패 시 상태 전이가 규칙대로 동작한다.
- [x] 비정상 종료/지속 실패 시 자동 재시작이 동작한다.
- [x] 재시작 한도 초과 시 `failed` 전이가 가능하다.

### Phase 3. Gateway/Health 정비
- [x] `POST /api/run/l2/build` 프록시
- [x] `POST /api/run/l3/build-direct` 프록시
- [x] `GET /healthz` 연동 점검
- [x] 공통 오류 매핑(타임아웃/연결 실패/5xx)

완료기준
- [x] launcher 경유로 L2/L3 실행 API가 호출된다.
- [x] 업스트림 오류가 공통 포맷으로 반환된다.

### Phase 4. L3 UI 선행 완료
- [x] Direct 전용 웹 UI 구현
- [x] 서버 기동 후 UI/health/기본 호출 확인

완료기준
- [x] `http://127.0.0.1:<L3_PORT>/`에서 Direct 실행 UI가 동작한다.
- [x] health 상태와 결과 미리보기/다운로드가 노출된다.

### Phase 5. L3 구현 (Analyze Cache + Render)
- [x] P5-1. Direct API 1차 계약 구현(MVP v1)
- [x] `POST /api/l3/build-direct` 요청/응답 스키마 1차 반영
- [x] 오류코드 1차 반영(`INVALID_INPUT`, `NO_CONTENT`, `ANALYZE_FAILED`, `RENDER_FAILED`, `ARTIFACTS_ROOT_MISSING`)

- [x] P5-2. analyze 구현 + 캐시 저장
- [x] analyze 결과를 `{runId}/layer3/analysis.json`으로 저장
- [x] analysis.json 스키마 검증(필수 필드 + evidenceHints)
- [x] analyze 실패 정책(MVP: 실패 반환) 적용

- [x] P5-3. render 구현 1차 (Tailwind templates + theme tokens)
- [x] analysis.json 입력 기반 템플릿 렌더
- [x] 테마 토큰 1차 적용(색/타이포/간격)
- [x] `{runId}/layer3/deck.html` 생성

- [ ] P5-4. postprocess/guardrails
- [ ] 가독성 규칙(폰트/대비/행간) 점검
- [ ] 밀도 규칙(텍스트량/요소수) 점검
- [ ] 구조 규칙(내비게이션/슬라이드 의미 단위) 점검

- [x] P5-5. 산출물/메타 저장 1차 표준화
- [x] `{runId}/layer3/meta.json` 저장
- [x] 타이밍 필드 `analyzeMs`, `renderMs`, `totalMs` 기록
- [ ] 실패 시에도 `analysis.json` 보존(특히 render 실패)

완료기준
- [x] PASS-FUNCTIONAL 충족: direct 실행 시 `analysis.json -> deck.html` 2-step이 동일 runId에서 수행된다.
- [x] PASS-FUNCTIONAL 충족: L3 산출물 3종(`analysis.json`, `deck.html`, `meta.json`)이 규격대로 저장된다.
- [ ] PASS-FUNCTIONAL 충족: render 재실행 시 analysis 캐시 재사용이 가능하다.
- [x] PASS-FUNCTIONAL 충족: L2 경로/결과에 영향이 없다.
- [x] PASS-META 충족: `meta.json` 필수 필드(`runId`,`mode`,`status`,`timings`,`stats`,`warnings`)가 존재한다.
- [x] PASS-META 충족: `timings.analyzeMs`,`timings.renderMs`,`timings.totalMs`가 존재한다.
- [x] `stats.slideCount` 누락 시 FAIL이 아닌 PARTIAL로 분류하고 `effectiveSlideCount`를 결과에 기록한다.

검증내용
- [x] 기능: direct 샘플 3건 생성 성공
- [ ] 캐시 재사용: 동일 runId에서 render-only 재실행 성공
- [x] 메타 검증: PASS-META 필수 필드 누락 없음
- [x] slideCount 검증: `meta.stats.slideCount` 존재 여부 + `effectiveSlideCount`(deck 계산값) 기록
- [x] 무영향성: `POST /api/run/l2/build` 정상 동작 유지

### Phase 6. 회귀 검증 (Phase 5 완료 후)
- [ ] launcher 경유 L2 build E2E 검증
- [ ] launcher 경유 L3 direct E2E 검증
- [ ] 장애 시나리오(강제 종료/헬스 실패) 검증

완료기준
- [ ] L2/L3 주요 실행 경로가 launcher 경유로 재현 가능하다.
- [ ] 정상/실패 케이스에서 응답/로그/산출물이 기대대로 남는다.
- [ ] 재시작 정책이 한도/백오프 규칙대로 동작한다.

검증내용
- [ ] `GET /api/status`, `GET /api/logs?service=L2|L3`, `GET /healthz` 확인
- [ ] `POST /api/run/l2/build` 정상/실패 케이스 확인
- [ ] `POST /api/run/l3/build-direct` 정상/실패 케이스 확인
- [ ] `UPSTREAM_TIMEOUT`, `UPSTREAM_UNREACHABLE` 오류 포맷 확인

### Phase 7. 문서/운영 정리
- [ ] launcher UI 결과 카드에 `analysis.json` 링크 노출 반영 문서화
- [ ] artifacts/runbook/known issues 동기화
- [ ] L1 관련 잔여 문구 정리 완료

완료기준
- [ ] 문서 세트가 L3 analyze/render SSOT와 일치한다.
- [ ] 운영자가 문서만으로 실행/장애대응 가능하다.

검증내용
- [ ] 문서 검색: `rg -n "layer1|/api/l1|L1_PORT|build-from-run" docs launcher layer3-advanced/docs`
- [ ] 잔여 결과가 철회/보류 안내 외에는 0건인지 확인

## 3) 우선순위
1. Phase 5 L3 구현(Analyze Cache + Render)
2. Phase 6 E2E 회귀 검증
3. Phase 7 문서 정리

## 4) 메모
- From-L1 연결은 RFC 보류 상태로 유지한다.
- Layer1 재도입 필요 시 신규 RFC 승인 후 범위를 다시 연다.
- meta slideCount 누락은 기능 실패가 아니라 PARTIAL로 분류한다(운영 스키마 개선 대상).
