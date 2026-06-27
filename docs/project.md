# Project Architecture & Structural Breakdown

## Technology Stack

- **Mathematical Core Engine**: Compiled Rust targeting WebAssembly via `wasm-pack` (source in `src-rust/`).
- **Visual UI Orchestration**: TypeScript with HTML5 Canvas API for vector space visualization (source in `ui-wrapper/`).

## Rust Engine Modules (`src-rust/src/`)

| File | Responsibility |
|---|---|
| `config_parser.rs` | Strict JSON deserialization via `serde` into internal type schemas |
| `graph_builder.rs` | Scale node spaces, assess edge weights, filter $L > L_{max}$, maintain adjacency matrix |
| `physics_engine.rs` | Compute $L$, $T_v$, $T_p$ with precise decimal float metrics |
| `router.rs` | Dijkstra shortest-path pathfinder using accumulated latency weights |
| `codex_translator.rs` | Pure-functional radix conversion between ASCII and Base-N per planet codex |
| `network_state.rs` | Volatile state manager supporting live node destruction and restoration |

## TypeScript Integration Tests (`ui-wrapper/tests/`)

| File | Responsibility |
|---|---|
| `wasm.unit.test.ts` | 32 tests: unit (each WASM export — load_config, get_node_ids, positions, edges, alive_mask, calculate_route, kill/resurrect, encode/decode, edge cache), system (kill→reroute→resurrect cycle, all-pairs, self-route) |
| `wasm.stress.test.ts` | 15 tests: stress (5000 routes, 1000 kill cycles, 1000 all-pairs, 5000 codec roundtrips, 10000 edge reads), benchmarks (load_config, calculate_route, kill/resurrect, positions, edges, encode/decode, all-pairs) |
| `wasm.multiverse.test.ts` | 31 tests: 200-planet config loading, edge graph, routing, kill/resurrect, stress, performance benchmarks |
| `wasm-health.test.ts` | 15 tests: WASM module initialization, config loading, network error simulation, malicious input resistance |
| `security.test.ts` | 22 tests: file validation, config validation (prototype pollution, field constraints), payload sanitization |

## WASM Public API (14 exports)

`load_config`, `calculate_route`, `kill_node`, `resurrect_node`, `get_node_ids`, `get_node_positions`, `get_node_positions_ptr`, `get_node_positions_len`, `get_active_edges`, `get_active_edges_ptr`, `get_active_edges_len`, `get_alive_mask`, `encode_payload`, `decode_payload`
