# Test Strategy

작성일: 2026-03-01

## 1. 테스트 피라미드
- Unit: 순수 함수/유틸/파서.
- Integration: API + DB + Queue + Mock LLM.
- E2E: 파일 업로드부터 결과 조회까지.
- Contract: OpenAPI 스키마 준수.

## 2. 필수 테스트 항목
- 업로드 제한(크기/개수/형식) 거절 검증.
- 인증/인가 실패 경로 검증.
- 성공 경로(정상 문서) 검증.
- 실패 경로(빈 문서/파싱 실패/LLM timeout) 검증.
- fallback reason code 검증.

## 3. 테스트 데이터
- 소형/중형/대형 문서 샘플 세트.
- 한글/영문/혼합 문서.
- 표/목차/이미지 중심 문서.

## 4. CI 게이트
- lint/type/test 전부 통과.
- contract test 통과.
- 최소 커버리지(예: 70%) 미달 시 실패.

## 5. 릴리즈 전 체크
- [ ] staging e2e pass
- [ ] 성능 스모크 pass
- [ ] 보안 스캔 pass

