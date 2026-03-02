# ADR Guide And Log

작성일: 2026-03-01  
버전: v0.1

## 1. ADR 작성 규칙
- ADR 번호: `ADR-XXX`
- 상태: `Proposed | Accepted | Deprecated | Superseded`
- 필수 항목:
  - Context
  - Decision
  - Consequences
  - Alternatives Considered

## 2. ADR 템플릿
```md
# ADR-XXX: 제목
Status: Proposed
Date: YYYY-MM-DD

## Context

## Decision

## Consequences
- Positive:
- Negative:

## Alternatives Considered
- A:
- B:
```

## 3. 초기 ADR 백로그
- ADR-001: 동기 API vs 비동기 Job 아키텍처
- ADR-002: 단일 서비스 vs Gateway + Worker 분리
- ADR-003: 파일 저장 방식(메모리/디스크/S3)
- ADR-004: 인증 전략(API Key vs JWT/OAuth2)
- ADR-005: 관측성 스택(Pino + OTel + Prometheus)
- ADR-006: 스키마 검증(zod vs ajv)

## 4. ADR Log

### ADR-001: 비동기 Job 아키텍처 도입
- Status: Accepted
- Date: 2026-03-01
- Context: 대용량 문서/LLM 지연으로 동기 요청의 타임아웃 및 사용자 대기 증가.
- Decision: `POST /jobs`로 작업 생성, `GET /jobs/{id}`로 상태 조회.
- Consequences:
  - Positive: 안정성/확장성 향상, 재시도/복구 용이.
  - Negative: 클라이언트 구현 복잡성 증가.
- Alternatives: 기존 동기 API 유지.

