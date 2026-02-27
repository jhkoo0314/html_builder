# RUM TODO (Layer1 철회 반영)

본 문서는 `docs/RUN.md` 기준 실행 계획이다.
운영 범위는 `launcher + layer2 + layer3`이며, L3는 Direct only로 진행한다.

## 1) 확정 사항 (SSOT)
- launcher 단일 진입점 유지
- Boot-time spawn 대상: `L2`, `L3`
- L3 외부 UX: 1-step(업로드 -> 고급 덱 생성)
- L3 내부 파이프라인: 2-step(`analyze -> render`)
- L3 Direct는 파일 아티팩트 비생성(in-memory 응답 중심)
- From-L1 연계: 삭제(RFC 보류)
- Layer2 동결 유지(`/healthz` 외 로직 변경 금지)

## 2) Phase별 진행 현황
### Phase 0. 기준선/계약
- [x] 포트/환경변수 기준 정리
- [x] 런처-레이어 API 매핑 정리
- [x] spawn command map 정리

### Phase 1. Launcher 프로세스 관리
- [x] 서비스 레지스트리(L2/L3) 정리
- [x] Boot-time spawn 구현
- [x] 상태 저장소(`starting/healthy/unhealthy/crashed/failed`) 반영
- [x] graceful shutdown 반영
- [x] 로그 prefix/버퍼링 반영

### Phase 2. Health polling + Auto-restart
- [x] health polling 주기/타임아웃/그레이스 반영
- [x] 실패 임계치 기반 상태 전이 반영
- [x] exit/unhealthy 트리거 재시작 반영
- [x] restart window/backoff/jitter 반영
- [x] `/api/status`, `/api/logs` 제공

### Phase 3. Gateway/Health 정비
- [x] `POST /api/run/l2/build` 프록시
- [x] `POST /api/run/l3/build-direct` 프록시
- [x] `GET /healthz` 연동 점검
- [x] 공통 오류 매핑(타임아웃/연결 실패/5xx)

### Phase 4. L3 UI
- [x] Direct 전용 웹 UI 구현
- [x] 서버 기동 후 UI/health/기본 호출 확인

### Phase 5. L3 구현 (Analyze + Render)
- [x] `POST /api/l3/build-direct` 계약 반영
- [x] analyze 단계 구현(텍스트 추출 + 최소 스키마 분석)
- [x] render 단계 구현(분석 결과 + 텍스트 기반 렌더)
- [x] 응답 메타에 `analyzeMs`, `renderMs`, `totalMs` 반영
- [x] fallback/에러 코드 정합성 유지
- [ ] postprocess/guardrails 강화(가독성/밀도/구조)

### Phase 6. 회귀 검증
- [ ] launcher 경유 L2 build E2E 검증
- [ ] launcher 경유 L3 direct E2E 검증
- [ ] 장애 시나리오(강제 종료/헬스 실패) 검증

### Phase 7. 문서/운영 정리
- [ ] runbook/known issues 동기화
- [ ] L1 관련 잔여 문구 정리 완료

## 3) 우선순위
1. Phase 6 E2E 회귀 검증
2. Phase 5 guardrails 보강
3. Phase 7 운영 문서 정리

