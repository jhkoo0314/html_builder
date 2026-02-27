# L3 Advanced Runbook

Layer3 Advanced 운영 런북.
현재 SSOT는 Direct only + 내부 2-step(`analyze -> render`)이다.

## 0) 기본 점검
1. 서버 헬스
```bash
curl http://localhost:5173/healthz
```
2. launcher 경유 상태
```bash
curl http://localhost:5170/api/status
```

## 1) 실행 경로
1. `POST /api/run/l3/build-direct` 호출
2. 내부 analyze 수행 -> `analysis.json` 저장
3. 내부 render 수행 -> `deck.html` 저장
4. `meta.json`에 타이밍/오류 정보 저장

## 2) Artifacts 확인
- `{ARTIFACTS_ROOT}/{runId}/layer3/analysis.json`
- `{ARTIFACTS_ROOT}/{runId}/layer3/deck.html`
- `{ARTIFACTS_ROOT}/{runId}/layer3/meta.json`

검증 포인트:
- `analysis.json` 스키마 필수 필드 존재
- `meta.json`에 `analyzeMs`, `renderMs`, `totalMs` 존재
- render 실패 시 `analysis.json`이 보존되어야 함

## 3) 장애 분류/즉시 조치
| 증상 | 가능한 원인 | 즉시 조치 |
|---|---|---|
| `ANALYZE_FAILED` | 입력 품질 낮음, 파서 실패, 스키마 검증 실패 | 입력 축소/정상 파일로 재시도, warnings 확인 |
| `RENDER_FAILED` | 템플릿 에러, 토큰 누락, 후처리 실패 | analysis 유지 확인 후 render 재실행 |
| `UPSTREAM_TIMEOUT` | 업스트림 지연 | 타임아웃/재시도 정책 확인 후 재호출 |
| `UPSTREAM_UNREACHABLE` | 서비스 미기동/포트 충돌 | health/status로 프로세스 상태 점검 |

## 4) 캐시 재사용 검증
- 동일 `runId`에서 analyze 재실행 없이 render만 재실행 가능해야 한다.
- 재실행 후 `deck.html` 갱신, `analysis.json` 동일성, `meta.json` 타이밍 갱신 확인.

## 5) 무영향성 검증 (L2)
- L3 변경 후에도 `POST /api/run/l2/build` 정상 동작해야 한다.
- 장애 대응 중 L2 설정/로직 변경 금지.

## 6) 판정 규칙 (PASS-FUNCTIONAL vs PASS-META)
| 판정 | 기준 |
|---|---|
| `PASS-FUNCTIONAL` | runId/analysis/deck/meta 생성 + JSON 유효 + 슬라이드 구조 유효 |
| `PASS-META` | meta 운영 필드(runId/mode/status/timings/stats/warnings)와 timings 필수 필드 존재 |
| `PARTIAL` | PASS-FUNCTIONAL 통과, PASS-META 미통과 |
| `FAIL` | 기능 산출물 누락/구조 불량/JSON 파싱 실패 |

slideCount 정책:
- `meta.stats.slideCount`는 권장 필드다.
- 누락 시 FAIL이 아니라 PARTIAL로 분류하고 `effectiveSlideCount`(deck 계산값)를 함께 보고한다.

## 7) 점검 스크립트 (PowerShell)
```powershell
$base='http://127.0.0.1:5273'
$sample='C:\html_builder\tmp_qacheck_input.txt'
Set-Content -Path $sample -Encoding utf8 -Value "# 점검`n매출 12% 증가"
$h = Invoke-RestMethod "$base/healthz"
$artifactsRoot = $h.artifactsRoot

$respPath='C:\html_builder\tmp_qacheck_resp.json'
cmd /c "curl.exe -s -X POST $base/api/l3/build-direct -F documents=@$sample > $respPath" | Out-Null
$r = Get-Content -Raw $respPath | ConvertFrom-Json
$runId = [string]$r.runId
$layer3 = Join-Path (Join-Path $artifactsRoot $runId) 'layer3'
$analysis = Join-Path $layer3 'analysis.json'
$deck = Join-Path $layer3 'deck.html'
$meta = Join-Path $layer3 'meta.json'

$missing = @()
foreach($f in @($analysis,$deck,$meta)){ if(!(Test-Path $f)){ $missing += $f } }

$analysisObj = $null; $metaObj = $null
$analysisOk = $false; $metaJsonOk = $false
try { $analysisObj = Get-Content -Raw $analysis | ConvertFrom-Json; $analysisOk = $true } catch {}
try { $metaObj = Get-Content -Raw $meta | ConvertFrom-Json; $metaJsonOk = $true } catch {}

$deckRaw = if(Test-Path $deck){ Get-Content -Raw $deck } else { '' }
$effectiveSlideCount = ([regex]::Matches($deckRaw,'<section class=\"slide')).Count
$doctypeOk = $deckRaw.ToLower().Contains('<!doctype html>')

$metaTopReq = @('runId','mode','status','timings','stats','warnings')
$missingMetaTop = @()
if($metaJsonOk){ foreach($k in $metaTopReq){ if(-not ($metaObj.PSObject.Properties.Name -contains $k)){ $missingMetaTop += $k } } }
$timingReq = @('analyzeMs','renderMs','totalMs')
$missingTiming = @()
if($metaJsonOk -and $metaObj.timings){ foreach($k in $timingReq){ if(-not ($metaObj.timings.PSObject.Properties.Name -contains $k)){ $missingTiming += $k } } } else { $missingTiming += $timingReq }
$metaSlideCount = $null
if($metaJsonOk -and $metaObj.stats -and ($metaObj.stats.PSObject.Properties.Name -contains 'slideCount')){ $metaSlideCount = $metaObj.stats.slideCount }

$passFunctional = ($h.ok -eq $true) -and ($runId -ne '') -and ($missing.Count -eq 0) -and $analysisOk -and $metaJsonOk -and ($effectiveSlideCount -ge 2) -and $doctypeOk -and ($metaObj.status -eq 'SUCCESS')
$passMeta = $passFunctional -and ($missingMetaTop.Count -eq 0) -and ($missingTiming.Count -eq 0)

$result = 'FAIL'
if($passFunctional -and $passMeta){ $result = 'PASS' }
elseif($passFunctional -and -not $passMeta){ $result = 'PARTIAL' }

[pscustomobject]@{
  result = $result
  runId = $runId
  artifactsRoot = $artifactsRoot
  effectiveSlideCount = $effectiveSlideCount
  metaSlideCount = $metaSlideCount
  missingFiles = ($missing -join ',')
  missingMetaTop = ($missingMetaTop -join ',')
  missingTiming = ($missingTiming -join ',')
  warnings = if($metaJsonOk){ ($metaObj.warnings -join ',') } else { '' }
  timings = if($metaJsonOk){ \"analyzeMs=$($metaObj.timings.analyzeMs),renderMs=$($metaObj.timings.renderMs),totalMs=$($metaObj.timings.totalMs)\" } else { '' }
}
```
