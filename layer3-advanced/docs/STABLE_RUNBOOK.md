# L3 Advanced Runbook

Layer3 Advanced 운영 런북.
현재 SSOT는 Direct only + 내부 2-step(`analyze -> render`)이다.

## 0) 기본 점검
1. 서버 헬스
```bash
curl http://localhost:5173/healthz
```
2. launcher 경유 상태
```bash
curl http://localhost:5170/api/status
```

## 1) 실행 경로
1. `POST /api/run/l3/build-direct` 호출
2. 내부 analyze 수행 -> `analysis.json` 저장
3. 내부 render 수행 -> `deck.html` 저장
4. `meta.json`에 타이밍/오류 정보 저장

## 2) Artifacts 확인
- `{ARTIFACTS_ROOT}/{runId}/layer3/analysis.json`
- `{ARTIFACTS_ROOT}/{runId}/layer3/deck.html`
- `{ARTIFACTS_ROOT}/{runId}/layer3/meta.json`

검증 포인트:
- `analysis.json` 스키마 필수 필드 존재
- `meta.json`에 `analyzeMs`, `renderMs`, `totalMs` 존재
- render 실패 시 `analysis.json`이 보존되어야 함

## 3) 장애 분류/즉시 조치
| 증상 | 가능한 원인 | 즉시 조치 |
|---|---|---|
| `ANALYZE_FAILED` | 입력 품질 낮음, 파서 실패, 스키마 검증 실패 | 입력 축소/정상 파일로 재시도, warnings 확인 |
| `RENDER_FAILED` | 템플릿 에러, 토큰 누락, 후처리 실패 | analysis 유지 확인 후 render 재실행 |
| `UPSTREAM_TIMEOUT` | 업스트림 지연 | 타임아웃/재시도 정책 확인 후 재호출 |
| `UPSTREAM_UNREACHABLE` | 서비스 미기동/포트 충돌 | health/status로 프로세스 상태 점검 |

## 4) 캐시 재사용 검증
- 동일 `runId`에서 analyze 재실행 없이 render만 재실행 가능해야 한다.
- 재실행 후 `deck.html` 갱신, `analysis.json` 동일성, `meta.json` 타이밍 갱신 확인.

## 5) 무영향성 검증 (L2)
- L3 변경 후에도 `POST /api/run/l2/build` 정상 동작해야 한다.
- 장애 대응 중 L2 설정/로직 변경 금지.
