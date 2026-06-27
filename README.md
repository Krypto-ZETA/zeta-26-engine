<p align="center">
  <h1 align="center">Zeta-26 Network Simulator</h1>
  <p align="center">
    Interplanetary routing engine · Rust → WASM · TypeScript integration
  </p>
  <p align="center">
    <a href="#-test-results"><img src="https://img.shields.io/badge/tests-108%20passing-success?style=flat-square" alt="Tests"></a>
    <a href="#-benchmarks"><img src="https://img.shields.io/badge/route%20calc-11%C2%B5s-blue?style=flat-square" alt="Route calc"></a>
    <a href="#-package-structure"><img src="https://img.shields.io/badge/Rust-63%20tests-orange?style=flat-square&logo=rust" alt="Rust tests"></a>
    <a href="#-package-structure"><img src="https://img.shields.io/badge/TypeScript-45%20tests-3178C6?style=flat-square&logo=typescript" alt="TS tests"></a>
    <a href="https://bun.sh"><img src="https://img.shields.io/badge/Bun.js-1.3-14151A?style=flat-square&logo=bun" alt="Bun"></a>
  </p>
</p>

---

Loads a topology configuration at runtime, computes optimal paths using latency-based physics, translates message payloads per-planet codex, and reroutes around destroyed nodes — all inside a compiled WebAssembly engine.

## Requirements

| # | Requirement | Implementation |
|---|---|---|
| 1 | Rust compiled to WASM | `wasm-pack build --target web --release` with LTO, `opt-level="s"`, `panic="abort"` |
| 2 | Runtime config ingestion | `load_config(json)` parses `universe-config.json` — zero hardcoded values |
| 3 | 6 modules, <600 lines each | `config_parser` · `physics_engine` · `graph_builder` · `router` · `network_state` · `codex_translator` |
| 4 | No stubs, mocks, or TODOs | Every path executes live logic, verified by 108 tests |
| 5 | Single Responsibility Principle | One feature per file |
| 6 | Rust ↔ TS via `wasm-bindgen` only | No shared state. 14 exported functions across typed arrays and raw pointers |
| 7 | Bun.js runtime | `bun test` / `bun run dev` — no Node.js |
| 8 | Mandatory packet schema | `origin_id` · `destination_id` · `current_id` · `payload` · `hop_log[]` with `planet`/`tower_entry`/`tower_exit`/`payload_state`/`tp_ms`/`tv_from_prev_ms` |
| 9 | Physical propagation model | $L$ (void distance) · $T_v$ (void travel time) · $T_p$ (crust transit) with atmospheric refraction, arc segment dedup, fiber fraction |
| 10 | Node kill/resurrect | O(1) `Vec<u64>` bitmask — `kill_node(id)` / `resurrect_node(id)` with instant rerouting |
| 11 | Per-planet codex translation | Stack-allocated radix conversion (bases 2–36), ASCII ↔ Base-N at each hop |
| 12 | Zero-copy canvas pipeline | `get_node_positions_ptr()` / `get_active_edges_ptr()` for 60 FPS rendering |
| 13 | Scalable node count | Dynamic `Vec<u64>` alive mask supports unlimited planets (tested with 200) |

## Quick Start

```bash
# Prerequisites: Rust, wasm-pack, Bun.js

# Build the WASM engine
cd src-rust && wasm-pack build --target web --release

# Copy compiled output
cp -r pkg ../ui-wrapper/

# Run all tests
cd ../ui-wrapper && bun test --timeout 120000   # 45 TypeScript tests
cd ../src-rust && cargo test                      # 63 Rust tests
cargo clippy --all-targets -- -D warnings         # 0 warnings

# Start dev server (port 3000)
cd ../ui-wrapper && bun run dev
```

## Package Structure

```
zeta-26/
├── src-rust/                        # Rust → WASM engine
│   ├── Cargo.toml
│   ├── pkg/                         # Compiled WASM output
│   └── src/
│       ├── lib.rs                   # 14 wasm-bindgen exports
│       ├── config_parser.rs         # JSON deserialization + validation
│       ├── physics_engine.rs        # L, Tv, Tp formulas
│       ├── graph_builder.rs         # Adjacency matrix, tower LUT, alive mask
│       ├── router.rs                # Dijkstra + route cache + packet schema
│       ├── network_state.rs         # Kill/resurrect via u64 bitmask
│       └── codex_translator.rs      # Radix conversion (ASCII ↔ Base-N)
├── ui-wrapper/                      # TypeScript integration layer
│   ├── pkg/                         # WASM binary + JS glue
│   └── tests/
│       └── wasm.test.ts             # 45 integration tests
├── universe-config.json             # Runtime topology (single source of truth)
├── FRONTEND_INTEGRATION.md          # TypeScript API handbook
├── equations.md                     # Mathematical formula reference
└── constraints.md                   # Hackathon specification
```

## Test Results

| Suite | Count | Status |
|---|---|---|
| Rust unit + stress | 63 | ✅ 0 clippy warnings |
| TypeScript unit | 18 | ✅ |
| TypeScript system | 3 | ✅ end-to-end routes |
| TypeScript stress | 5 | ✅ 5000 routes · 1000 kill cycles · 5000 codec roundtrips |
| TypeScript benchmarks | 10 | ✅ all operations timed |
| **Total** | **108** | **✅** |

<details>
<summary><b>WASM Public API</b> — 14 exported functions</summary>

```typescript
load_config(json: string): void;
calculate_route(origin: string, dest: string, payload: string): string;  // JSON packet
kill_node(id: string): void;
resurrect_node(id: string): void;
get_node_ids(): string[];
get_node_positions(): Float64Array;           // typed array copy
get_node_positions_ptr(): number;              // raw pointer (zero-copy)
get_node_positions_len(): number;
get_active_edges(): Uint32Array;               // typed array copy
get_active_edges_ptr(): number;                // raw pointer (zero-copy)
get_active_edges_len(): number;
get_alive_mask(): Uint8Array;                  // u64 little-endian bytes
encode_payload(payload: string, base: number): string;
decode_payload(encoded: string, base: number): string;
```
</details>

<details>
<summary><b>Benchmarks</b> — WASM release profile</summary>

| Operation | Time |
|---|---|
| Config parse | 64 µs |
| Route calculation (Aegis → Caelum, 3 hops) | 11.5 µs |
| Route calculation (Aegis → Boreas, direct) | 8.5 µs |
| Kill + resurrect pair | 3.0 µs |
| Position read (typed array) | 3.2 µs |
| Position read (raw pointer) | 1.0 µs |
| Edge read (raw pointer) | 0.8 µs |
| Encode + decode payload | 4.3 µs |
| All 30 route pairs | 355 µs |
| WASM binary size | 116.6 KB |

</details>

## Key Design Decisions

- **Edge weights = $T_v$ only** — $T_p$ added per-planet at route time to avoid double-counting $\Delta t$
- **Route cache with generation invalidation** — `cache_gen` bumped on `kill_node`/`resurrect_node`; repeated same-source-destination queries skip Dijkstra. Cache stores only path + latency; hop_log rebuilt per-call with current payload.
- **Tower 0 at 12 o'clock** — indices increase clockwise; canvas offset of $-\pi/2$
- **Packet JSON via `serde_json`** — `#[derive(Serialize)]` guarantees valid output even with special characters in payloads
- **`#[serde(skip_serializing_if = "Option::is_none")]`** — absent fields are omitted, not serialized as `null`
- **Dynamic `Vec<u64>` alive mask** — supports unlimited planets, O(1) kill/resurrect via bit manipulation
- **Deterministic engine** — same config + same graph state = same result every time. No randomness.

---

<p align="center">
  <a href="FRONTEND_INTEGRATION.md">Frontend Integration Guide</a> ·
  <a href="equations.md">Formula Reference</a> ·
  <a href="constraints.md">Competition Spec</a>
</p>
