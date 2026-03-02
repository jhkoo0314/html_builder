# Developer Onboarding

작성일: 2026-03-01

## 1. 사전 준비
- Node.js 18+
- npm
- Docker(권장)

## 2. 로컬 실행(현재 기준)
```bash
npm install
npm run launcher:start
```

## 3. 환경 변수
- `.env.example` 기반으로 `.env` 작성.
- 민감정보는 로컬에서만 사용, 커밋 금지.

## 4. 개발 워크플로우
1. 브랜치 생성
2. 구현
3. 테스트 실행
4. PR 생성
5. 리뷰/수정
6. 머지

## 5. 기본 점검 명령
```bash
npm run test:smoke
npm run test:nav
npm run test:contamination
```

## 6. 코딩 규칙
- 공통 로직은 중복 구현 금지.
- 입력 검증/에러코드 표준 준수.
- 로그에는 민감정보 금지.

## 7. 자주 발생하는 이슈
- API 키 누락 -> fallback 증가.
- 포트 충돌 -> launcher/layer 헬스 실패.
- 대용량 문서 -> timeout/메모리 이슈.

