# launcher

Single entrypoint for UI + API Gateway + Process Manager.

## Scope
- Boot-time spawn targets: `L2`, `L3`
- Health polling + restart policy are configured by `.env`
- Launcher must not import layer runtime code

## Env SSOT
- `LAUNCHER_PORT`
- `L2_PORT`, `L3_PORT`
- `HEALTH_CHECK_*`, `RESTART_*`

## Gateway Routes
- `POST /api/run/l2/build` -> `L2 /api/generate-llm`
- `POST /api/run/l3/build-direct` -> `L3 /api/l3/build-direct`

## Health/Status
- `GET /healthz`
- `GET /api/status`
- `GET /api/logs?service=L2|L3`

## Response SSOT
- L2/L3 모두 생성 결과는 API 응답(JSON + html)으로 확인한다.
- L3 Direct는 기본적으로 파일 아티팩트를 생성하지 않고, `analysis`는 응답 payload에 포함한다.
