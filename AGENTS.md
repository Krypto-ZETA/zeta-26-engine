# AGENTS.md

Rust WASM engine lives in `src-rust/` — fully implemented (Phases 1–4, 63 tests, 0 clippy warnings). TypeScript WASM integration tests in `ui-wrapper/tests/` (45 tests, 0 failures). 200-planet integration test passes.

## Two-package structure

| Package | Tech | Entrypoint | Build command |
|---|---|---|---|
| `src-rust/` | Rust → WASM (wasm-pack) | `config_parser.rs`, `physics_engine.rs`, `router.rs`, `codex_translator.rs`, `network_state.rs`, `graph_builder.rs` | `wasm-pack build --target web --release` (run from `src-rust/`) |
| `ui-wrapper/` | TypeScript + HTML5 Canvas (Bun.js) | `AppOrchestrator.ts`, `UniverseCanvas.ts`, `TelemetryPanel.ts` | `bun install && bun run dev` (run from `ui-wrapper/`) |

## Build order (required)

1. `cd src-rust && wasm-pack build --target web --release`
2. `cd ../ui-wrapper && bun install && bun run dev`
3. Load `universe-config.json` via drag-and-drop at runtime (port 3000)

## Key formulas (must match exactly)

| Term | Definition | Notes |
|---|---|---|
| $L$ | Void distance (km) | Euclidean center-to-center × S, minus both planets' (R + h). Drop edges > 50M km. |
| $T_v$ | Void travel time (ms) | `((h1*n1)+(h2*n2)+L)/C * 1000` — convert s→ms |
| $T_p$ | Internal crust transit (ms) | `(2πr * s)/(N * f * C) * 1000 + m * Δt`. Dedup: if entry==exit, m=1. |
| Total | Route latency (ms) | `Σ Tp(planet) + Σ Tv(hop)` — every planet gets Tp, every gap gets Tv |

## Architectural rules (from RULES.md)

- **SRP**: one feature per file
- **Max 600 lines** per file
- **No stubs/mocks/TODOs** — every path must execute live logic
- **Rust ↔ TS only via WASM bindings** — `wasm-bindgen`, no shared state
- State mutation through explicit public methods only (`killNode()`, `calculateRoute()`)
- All config values loaded from `universe-config.json` at runtime — no hardcoding
- **Bun.js only** for the TS UI layer — no Node.js (use `bun install` / `bun run dev`)

## Critical gotchas (from system_architecture.md)

- **Tv and Tp both return seconds** — multiply both by 1000 before summing
- **radius_km is already in km** — never scale it with S
- **grid coordinates (x, y) are abstract units** — multiply by S to get km
- **Graph edges weight = Tv only** — Tp is added per-planet at route time (avoids double-counting Δt)
- **Alive bitmask** for O(1) kill/resurrect — do not rebuild the graph on node death

## Mathematical constants (also from config at runtime)

| Constant | Default |
|---|---|
| Speed of light (C) | 300,000 km/s |
| Max hop distance (Lmax) | 50,000,000 km |
| Tower delay (Δt) | 7 ms |
| Fiber fraction (f) | 0.67 |

## Packet schema

Required keys: `origin_id`, `destination_id`, `current_id`, `payload` (converting per-planet codex), `hop_log` (array).

## Implementation order (from TODO.md)

1. ~~**Phase 1** (Rust): config_parser structs → L → Tv → Tp~~ ✅
2. ~~**Phase 2** (Rust): graph edges (drop > Lmax) → Dijkstra (total latency weight) → node kill/resurrect~~ ✅
3. ~~**Phase 3** (Rust): radix conversion to/from Base-N → packet schema~~ ✅
4. ~~**Phase 4** (TS): wasm-bindgen wrappers → 45 TS integration tests (unit + system + stress + benchmarks)~~ ✅
