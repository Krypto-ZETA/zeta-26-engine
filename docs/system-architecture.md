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
│       ├── lib.rs            # 14 wasm-bindgen exports + zero-copy caches
│       ├── config_parser.rs  # Serde deserialization + validation
│       ├── physics_engine.rs # L, Tv, Tp formulas + 4-component breakdown
│       ├── graph_builder.rs  # Adjacency matrix, tower LUT, Vec<u64> alive mask
│       ├── router.rs         # Dijkstra with binary heap + route cache
│       ├── network_state.rs  # Kill/resurrect via Vec<u64> bitmask
│       └── codex_translator.rs # Radix conversion ASCII ↔ Base-N
│
└── ui-wrapper/               # TypeScript + Next.js + Bun.js
    ├── app/
    │   ├── page.tsx          # Main layout
    │   ├── layout.tsx        # Root layout
    │   ├── globals.css       # Global styles
    │   └── not-found.tsx     # 404 page
    ├── components/
    │   ├── UniverseCanvas.tsx  # Offscreen-cached canvas, animated packet
    │   ├── TelemetryPanel.tsx  # 4-component latency breakdown
    │   ├── SendCard.tsx        # Origin/destination/payload selects
    │   ├── Sidebar.tsx         # Foldable sidebar
    │   ├── PlanetList.tsx      # Kill/resurrect toggles
    │   ├── TopBar.tsx          # Branding bar
    │   └── LandingPage.tsx     # Upload landing
    ├── lib/
    │   ├── engine.tsx        # Pure WASM adapter (zustand store)
    │   ├── types.ts          # Shared TypeScript interfaces
    │   └── validation.ts     # Security validation
    └── tests/                # 115 TS integration tests
```

---

## Data Flow

```
universe-config.json
        │
        │ drag-drop or file upload
        ▼
  LandingPage.tsx → validation.ts
        │
        │ wasm.load_config(jsonStr)
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
        └── Build NetworkGraph { tv_matrix, tower_lut, alive_mask: Vec<u64> }
              │
              │ store update
              ▼
        engine.tsx (zustand store)
              │
              │ rAF loop via UniverseCanvas.tsx
              ▼
        UniverseCanvas.tsx ◄── readPositionsFromWasm() → Float64Array (zero-copy)
                          ◄── readEdgesFromWasm()     → Uint32Array (zero-copy)

User picks origin + destination
        │
        │ engine.calculateRoute(srcId, dstId, payload)
        ▼
  router.rs (Dijkstra)
        │ uses tv_matrix which respects alive_mask
        ▼
  physics_engine.rs
        ├── Tp per planet (fiber arc + m*Δt) — crust_transit_components()
        └── Tv per hop (atmosphere refraction + L) — void_travel_components()
        │
        │ returns RouteResult { path[], total_latency_ms, hop_log[] }
        ▼
  codex_translator.rs
        │ encode for next hop's codex at each intermediate hop
        │ destination shows decoded literal
        ▼
  engine.tsx → zustand store
        │
        ├── UniverseCanvas.tsx  → draws highlighted path + animated packet
        └── TelemetryPanel.tsx  → 4-component breakdown + hop_log table

User clicks planet (kill)
        │
        │ engine.toggleNode(id) → wasm.kill_node(id)
        ▼
  network_state.rs → sets alive_mask bit to 0
        │
        │ automatic reroute
        ▼
  engine.tsx → recalculates route if affected
        │
        ▼
  UI re-renders with new path
```

---

## Rust Module Contracts

### `config_parser.rs`
**In**: raw JSON `&str`
**Out**: `UniverseConfig` struct
**Rules**: Fail fast with descriptive errors. Validate all physical invariants at parse time (R>0, N≥4, codex≥2, refraction≥1.0, NaN rejection). No fallback defaults — all values must come from config.

### `physics_engine.rs`
**In**: references to two `PlanetNode`s, `UniverseMetadata`, and arc data
**Out**: `f64` ms values
**Rules**: Pure functions only. No mutation. No state. Five functions: `void_distance()`, `void_travel_time_ms()`, `void_travel_components()`, `crust_transit_ms()`, `crust_transit_components()`.

### `graph_builder.rs`
**In**: `UniverseConfig` (owned)
**Out**: `NetworkGraph` (adjacency matrix + tower LUT + dynamic alive mask)
**Rules**: All edge weights are Tv only (Tp added per-planet at route time). Drop any edge where L > Lmax. Dynamic `Vec<u64>` alive mask supports unlimited nodes.

### `router.rs`
**In**: `&NetworkGraph`, `src_idx: usize`, `dst_idx: usize`
**Out**: `RouteResult` with full hop_log
**Rules**: Dijkstra with `BinaryHeap<Reverse<(TotalF64, usize)>>`. Route cache with generation invalidation. Hop_log includes 4-component latency breakdown per hop.

### `network_state.rs`
**In**: node index or id
**Out**: mutation of `NetworkGraph.alive_mask`
**Rules**: Thin wrapper. Two public methods. O(1) bitmask operations.

### `codex_translator.rs`
**In**: ASCII `&str`, codex `u8`
**Out**: encoded/decoded `String`
**Rules**: Support bases 2–36. Digits 0–9 then A–Z. Stack-allocated digit buffer.

---

## WASM Public API — 14 exported functions

```typescript
load_config(json: string): void;
calculate_route(origin: string, dest: string, payload: string): string; // JSON
kill_node(id: string): void;
resurrect_node(id: string): void;
get_node_ids(): string[];
get_node_positions(): Float64Array;       // typed array copy
get_node_positions_ptr(): number;         // raw pointer (zero-copy)
get_node_positions_len(): number;
get_active_edges(): Uint32Array;          // typed array copy
get_active_edges_ptr(): number;           // raw pointer (zero-copy)
get_active_edges_len(): number;
get_alive_mask(): Uint8Array;             // Vec<u64> LE bytes
encode_payload(payload: string, base: number): string;
decode_payload(encoded: string, base: number): string;
```

---

## Packet Schema

```json
{
  "origin_id": "Aegis",
  "destination_id": "Caelum",
  "current_id": "Caelum",
  "payload": "Hello",
  "hop_log": [
    {
      "planet": "Aegis",
      "tower_exit": 2,
      "payload_state": "200 245 300 300 303 (Base6)",
      "tp_ms": 7.0,
      "fiber_transit_ms": 0.0,
      "tower_delay_ms": 7.0
    },
    {
      "planet": "Dawn",
      "tower_entry": 4,
      "tower_exit": 1,
      "payload_state": "52 73 7A 7A 7D (Base14)",
      "tp_ms": 51.4,
      "tv_from_prev_ms": 117824.9,
      "atmospheric_refraction_ms": 0.5,
      "void_transmission_ms": 117824.4,
      "fiber_transit_ms": 23.4,
      "tower_delay_ms": 28.0
    },
    {
      "planet": "Caelum",
      "tower_entry": 11,
      "payload_state": "Hello",
      "tp_ms": 7.0,
      "tv_from_prev_ms": 111604.8,
      "atmospheric_refraction_ms": 2.3,
      "void_transmission_ms": 111602.5,
      "fiber_transit_ms": 0.0,
      "tower_delay_ms": 7.0
    }
  ]
}
```

**Encoding flow**: Origin encodes payload for next hop's codex (Base6 for Dawn). Each relay re-encodes for next hop. Destination shows decoded literal ("Hello").

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
  Aegis   <-> Boreas   18.0M km    (12 valid edges total)
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

Graph connectivity: FULLY CONNECTED ✓
```

---

## Build Order

```bash
# 1. Rust core
cd src-rust
wasm-pack build --target web --release

# 2. Copy WASM output
cp -r pkg ../ui-wrapper/

# 3. TypeScript frontend
cd ../ui-wrapper
bun install
bun run dev

# 4. Open http://localhost:3000
# Drag-drop universe-config.json onto drop zone
```
