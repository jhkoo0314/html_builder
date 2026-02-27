# launcher

Single entrypoint for UI + API Gateway + Process Manager.

## Scope
- Boot-time spawn targets: `L2`, `L3`
- Health polling + restart policy are configured by `.env`
- Launcher must not import layer runtime code

## Env SSOT
- `LAUNCHER_PORT`
- `L2_PORT`, `L3_PORT`
- `ARTIFACTS_ROOT` (launcher가 L2/L3에 동일 값 주입)
- `HEALTH_CHECK_*`, `RESTART_*`

## Gateway Routes
- `POST /api/run/l2/build` -> `L2 /api/generate-llm`
- `POST /api/run/l3/build-direct` -> `L3 /api/l3/build-direct`

## Health/Status
- `GET /healthz`
- `GET /api/status`
- `GET /api/logs?service=L2|L3`

## Artifact SSOT
- L2: `{runId}/layer2/deck.html`, `meta.json`
- L3: `{runId}/layer3/analysis.json`, `deck.html`, `meta.json`
- launcher UI 결과 카드에는 `analysis.json` 링크를 디버그용으로 노출한다.
