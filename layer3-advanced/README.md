# layer3-advanced

Layer3 baseline is one-time copied from `layer2-stable@v0.1.0-stable.1` and then diverges.

- Implements advanced rendering modes
- Provides `POST /api/l3/build-direct`
- Internally executes two steps: `analyze -> render`
- Returns analysis/meta in response payload (no file artifacts by default)
