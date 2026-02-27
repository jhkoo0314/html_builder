# AGENT.md

이 문서는 `C:\html_builder` 로컬 작업 시 참고하는 프로젝트 규칙과 현재 SSOT를 정리합니다.
최종 업데이트: 2026-02-28

## 1) 작업 원칙
- 최소 변경: 요청 범위만 수정
- 안전 우선: 파괴적 명령(`reset --hard` 등) 금지
- 검증 포함: 변경 후 최소 로딩/실행 확인
- 예기치 않은 대규모 파일 변화 감지 시 즉시 중단 후 사용자 확인

## 2) 인코딩 규칙
- 텍스트 파일은 UTF-8 (BOM 없음) 사용
- 인코딩 점검:
  - `npm run check:encoding`
  - `npm run check:encoding:staged`
- 깨짐 문자(`�`, `??`) 또는 BOM 발견 시 우선 정리 후 작업 지속

## 3) 현재 아키텍처 SSOT
- 운영 진입점: `launcher`
- 서비스 구성: `launcher + layer2-stable + layer3-advanced`
- L3 direct 내부 흐름: `analyze -> render` 2-step
- L3 direct는 기본적으로 파일 아티팩트를 쓰지 않고 응답 payload로 반환

## 4) L3 동작 정책 (현행)
- 스타일 모드:
  - `normal` (기본, 안정형)
  - `creative`
  - `extreme`
- 목적 모드:
  - `general` 고정 (`table` 옵션 제거됨)
- 상태 판정:
  - `PASS-DESIGN`
  - `PASS-WARN`
  - `FAIL-DESIGN`

## 5) 실행/검증 명령
```bash
# 런처 실행
npm run launcher:start

# 개발 모드
npm run launcher:dev

# 기본 점검
npm run test:smoke
npm run test:nav
npm run test:contamination
npm run check:encoding
```

## 6) 코드 변경 시 체크리스트
1. 요청 범위 확인 (코드 변경 vs 분석/문서)
2. 영향 파일 검색 (`rg`)
3. 최소 수정 적용
4. 모듈 로딩/핵심 경로 실행 검증
5. 변경 파일/영향/리스크를 간단히 보고

## 7) 중단(Stop) 조건
아래 중 하나라도 발생하면 즉시 중단하고 사용자 확인:
- 의도하지 않은 파일 대량 삭제/변경
- 인코딩 대규모 손상
- 기존 사용자 변경과 충돌 가능성
- 요청 범위를 넘는 정책 변경 필요

