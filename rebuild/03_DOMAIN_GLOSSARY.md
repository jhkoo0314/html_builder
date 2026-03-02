# Domain Glossary

작성일: 2026-03-01

## 용어 정의
- `Document`: 사용자가 업로드한 원본 파일(PDF/DOCX/TXT).
- `Extraction`: 원본에서 텍스트를 추출하는 단계.
- `Analysis`: 문서 구조/핵심 요점/슬라이드 계획 도출 단계.
- `Render`: 분석 결과를 HTML 슬라이드로 생성하는 단계.
- `Deck`: 생성된 전체 프레젠테이션 HTML 문서.
- `Slide`: Deck 내 `section.slide` 단위 화면.
- `Fallback`: LLM 실패 시 룰 기반으로 생성하는 대체 경로.
- `Run`: 단일 처리 시도 단위(요청 기준).
- `Job`: 비동기 처리 단위(큐에 적재/실행/완료).
- `Artifact`: 생성 결과물(HTML, 메타, 분석 결과).
- `whyFallback`: fallback 전환 원인 코드.
- `Status`: 처리 상태(`queued`, `running`, `succeeded`, `failed` 등).
- `SLO`: 서비스 수준 목표.
- `DLQ`: 재시도 후 실패한 작업 저장 큐.

## 금지 용어/주의
- `성공`: 응답 200만 의미하지 않음. 결과 품질 기준 포함.
- `완료`: Job 상태 기준으로만 사용.

