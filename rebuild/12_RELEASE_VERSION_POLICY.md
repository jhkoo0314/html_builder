# Release And Version Policy

작성일: 2026-03-01

## 1. 버전 정책
- SemVer 사용: `MAJOR.MINOR.PATCH`
- 브레이킹 변경은 `MAJOR` 증가.
- 기능 추가는 `MINOR`.
- 버그 수정은 `PATCH`.

## 2. API 버전 정책
- URL 버전 명시: `/api/v1`
- 브레이킹 변경 시 `/api/v2` 제공.
- 구버전 deprecation 최소 90일.

## 3. 릴리즈 유형
- Regular release: 주간/격주.
- Hotfix release: 장애/보안 이슈 즉시.

## 4. 릴리즈 노트
- 변경 요약
- 영향 범위
- 마이그레이션 필요사항
- 롤백 방법

## 5. 승인 체계
- 최소 승인자:
  - Backend lead 1명
  - QA 1명
  - 운영 담당 1명(프로덕션 반영 시)

