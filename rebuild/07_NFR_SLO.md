# NFR And SLO

작성일: 2026-03-01

## 1. 성능
- API 접수(`POST /jobs`) P95 < 1.5s
- 상태 조회(`GET /jobs/{id}`) P95 < 300ms
- 결과 조회(`GET /jobs/{id}/result`) P95 < 800ms

## 2. 안정성
- 월 가용성 목표: 99.9%
- 실패율 목표: < 2%

## 3. 확장성
- 동시 작업 N건 처리 시 큐 적체율 임계치 정의.
- 워커 수평 확장 가능 구조 필수.

## 4. 보안
- OWASP API Top 10 대응.
- 무인증 접근 차단률 100%.

## 5. 비용
- 요청당 LLM 시도 횟수 상한.
- 월 예산 초과 임박 시 경보 및 자동 제한.

## 6. SLO/SLI/Alert
- SLI:
  - 성공률
  - 처리 시간
  - fallback 비율
  - LLM timeout 비율
- Alert 예시:
  - 5분 실패율 > 5%
  - 15분 timeout 비율 > 10%
  - fallback 비율 1시간 평균 > 30%

