# System Architecture — Zeta-26 Relic Ring Protocol

## Overview

Two-package polyglot system. The Rust/WASM core owns all math, routing, and state. TypeScript is a pure rendering and input shell — it never computes latency, never touches graph logic, never knows about towers. The boundary is the WASM ABI.

---

## Package Structure

```
zeta-26/
├── src-rust/                  # Rust → WASM
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs            # wasm-bindgen entry point; re-exports all public API
│       ├── config_parser.rs  # Serde deserialization → internal type schemas
│       ├── physics_engine.rs # L, Tv, Tp formulas (pure functions, no state)
│       ├── graph_builder.rs  # Build adjacency matrix, filter edges > Lmax, tower LUT
│       ├── router.rs         # Dijkstra with binary heap over latency weights
│       ├── network_state.rs  # Alive bitmask, killNode(), resurrect(), query state
│       └── codex_translator.rs # Radix conversion ASCII ↔ Base-N (stack-allocated)
│
└── ui-wrapper/               # TypeScript + Bun.js
    ├── package.json
    ├── bunfig.toml
    └── src/
        ├── AppOrchestrator.ts  # Init WASM, wire lifecycle, coordinate all modules
        ├── UniverseCanvas.ts   # HTML5 Canvas render loop (nodes, edges, path, atmo)
        └── TelemetryPanel.ts   # Latency breakdown panel, hop log, payload codec display
```

---

## Data Flow

```
universe-config.json
        │
        │ drag-drop (raw string)
        ▼
  AppOrchestrator.ts
        │
        │ wasmEngine.load_config(jsonStr)
        ▼
  config_parser.rs  ──► UniverseConfig { metadata, nodes[] }
        │
        │ internal pass
        ▼
  graph_builder.rs
        ├── Scale coords (x*S, y*S)
        ├── Compute all L values → filter > Lmax (drop edges)
        ├── Pre-compute Tv for every valid edge (static, cached)
        ├── Pre-compute tower pair LUT (closest tower per directed edge)
        └── Build AdjMatrix { latencies: Vec<f64>, alive: Vec<bool> }
              │
              │ ready signal
              ▼
        AppOrchestrator.ts
              │
              │ requestAnimationFrame loop
              ▼
        UniverseCanvas.ts ◄── wasmEngine.get_node_positions() → Float64Array
                          ◄── wasmEngine.get_active_edges()   → Uint32Array
                          ◄── wasmEngine.get_current_path()   → Uint32Array

User picks origin + destination
        │
        │ wasmEngine.calculate_route(origin_id, dest_id, payload)
        ▼
  router.rs (Dijkstra)
        │ uses AdjMatrix.get(i,j) which respects alive bitmask
        ▼
  physics_engine.rs
        ├── Tp per planet (fiber arc + m*Δt)
        └── Tv per hop (atmosphere refraction + L)
        │
        │ returns RouteResult { path[], total_ms, per_hop_breakdown[], packet }
        ▼
  codex_translator.rs
        │ encode/decode payload at each hop per planet codex
        ▼
  AppOrchestrator.ts
        │ passes RouteResult to both panels
        ├── UniverseCanvas.ts  → draws highlighted path
        └── TelemetryPanel.ts  → renders ms breakdown + hop_log + payload states

User clicks planet (kill)
        │
        │ wasmEngine.kill_node(id)
        ▼
  network_state.rs → sets alive[i] = false
        │
        │ immediate reroute trigger
        ▼
  router.rs → re-runs Dijkstra (bitmask skips dead node, O(1) exclude)
        │
        ▼
  UI re-renders with new path
```

---

## Rust Module Contracts

### `config_parser.rs`
**In**: raw JSON `&str`  
**Out**: `UniverseConfig` struct  
**Rules**: Fail fast with descriptive errors. Validate all physical invariants at parse time (R>0, N≥4, codex≥2, refraction≥1.0). No fallback defaults — all values must come from config.

```rust
#[derive(Deserialize)]
pub struct UniverseConfig {
    pub universe_metadata: UniverseMetadata,
    pub nodes: Vec<PlanetNode>,
}

#[derive(Deserialize)]
pub struct UniverseMetadata {
    pub speed_of_light_kms: f64,
    pub max_void_hop_distance_km: f64,
    pub coordinate_scale_unit_km: f64,
    pub tower_processing_delay_ms: f64,
    pub fiber_speed_fraction: f64,
}

#[derive(Deserialize, Clone)]
pub struct PlanetNode {
    pub id: String,
    pub codex: u8,
    pub x: f64,
    pub y: f64,
    pub radius_km: f64,
    pub active_towers: usize,
    pub atmosphere_thickness_km: f64,
    pub refraction_index: f64,
}
```

### `physics_engine.rs`
**In**: references to two `PlanetNode`s, `UniverseMetadata`, and arc data  
**Out**: `f64` ms values  
**Rules**: Pure functions only. No mutation. No state. Three functions exactly.

```rust
/// Void distance L (km) between two planets
pub fn void_distance(a: &PlanetNode, b: &PlanetNode, s: f64) -> f64;

/// Void travel time Tv (ms)
pub fn void_travel_time_ms(a: &PlanetNode, b: &PlanetNode, l: f64, c: f64) -> f64;

/// Internal crust transit Tp (ms)
/// entry_tower, exit_tower: indices on planet's ring
pub fn crust_transit_ms(
    planet: &PlanetNode,
    entry_tower: usize,
    exit_tower: usize,
    meta: &UniverseMetadata,
) -> f64;
```

### `graph_builder.rs`
**In**: `UniverseConfig`  
**Out**: `NetworkGraph` (adjacency matrix + tower LUT)  
**Rules**: All edge weights are total Tv only (Tp added per-planet at route time, not baked into edges — avoids double-counting per the spec). Drop any edge where L > Lmax.

```rust
pub struct NetworkGraph {
    pub n: usize,
    pub node_ids: Vec<String>,
    pub node_positions_km: Vec<(f64, f64)>,    // scaled by S
    pub tv_matrix: Vec<f64>,                    // n×n, inf = no edge
    pub tower_lut: Vec<Vec<(usize, usize)>>,    // [a][b] -> (tower_a, tower_b)
    pub alive: Vec<bool>,
    pub nodes: Vec<PlanetNode>,
    pub meta: UniverseMetadata,
}
```

### `router.rs`
**In**: `&NetworkGraph`, `src_idx: usize`, `dst_idx: usize`  
**Out**: `RouteResult`  
**Rules**: Dijkstra with `BinaryHeap<Reverse<(OrderedFloat<f64>, usize)>>`. Edge weight = Tv(edge) + Tp(dst planet). Sum Tp(origin) separately at the start. Reconstruct full path via predecessor array.

```rust
pub struct RouteResult {
    pub path: Vec<usize>,           // node indices
    pub total_latency_ms: f64,
    pub hop_breakdown: Vec<HopDetail>,
}

pub struct HopDetail {
    pub planet_id: String,
    pub entry_tower: Option<usize>,
    pub exit_tower: Option<usize>,
    pub tp_ms: f64,
    pub tv_ms: Option<f64>,         // None for last planet
    pub s: usize,
    pub m: usize,
}
```

### `network_state.rs`
**In**: node index or id  
**Out**: mutation of `NetworkGraph.alive`  
**Rules**: Thin wrapper. Two public methods. No other logic.

```rust
#[wasm_bindgen]
pub fn kill_node(id: &str);
#[wasm_bindgen]
pub fn resurrect_node(id: &str);
```

### `codex_translator.rs`
**In**: ASCII `&str`, source codex `u8`, dest codex `u8`  
**Out**: encoded `String`  
**Rules**: Stack-allocated digit buffer (no heap per character). Support bases 2–36. Digits 0–9 then A–Z.

```rust
/// ASCII string → Base-N string (for void transmission)
pub fn encode_for_transmission(payload: &str, dest_codex: u8) -> String;

/// Base-N string → ASCII string (on planet arrival)
pub fn decode_from_transmission(encoded: &str, src_codex: u8) -> Option<String>;
```

---

## TypeScript Module Contracts

### `AppOrchestrator.ts`
- Owns the WASM module handle
- Handles drag-drop → calls `load_config(json)`
- Owns application state machine: `UNINITIALIZED → LOADED → ROUTING → CHAOS`
- Wires click events → `kill_node()` → triggers re-route
- Never renders directly

### `UniverseCanvas.ts`
- Receives `Float64Array` of positions and `Uint32Array` of edge/path indices from WASM
- `requestAnimationFrame` draw loop: clear → edges → path highlight → nodes → atmosphere rings → labels
- Click hit-testing against node circles → calls `AppOrchestrator.onNodeClick(id)`
- Scales WASM km coordinates to canvas pixels via viewport transform

### `TelemetryPanel.ts`
- Receives `RouteResult` JSON from AppOrchestrator
- Renders: origin→destination header, per-hop table (planet, entry/exit tower, Tp ms, Tv ms), running total, payload state at each hop (ASCII → Base-N → ASCII ...)
- Updates on every route calculation

---

## WASM Public API (wasm-bindgen surface)

```typescript
// Exposed to TypeScript
interface WasmEngine {
    load_config(json: string): void;
    calculate_route(origin_id: string, dest_id: string, payload: string): string; // JSON
    kill_node(id: string): void;
    resurrect_node(id: string): void;
    get_node_ids(): string[];             // planet IDs in order
    get_node_positions(): Float64Array;   // [x0,y0, x1,y1, ...] in km
    get_node_positions_ptr(): number;     // raw pointer for zero-copy
    get_node_positions_len(): number;     // length of position array
    get_active_edges(): Uint32Array;      // [i0,j0, i1,j1, ...] index pairs
    get_active_edges_ptr(): number;       // raw pointer for zero-copy
    get_active_edges_len(): number;       // length of edge array
    get_alive_mask(): Uint8Array;         // u64 LE bytes (8 elements)
    encode_payload(payload: string, base: number): string;
    decode_payload(encoded: string, base: number): string;
}
```

---

## Packet Schema

```json
{
  "origin_id": "Aegis",
  "destination_id": "Caelum",
  "current_id": "Dawn",
  "payload": "52 73 7A 7A 7D",
  "hop_log": [
    { "planet": "Aegis",  "tower_exit": 1, "payload_state": "H e l l o (ASCII)", "tp_ms": 38.9 },
    { "planet": "Boreas", "tower_entry": 3, "tower_exit": 0, "payload_state": "242 401 413... (Base5)", "tp_ms": 52.1, "tv_from_prev_ms": 60060.0 },
    { "planet": "Dawn",   "tower_entry": 2, "tower_exit": 4, "payload_state": "200 ... (Base6)", "tp_ms": 29.3, "tv_from_prev_ms": 68700.0 },
    { "planet": "Caelum", "tower_entry": 7, "payload_state": "52 73 7A 7A 7D (Base14)", "tp_ms": 91.2, "tv_from_prev_ms": 111600.0 }
  ]
}
```

---

## Critical Formula Reference

| Formula | Expression | Output |
|---|---|---|
| Void Distance | `√((x₂-x₁)²+(y₂-y₁)²) × S − (R₁+h₁) − (R₂+h₂)` | km |
| Void Travel Time | `((h₁×n₁)+(h₂×n₂)+L) / C × 1000` | ms |
| Crust Transit | `(2πr×s)/(N×f×C) × 1000 + m×Δt` | ms |
| Arc segments s | `min(cw, ccw)` where `cw = (exit-entry+N)%N` | count |
| Tower hits m | `s+1` normally; `1` if entry==exit (dedup) | count |
| Total latency | `Σ Tp(every planet) + Σ Tv(every void hop)` | ms |

**Critical**: Tv formula returns seconds → multiply by 1000 before adding to Tp.  
**Critical**: Tp formula: `2πr×s` divided by `(N×f×C)` is in seconds → also ×1000.  
**Critical**: Coordinates x/y are in abstract units → multiply by S to get km. radius_km is already in km — do NOT scale.

---

## Validated Network Topology (universe-config.json)

```
Valid edges (L ≤ 50M km):
  Aegis   <-> Boreas   18.0M km
  Aegis   <-> Dawn     35.3M km
  Aegis   <-> Elysium  46.1M km
  Boreas  <-> Dawn     20.6M km
  Boreas  <-> Elysium  29.1M km
  Boreas  <-> Fenix    40.3M km
  Dawn    <-> Elysium  30.4M km
  Dawn    <-> Fenix    21.2M km
  Dawn    <-> Caelum   33.5M km
  Elysium <-> Fenix    49.2M km
  Elysium <-> Caelum   38.0M km
  Fenix   <-> Caelum   33.5M km

Dropped (L > 50M km):
  Aegis   <-> Fenix    50.98M km  ✗
  Aegis   <-> Caelum   67.9M km   ✗
  Boreas  <-> Caelum   50.9M km   ✗

Graph connectivity: FULLY CONNECTED ✓ (all 6 nodes reachable from any node)
```

**Note on Caelum**: Its combined R+h = 58,732 km (massive gas giant + thick atmosphere). This significantly reduces effective L values for edges touching Caelum. Build-time edge filtering must account for this.

---

## Build Order

```bash
# 1. Rust core
cd src-rust
wasm-pack build --target web --release

# 2. TypeScript UI
cd ../ui-wrapper
bun install
bun run dev

# 3. Runtime
# Open http://localhost:3000
# Drag-drop universe-config.json onto drop zone
```

---

## Implementation Phase Checklist

### Phase 1 — Physics (Rust) — ✅ Complete
- [x] `config_parser.rs`: Structs + serde + validation
- [x] `physics_engine.rs`: `void_distance()`, `void_travel_time_ms()`, `crust_transit_ms()`
- [x] Unit tests: validate against known values (Aegis→Boreas L=18.018M km, Tv≈60060ms)

### Phase 2 — Topology & Pathfinding (Rust) — ✅ Complete
- [x] `graph_builder.rs`: Scale coords, compute all L, filter > Lmax, pre-compute Tv matrix, build tower LUT
- [x] `router.rs`: Dijkstra with binary heap, predecessor reconstruction, `RouteResult`
- [x] `network_state.rs`: `kill_node()`, `resurrect_node()` with alive bitmask

### Phase 3 — Radix Translation (Rust) — ✅ Complete
- [x] `codex_translator.rs`: `encode_for_transmission()`, `decode_from_transmission()`
- [x] Validate: 'H'(72) → Base5: "242", → Base14: "52", → Base16: "48"

### Phase 4 — WASM Bindings + TS Tests (TypeScript) — ✅ Complete
- [x] `lib.rs`: wasm-bindgen exports (13 functions) with zero-copy position/edge raw pointer caches
- [x] `ui-wrapper/tests/wasm.test.ts`: 45 integration tests (unit + system + stress + benchmarks)
- [x] `FRONTEND_INTEGRATION.md`: TypeScript API reference, zero-copy canvas loop, tower orientation, error handling
- [ ] `AppOrchestrator.ts`: WASM init, drag-drop, state machine, event wiring — pending
- [ ] `UniverseCanvas.ts`: Canvas render loop, atmosphere rings, path highlighting, click hit-test — pending
- [ ] `TelemetryPanel.ts`: Per-hop latency table, payload codec display, hop_log — pending
