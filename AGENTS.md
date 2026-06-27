# AGENTS.md

Rust WASM engine lives in `src-rust/` — fully implemented (Phases 1–4, 65 Rust tests, 0 clippy warnings). TypeScript WASM integration tests in `ui-wrapper/tests/` (115 TS tests, 0 failures). 200-planet multiverse integration verified.

## Repo structure

```
.gitignore          # target/, pkg/, node_modules/
AGENTS.md           # This file — agent instructions
README.md           # Project overview
universe-config.json    # 6-planet test config (Aegis, Boreas, Dawn, Elysium, Fenix, Caelum)
multiverse-config.json  # 200-planet stress test config
src-rust/           # Rust WASM engine (7 modules)
ui-wrapper/         # TypeScript tests + frontend HTML
docs/               # Challenge docs, PDFs, benchmarks, architecture
```

## Two-package structure

| Package | Tech | Entrypoint | Build command |
|---|---|---|---|
| `src-rust/` | Rust → WASM (wasm-pack) | `config_parser.rs`, `physics_engine.rs`, `router.rs`, `codex_translator.rs`, `network_state.rs`, `graph_builder.rs` | `wasm-pack build --target web --release` (run from `src-rust/`) |
| `ui-wrapper/` | TypeScript tests + HTML5 Canvas | `tests/*.test.ts` | `bun test` (run from `ui-wrapper/`) |

## Build order (required)

1. `cd src-rust && wasm-pack build --target web --release`
2. Copy `src-rust/pkg/` → `ui-wrapper/pkg/`
3. `cd ui-wrapper && bun test`

## Test counts

| Suite | Count | Scope |
|---|---|---|
| Rust unit + stress | 65 | config_parser (9), physics_engine (10), graph_builder (11), router (15), codex_translator (12), network_state (6), diagnostics (2) |
| TS unit | 29 | load_config, get_node_ids, positions, edges, alive_mask, calculate_route, kill/resurrect, encode/decode, edge cache |
| TS system | 3 | kill→reroute→resurrect cycle, all-pairs, self-route |
| TS stress | 5 | 5000 routes, 1000 kill-resurrect, 1000 all-pairs, 5000 encode-decode, 10000 edge cache |
| TS benchmarks | 10 | load_config, calculate_route (2-hop, 3-hop), kill/resurrect, positions (typed+ptr), edges (typed+ptr), encode/decode, all-pairs |
| TS multiverse (200p) | 31 | config loading (6), edge graph (3), routing (8), kill/resurrect (5), stress (3), performance (6) |
| TS health | 15 | WASM init, config loading, network error simulation, malicious input resistance |
| TS security | 22 | file validation, config validation (prototype pollution, field constraints), payload sanitization |

## Key formulas (must match exactly)

| Term | Definition | Notes |
|---|---|---|
| $L$ | Void distance (km) | Euclidean center-to-center × S, minus both planets' (R + h). Drop edges > 50M km. |
| $T_v$ | Void travel time (ms) | `((h1*n1)+(h2*n2)+L)/C * 1000` — convert s→ms |
| $T_p$ | Internal crust transit (ms) | `(2πr * s)/(N * f * C) * 1000 + m * Δt`. Dedup: if entry==exit, m=1. |
| Total | Route latency (ms) | `Σ Tp(planet) + Σ Tv(hop)` — every planet gets Tp, every gap gets Tv |

## Architectural rules (from docs/RULES.md)

- **SRP**: one feature per file
- **Max 600 lines** per file
- **No stubs/mocks/TODOs** — every path must execute live logic
- **Rust ↔ TS only via WASM bindings** — `wasm-bindgen`, no shared state
- State mutation through explicit public methods only (`killNode()`, `calculateRoute()`)
- All config values loaded from JSON at runtime — no hardcoding

## Critical gotchas (from docs/system-architecture.md)

- **Tv and Tp both return seconds** — multiply both by 1000 before summing
- **radius_km is already in km** — never scale it with S
- **grid coordinates (x, y) are abstract units** — multiply by S to get km
- **Graph edges weight = Tv only** — Tp is added per-planet at route time (avoids double-counting Δt)
- **Alive bitmask** for O(1) kill/resurrect — do not rebuild the graph on node death

## Packet schema

Required keys: `origin_id`, `destination_id`, `current_id`, `payload` (converting per-planet codex), `hop_log` (array).

## Implementation order (from docs/TODO.md)

1. ~~**Phase 1** (Rust): config_parser structs → L → Tv → Tp~~ ✅
2. ~~**Phase 2** (Rust): graph edges (drop > Lmax) → Dijkstra (total latency weight) → node kill/resurrect~~ ✅
3. ~~**Phase 3** (Rust): radix conversion to/from Base-N → packet schema~~ ✅
4. ~~**Phase 4** (TS): wasm-bindgen wrappers → 115 TS integration tests (unit + system + stress + benchmarks + multiverse + health + security)~~ ✅
