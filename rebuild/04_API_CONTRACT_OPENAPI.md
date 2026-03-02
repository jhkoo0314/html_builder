# API Contract (OpenAPI) 문서

작성일: 2026-03-01  
목표 버전: `v1`

## 1. API 원칙
- 모든 API는 버전 prefix 사용: `/api/v1`
- 에러 포맷 통일:
```json
{
  "ok": false,
  "error": {
    "code": "STRING_CODE",
    "message": "Human readable message",
    "details": {}
  },
  "requestId": "uuid"
}
```

## 2. 핵심 엔드포인트
- `POST /api/v1/jobs`
  - multipart/form-data: `documents[]`, `styleMode`, `toneMode`, `designPrompt`
  - response: `202 Accepted` + `jobId`
- `GET /api/v1/jobs/{jobId}`
  - response: 상태(`queued/running/succeeded/failed`) + progress + reason
- `GET /api/v1/jobs/{jobId}/result`
  - response: `html`, `analysis`, `meta`
- `GET /api/v1/healthz`

## 3. 상태 코드 가이드
- `202`: 작업 접수
- `200`: 조회 성공
- `400`: 유효성 실패
- `401/403`: 인증/인가 실패
- `413`: 업로드 한도 초과
- `429`: 레이트리밋 초과
- `500`: 내부 오류

## 4. OpenAPI YAML 초안
```yaml
openapi: 3.1.0
info:
  title: Html Builder Rebuild API
  version: 1.0.0
servers:
  - url: https://api.example.com
paths:
  /api/v1/jobs:
    post:
      summary: Create build job
      responses:
        '202':
          description: Accepted
  /api/v1/jobs/{jobId}:
    get:
      summary: Get job status
      parameters:
        - in: path
          name: jobId
          required: true
          schema:
            type: string
      responses:
        '200':
          description: OK
```

## 5. 계약 테스트 규칙
- OpenAPI 기반 contract test 필수.
- 브레이킹 변경 시 `v2` 분기 또는 호환 레이어 제공.

