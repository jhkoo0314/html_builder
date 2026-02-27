# html_builder

문서(PDF/DOCX/TXT)에서 프레젠테이션 HTML 덱을 생성하는 프로젝트입니다.

현재 운영 기준은 `launcher + layer2-stable + layer3-advanced` 입니다.

## 현재 상태 (2026-02-28 기준)
- Layer1 경로는 사용하지 않음
- 단일 진입점: `launcher`
- L3 Direct 내부 파이프라인: `analyze -> render` 2-step
- L3 Direct 결과물은 기본적으로 파일 아티팩트를 생성하지 않고, API 응답(JSON + html + analysis)으로 반환
- L3 스타일 모드: `normal`(기본), `creative`, `extreme`
- L3 목적 모드 `table` 옵션은 제거됨 (`general` 고정)

## 빠른 실행
```bash
npm install
npm run launcher:start
```

브라우저:
- Launcher: `http://127.0.0.1:5170`
- L3 UI: `http://127.0.0.1:5173`

## 핵심 API
### Launcher Gateway
- `POST /api/run/l2/build` -> L2 `/api/generate-llm`
- `POST /api/run/l3/build-direct` -> L3 `/api/l3/build-direct`
- `GET /api/status`
- `GET /api/logs?service=L2|L3`
- `GET /healthz`

### L3 Direct
- Endpoint: `POST /api/l3/build-direct`
- Input: `multipart/form-data` (`documents`)
- Optional: `styleMode=normal|creative|extreme`, `designPrompt`
- Output: `html`, `analysis`, `htmlVariants[0].meta`

## L3 상태 판정 규칙
L3 Direct 응답의 `status`는 다음으로 분류됩니다.

- `PASS-DESIGN`
  - 기본 디자인/구조 조건 충족
  - 슬라이드 수 2~30
- `PASS-WARN`
  - 결과는 usable 하지만 경고 존재
  - 예: 슬라이드 수 31~45, nav 경고
- `FAIL-DESIGN`
  - 디자인 결과를 실패로 판정
  - 예: 슬라이드 수 0~1 또는 46 이상, 빈 HTML

참고:
- `whyFallback`은 LLM 경로 fallback 사유(`N/A` 또는 코드)를 보여줍니다.
- `status`와 `whyFallback`은 서로 다른 축(품질 판정 vs 경로 판정)입니다.

## 주요 스크립트
```bash
# 인코딩 검사
npm run check:encoding

# 기본 smoke/nav/contamination 테스트
npm run test:smoke
npm run test:nav
npm run test:contamination
```

## 디렉터리 요약
```text
launcher/          # 단일 진입점, 프로세스 관리, 게이트웨이
layer2-stable/     # 안정 경로
layer3-advanced/   # 고급 경로 (direct, analyze->render)
src/               # 루트 레거시 서버 코드
docs/              # SSOT/운영 문서
```

## 관련 문서
- 실행/운영 SSOT: [docs/RUN.md](./docs/RUN.md)
- 메타 스키마: [docs/META_SCHEMA.md](./docs/META_SCHEMA.md)
- 런처 설명: [launcher/README.md](./launcher/README.md)

