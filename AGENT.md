# AGENT.md

이 문서는 `C:\html_builder` 로컬 작업 시 준수할 프로젝트 운영 기준(SSOT)입니다.

최종 업데이트: 2026-02-28

## 1) 작업 원칙
- 최소 변경: 요청 범위를 벗어나는 구조 변경 금지
- 안전 우선: 파괴적 명령(`reset --hard` 등) 금지
- 회귀 방지: 변경 후 최소 로드/실행 검증 필수
- 이상 감지 시 중단: 예상치 못한 대규모 변경/인코딩 오염/외부 파일 오염

## 2) 인코딩 규칙
- 텍스트 파일은 UTF-8 유지
- 깨진 문자(`�`, `??`) 탐지 시 우선 정리
- 점검 명령:
  - `npm run check:encoding`
  - `npm run check:encoding:staged`

## 3) 현재 아키텍처 SSOT
- 단일 진입점: `launcher`
- 서비스 구성: `launcher + layer2-stable + layer3-advanced`
- L3 Direct 흐름: `analyze -> render` 2-step
- Step2-A Editor: 생성 결과 + 업로드 HTML 모두 편집 가능

## 4) L3 생성 규칙(최신)
- 목적 모드: `general` 고정 (`table` 목적 옵션 제거)
- 스타일 모드: `normal | creative | extreme`
- 톤 모드: `auto | light | dark`
- 상태 판정:
  - `PASS-DESIGN`
  - `PASS-WARN`
  - `FAIL-DESIGN`

## 5) 타임아웃/예산 정책
- 기본(creative/normal): 기본 request/LLM 예산 사용
- extreme: 전용 request timeout + 전용 LLM budget 사용
- timeout 시 compact-retry(축약 입력) 재시도 수행
- 로깅: round/attempt/reason/timing을 메타 및 서버 로그로 기록

## 6) Step2-A Editor 운영 포인트
- 편집 가능 입력원:
  - Step1 결과(`localStorage`)
  - 업로드 HTML 파일
- 주요 기능:
  - 텍스트 Apply/Sync
  - Style Controls (title/body)
  - Smart Replace (current/all)
  - Export Profiles (Web/PDF-A4/Executive)

## 7) 검증 체크리스트
1. 요청 범위 확인
2. 영향 파일 검색(`rg`)
3. 최소 수정 적용
4. 모듈 로드/기본 실행 검증
5. 변경 요약 + 리스크 공유

## 8) 실행 명령
```bash
# launcher
npm run launcher:start
npm run launcher:dev

# 품질/회귀
npm run test:smoke
npm run test:nav
npm run test:contamination
npm run check:encoding
```

## 9) 중단 조건
아래 중 하나라도 발생하면 즉시 중단하고 사용자 확인:
- 요청하지 않은 파일 대량 변경/삭제
- 인코딩 대량 오염
- 기존 동작과 충돌 가능성이 큰 구조 변경 필요
- sandbox/권한 문제로 핵심 검증 불가
