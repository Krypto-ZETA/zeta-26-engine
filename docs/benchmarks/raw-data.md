# Raw Benchmark Data — Zeta-26 Engine
# Generated: 2026-06-27
# Platform: WASM release (wasm-pack --target web --release)

## TypeScript Integration Benchmarks (bun test)

| Operation | Time (µs) | Iterations | Ops/sec |
|-----------|-----------|------------|---------|
| load_config | 63.7 | 100 | 15,700 |
| calculate_route (3-hop) | 11.5 | 500 | 86,956 |
| calculate_route (direct) | 8.5 | 500 | 117,647 |
| kill+resurrect pair | 3.0 | 500 | 333,333 |
| get_node_positions (typed array) | 3.2 | 5,000 | 312,500 |
| get_node_positions_ptr (raw pointer) | 1.0 | 5,000 | 1,000,000 |
| get_active_edges (typed array) | 1.6 | 5,000 | 625,000 |
| get_active_edges_ptr (raw pointer) | 0.8 | 5,000 | 1,250,000 |
| encode+decode pair | 4.3 | 1,000 | 232,558 |
| all-pairs route (30 pairs) | 354.5 | 20 | 2,821 |

## WASM Binary

| File | Size |
|------|------|
| zeta_26_engine_bg.wasm | 116.6 KB |
| zeta_26_engine.js | 17.8 KB |
| Total | 134.4 KB |

## Test Results

| Suite | Tests | Assertions | Status |
|-------|-------|-----------|--------|
| Rust unit + stress | 65 | — | PASS |
| TypeScript unit | 29 | 500+ | PASS |
| TypeScript system | 3 | 100+ | PASS |
| TypeScript stress | 5 | 30,000+ | PASS |
| TypeScript benchmarks | 10 | 20,000+ | PASS |
| TypeScript multiverse (200p) | 31 | 1000+ | PASS |
| TypeScript health | 15 | 100+ | PASS |
| TypeScript security | 22 | 200+ | PASS |
| Total | 180 | 35,845+ | PASS |

## Speed Context

| Benchmark | Zeta-26 | Human Perception |
|-----------|---------|-----------------|
| Kill + resurrect | 3.0 µs | 0.000003 seconds |
| Direct route | 8.5 µs | 0.0000085 seconds |
| 3-hop route | 11.5 µs | 0.0000115 seconds |
| Blink of an eye | — | 300,000 µs |
| 1 frame at 60 FPS | — | 16,667 µs |
| Zeta-26 route in 1 frame budget | 1,450 routes | 16,667 / 11.5 |

**In the time it takes to render ONE frame at 60 FPS, the engine can compute 1,450 routes.**
