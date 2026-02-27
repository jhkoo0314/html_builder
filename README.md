# html_builder

문서(PDF/DOCX/TXT) 기반으로 프레젠테이션 HTML 덱을 생성하는 프로젝트입니다.

최신 운영 기준은 `launcher + layer2-stable + layer3-advanced` 3계층 구조이며,
실제 생성 경로는 `Layer3 Direct`를 중심으로 사용합니다.

최종 업데이트: 2026-02-28

## 현재 구조
- `launcher/`: 단일 진입점 + L2/L3 라우팅/상태 확인
- `layer2-stable/`: 안정 경로
- `layer3-advanced/`: 고급 경로(Direct 2-step + Step2-A 편집)
- `src/`: 루트 서버/공용 파이프라인
- `public/`: 루트 UI
- `docs/`: 운영/메타 문서

## Layer3 핵심 동작
- Direct 파이프라인: `analyze -> render` 2-step
- 목적 모드: `general` 고정 (`table` 목적 옵션 제거)
- 스타일 모드: `normal | creative | extreme`
- 톤 모드: `auto | light | dark` (creative/extreme의 어두운 편향 보정용)
- 결과물은 기본적으로 API 응답(JSON + html + analysis)으로 반환

## 최근 반영 사항
- `toneMode` 추가
  - UI에서 `Auto/Light/Dark` 선택
  - L3 API와 프롬프트까지 전달
- Extreme 안정화
  - Extreme 전용 LLM budget/attempt timeout 분리
  - Extreme 전용 request timeout 분리(외부 timeout 선종료 방지)
  - LLM timeout 시 compact-retry(축약 입력 재시도)
- 로깅 강화
  - 라운드별(`primary`, `compact-retry`) 시도 요약
  - attempt reason/time/budget 정보 기록
- Step2-A Editor 고도화
  - Step1 결과 또는 업로드 HTML 모두 편집 가능
  - 슬라이드 선택/텍스트 수정/스타일 수정/치환/프로필 export

## 상태 판정 (L3 Direct)
- `PASS-DESIGN`: 디자인 기준 통과
- `PASS-WARN`: 생성은 성공했지만 경고 존재
  - 예: 슬라이드 수 과다(31~45)
- `FAIL-DESIGN`: 구조/품질 기준 실패
  - 예: 슬라이드 수 0~1 또는 46+

참고:
- `whyFallback`은 fallback 경로 원인 코드(`N/A` 포함)
- `status`와 `whyFallback`은 서로 다른 축(품질 판정 vs 경로 판정)

## 빠른 실행
```bash
npm install
npm run launcher:start
```

브라우저:
- Launcher: `http://127.0.0.1:5170`
- L3 UI: `http://127.0.0.1:5173`

## 주요 API
### Launcher Gateway
- `POST /api/run/l2/build` -> L2 `/api/generate-llm`
- `POST /api/run/l3/build-direct` -> L3 `/api/l3/build-direct`
- `GET /api/status`
- `GET /api/logs?service=L2|L3`
- `GET /healthz`

### L3 Direct
- Endpoint: `POST /api/l3/build-direct`
- Input: `multipart/form-data` (`documents`)
- Optional:
  - `styleMode=normal|creative|extreme`
  - `toneMode=auto|light|dark`
  - `designPrompt`
- Output:
  - `html`
  - `analysis`
  - `htmlVariants[0].meta` (status/timings/slideCount/llmAttempts 등)

## 주요 명령
```bash
# 런처
npm run launcher:start
npm run launcher:dev

# 인코딩 체크
npm run check:encoding
npm run check:encoding:staged

# 기본 검증
npm run test:smoke
npm run test:nav
npm run test:contamination
```

## 관련 문서
- 실행/운영: [docs/RUN.md](./docs/RUN.md)
- 메타 스키마: [docs/META_SCHEMA.md](./docs/META_SCHEMA.md)
- 런처 설명: [launcher/README.md](./launcher/README.md)
