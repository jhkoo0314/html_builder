# META_SCHEMA.md

`v0.1.0-stable.1` 기준 운영 메타(SSOT) 문서.
목적: 응답 메타만으로 성공/실패를 동일 규칙으로 판정한다.

## 1) 응답 구조(요약)

```json
{
  "mode": "llm-gemini | fallback-rule-based",
  "htmlVariants": [
    {
      "renderMode": "llm | repair | fallback",
      "whyFallback": "",
      "meta": {
        "diagnosticVersion": "obs-v1",
        "hasApiKey": true,
        "llmAttempted": true,
        "llmAttempts": [],
        "llmBudgetMs": 135000,
        "llmAttemptTimeoutMs": 120000,
        "tinySmokeEnabled": false,
        "rawLength": 0,
        "extractedLength": 0,
        "slideCount": 0,
        "timings": {
          "totalMs": 0,
          "generateMs": 0,
          "repairMs": 0
        }
      }
    }
  ]
}
```

## 2) 필수 운영 필드

| 필드 | 타입 | 의미 |
|---|---|---|
| `mode` | string | 최종 경로 (`llm-gemini` 또는 `fallback-rule-based`) |
| `htmlVariants[0].renderMode` | string | 렌더 경로 (`llm`, `repair`, `fallback`) |
| `htmlVariants[0].whyFallback` | string | fallback 원인 코드 (성공 시 빈 문자열) |
| `htmlVariants[0].meta.slideCount` | number | 최종 HTML 기준 슬라이드 수 |
| `htmlVariants[0].meta.llmAttempts[]` | array | 모델별 시도 기록 |
| `htmlVariants[0].meta.timings.*` | number | 총/생성/복구 소요시간(ms) |

## 3) `whyFallback` 코드 사전

| 코드 | 의미 | 1차 확인 포인트 |
|---|---|---|
| `NO_API_KEY` | API 키 없음 | `.env`의 `GEMINI_API_KEY` |
| `LLM_TIMEOUT` | 시간/예산 소진 | `timings`, `llmAttempts.timeoutMs` |
| `LLM_OVERLOADED` | 503 고부하 | `llmAttempts.reasonCode`, 재시도 여부 |
| `LLM_NETWORK_ERROR` | 네트워크 실패(fetch failed 등) | `/api/network-diagnostics` |
| `LLM_AUTH_ERROR` | 키/권한 오류(401/403) | 키 유효성, 프로젝트 권한 |
| `LLM_QUOTA_ERROR` | 쿼터/429 | 콘솔 쿼터, 재시도 간격 |
| `LLM_REQUEST_ERROR` | 잘못된 요청(400) | 프롬프트/페이로드 점검 |
| `LLM_MODEL_ERROR` | 모델 식별 오류(404 등) | 모델명/SDK 버전 점검 |
| `LLM_ERROR` | 분류되지 않은 일반 오류 | 최근 로그 확인 |
| `EXTRACTION_NONE` | HTML 추출 실패 | raw 응답 형식 점검 |
| `NO_SLIDES` | 구조/의미성 검증 실패 | `section.slide`, repair 결과 |

## 4) `llmAttempts[].reasonCode` 코드 사전

| 코드 | 의미 | 일반 원인 |
|---|---|---|
| `LLM_TIMEOUT` | 개별 시도 시간초과 | 응답 지연, 큰 입력 |
| `LLM_OVERLOADED` | 503 / high demand | 공급측 부하 |
| `LLM_NETWORK_ERROR` | fetch failed / 네트워크 예외 | DNS/프록시/방화벽 |
| `LLM_AUTH_ERROR` | 인증 실패 | 잘못된 키, 권한 없음 |
| `LLM_QUOTA_ERROR` | 429 / resource exhausted | 할당량 초과 |
| `LLM_REQUEST_ERROR` | 400 bad request | 잘못된 요청 본문 |
| `LLM_MODEL_ERROR` | 모델 없음/접근 불가 | 모델명/권한 |
| `LLM_ERROR` | 기타 오류 | 미분류 예외 |

## 5) 성공/실패 판정 규칙(If-Then)

1. If `mode == "llm-gemini"` and `htmlVariants[0].whyFallback == ""` and `htmlVariants[0].meta.slideCount >= 2` then `SUCCESS`.
2. If `mode == "fallback-rule-based"` then `FALLBACK`.
3. If `mode == "llm-gemini"` but `slideCount < 2` then `FAIL` (비정상 결과로 간주).
4. If `renderMode == "repair"` and `whyFallback == ""` then `SUCCESS_WITH_REPAIR`.

## 6) Stable.1 정책 값(참조)

| 항목 | 값 |
|---|---:|
| model candidates | `gemini-2.5-flash`, `gemini-3-flash-preview` |
| model timeout (2.5) | `120000ms` |
| model timeout (preview) | `15000ms` |
| total llm budget | `135000ms` |
| attempt timeout | `120000ms` |
| request timeout | `150000ms` |
| repair timeout | `40000ms` |
| min slides required | `2` |

## 7) 운영 예시

성공 예시 조건:
- `mode: llm-gemini`
- `renderMode: llm 또는 repair`
- `whyFallback: ""`
- `meta.slideCount: 2 이상`

폴백 예시 조건:
- `mode: fallback-rule-based`
- `renderMode: fallback`
- `whyFallback: NO_SLIDES | LLM_TIMEOUT | ...`
