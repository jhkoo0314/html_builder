# RUNBOOK.md

`v0.1.0-stable.1` 기준 장애 대응 런북.
목표: 재현 -> 원인 분류 -> 조치 완료를 10분 내 수행.

## 0) 공통 확인

1. 서버 상태 확인
```bash
curl http://localhost:3000/health
```

2. 네트워크 진단
```bash
curl http://localhost:3000/api/network-diagnostics
```

3. 메타 확인
```bash
curl -s -X POST "http://localhost:3000/api/generate-llm" \
  -F "documents=@./samples/report.txt" \
| jq '{mode, whyFallback: .htmlVariants[0].whyFallback, renderMode: .htmlVariants[0].renderMode, slideCount: .htmlVariants[0].meta.slideCount, llmAttempts: .htmlVariants[0].meta.llmAttempts, timings: .htmlVariants[0].meta.timings}'
```

## 1) 증상 / 원인 / 조치

| 증상 | 가능한 원인 | 즉시 조치 |
|---|---|---|
| `LLM_NETWORK_ERROR` (`fetch failed`, `EACCES`) | DNS/프록시/방화벽/443 차단 | `/api/network-diagnostics` 실행 -> DNS/443 확인 -> 프록시 변수 점검 |
| DNS timeout (`ETIMEDOUT`, `ENOTFOUND`) | 로컬 DNS 불안정, 공유기 DNS 문제 | DNS를 1.1.1.1/8.8.8.8로 변경 후 재시도 |
| `LLM_OVERLOADED` (503 high demand) | 공급측 일시 부하 | 30~120초 후 재시도, 실패 반복 시 시간대 변경 |
| `LLM_TIMEOUT` | 입력 과대, 예산 소진, 응답 지연 | 입력 길이 축소, 재시도, timings/attempt timeout 확인 |
| `NO_SLIDES` (`llmAttempts.ok=true`) | 생성은 성공했지만 구조 검증 실패 | `section.slide` 존재/최소 2장/repair 결과 확인 |
| 한글 깨짐(콘솔 출력만) | PowerShell 코드페이지/인코딩 불일치 | 콘솔 UTF-8 전환 후 재실행, 파일 UTF-8 점검 |

## 2) 케이스별 실행 명령

### A. LLM_NETWORK_ERROR (fetch failed/EACCES)
목적: 네트워크 계층 이상 여부 확인.

```powershell
curl http://localhost:3000/api/network-diagnostics
nslookup generativelanguage.googleapis.com
Resolve-DnsName generativelanguage.googleapis.com
Test-NetConnection generativelanguage.googleapis.com -Port 443
curl -I https://generativelanguage.googleapis.com/
```

성공 기준:
- DNS 조회 성공
- 443 연결 성공
- HTTPS 헤더 응답 수신

### B. DNS timeout
목적: DNS 문제를 빠르게 분리한다.

조치:
1. 어댑터 DNS를 `1.1.1.1`, `8.8.8.8`로 설정
2. 공유기 DNS 캐시/설정 확인
3. 재부팅 후 다시 진단

검증 명령:
```powershell
ipconfig /flushdns
nslookup generativelanguage.googleapis.com
Test-NetConnection generativelanguage.googleapis.com -Port 443
```

### C. 503 high demand
목적: 공급측 부하 상황에서 불필요한 변경 없이 회복한다.

조치:
1. 즉시 코드 변경하지 않는다.
2. 30~120초 간격으로 재시도한다.
3. 여러 건 연속 실패 시 다른 시간대 실행.

확인:
- `llmAttempts[].reasonCode == "LLM_OVERLOADED"`

### D. LLM_TIMEOUT
목적: 시간/예산 초과 원인을 분류한다.

확인 포인트:
- `timings.generateMs`
- `llmAttempts[].timeoutMs`
- `llmBudgetMs`, `llmAttemptTimeoutMs`

조치:
1. 입력 문서 길이 축소(불필요 부록 제거)
2. 동일 입력 1회 재시도
3. 네트워크 지연 병행 점검

### E. NO_SLIDES (ok=true)
목적: 생성 성공 후 구조 검증 실패를 분리한다.

확인 포인트:
- `mode=fallback-rule-based`
- `whyFallback=NO_SLIDES`
- `llmAttempts[0].ok=true` 여부
- 최종 HTML에 `section.slide` 존재 여부

조치:
1. 구조 계약 점검: 최소 2장, `section.slide` 필수
2. repair 경로 소요시간/효과 확인 (`timings.repairMs`)
3. 최근 프롬프트/후처리 스몰패치 영향 검토

### F. 한글 깨짐(콘솔만)
목적: 파일 손상 없이 콘솔 표시 문제만 분리한다.

```powershell
chcp 65001
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
Get-Content .\README.md
```

성공 기준:
- 파일은 정상 UTF-8, 콘솔 표시만 복구됨

## 3) 10분 대응 체크리스트

1. `health`와 `network-diagnostics` 확인
2. `generate-llm` 1회 호출 후 meta 추출
3. `whyFallback` 코드로 케이스 분류
4. 해당 케이스 실행 명령 수행
5. 동일 입력 재호출로 회복 확인

## 4) 에스컬레이션 기준

아래 중 하나면 운영 이슈로 승격:
- 503이 10분 이상 지속
- DNS/443 모두 정상인데 `LLM_NETWORK_ERROR` 반복
- 동일 입력에서 `NO_SLIDES`가 연속 재현
- 키/권한 문제(`LLM_AUTH_ERROR`)가 즉시 해소되지 않음
