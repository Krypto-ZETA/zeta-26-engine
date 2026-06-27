# Optimization Strategies — Zeta-26 Relic Ring Protocol

## 0. Route Result Cache with Generation Invalidation

Cache `calculate_route(src, dst)` results in a `HashMap<(usize, usize), RouteResult>`. On each `kill_node`/`resurrect_node`, bump a global generation counter. Cache hits return the stored `RouteResult` only if the generation matches — otherwise the entry is evicted and recomputed.

```rust
thread_local! {
    static ROUTE_CACHE: RefCell<HashMap<(usize, usize), CachedRoute>> = RefCell::new(HashMap::new());
    static CACHE_GEN: RefCell<u64> = RefCell::new(0);
}

struct CachedRoute {
    generation: u64,
    result: RouteResult,
}
```

This eliminates redundant Dijkstra runs when the UI requests the same route across animation frames.

---

## 1. Optimize the Adjacency Matrix (Data-Oriented Design)

Store the graph as a contiguous flat `f64` array. Pre-compute all static line-of-sight distances and atmospheric travel times **once** during initialization.

- **Flat array**: `latencies[i * n + j]` for O(1) edge lookup with perfect cache locality.
- **Alive bitmask**: `u64` bit field instead of `Vec<bool>`. Branchless check: `(self.alive >> idx) & 1 == 1`. Atomic bit operations for kill/resurrect. Supports up to 64 nodes.
- On node kill, do **not** rebuild the graph. The bitmask exclusion in `get()` returns `INFINITY` for dead nodes, making them invisible to Dijkstra at O(1) cost.

```rust
pub struct NetworkGraph {
    n: usize,
    latencies: Vec<f64>,       // n×n, f64::INFINITY = no edge
    tp_matrix: Vec<f64>,       // [planet][entry_tower * max_towers + exit_tower]
    alive: u64,                // bitmask: bit i = 1 if node i is alive
    tower_lut: Vec<Vec<(usize, usize)>>,  // [a][b] -> (tower_a, tower_b)
}

impl NetworkGraph {
    pub fn get_tv(&self, i: usize, j: usize) -> f64 {
        if (self.alive >> i) & 1 == 0 || (self.alive >> j) & 1 == 0 {
            return f64::INFINITY;
        }
        self.latencies[i * self.n + j]
    }
    pub fn kill_node(&mut self, i: usize) { self.alive &= !(1 << i); }
    pub fn resurrect_node(&mut self, i: usize) { self.alive |= 1 << i; }
}
```

---

## 2. Pre-Compute Tp Matrix

Each planet's Tp depends only on static geometry (radius, tower count, fiber fraction, C). Pre-compute `tp_matrix` as a flat `f64` array at graph build time:

```rust
// tp_matrix[planet * (max_towers * max_towers) + entry * max_towers + exit]
// O(1) lookup at route time, no recomputation
```

---

## 3. Scratch Vec Pool for Dijkstra

`shortest_path_tree` allocates `dist` and `prev` Vecs per call. Keep them in `thread_local!` cells and resize/fill instead of reallocating:

```rust
thread_local! {
    static DIST: RefCell<Vec<f64>> = RefCell::new(Vec::new());
    static PREV: RefCell<Vec<Option<usize>>> = RefCell::new(Vec::new());
}
```

This eliminates heap churn on every route calculation.

---

## 4. Zero-Copy Ring Buffer for WASM↔JS

Pre-allocate two alternating buffers in WASM linear memory. Write fresh data to the inactive slot, toggle a pointer. JS reads via `Float64Array::view()` — zero copy, zero allocation per frame.

```rust
static POS_BUF0: Vec<f64> = Vec::new();
static POS_BUF1: Vec<f64> = Vec::new();
static ACTIVE: AtomicU8 = AtomicU8::new(0);

pub fn get_node_positions() -> Float64Array {
    let active = ACTIVE.load(Ordering::Acquire);
    unsafe { Float64Array::view(&if active == 0 { POS_BUF0 } else { POS_BUF1 }) }
}
```

Apply the same technique for edge arrays and alive masks.

---

## 5. Reuse Scratch Vecs in WASM API

`get_active_edges()`, `get_node_positions()`, and `get_alive_mask()` allocate fresh Vecs per call. Use `thread_local` pool or the ring buffer pattern to avoid allocation on the render loop hot path.

---

## 6. SIMD Batch Distance Computation

Use `#[cfg(target_feature = "simd128")]` to process 4 coordinate pairs per instruction during the initialization distance sweep:

```rust
#[cfg(target_feature = "simd128")]
fn batch_distances(...) { /* f32x4 splat, sub, mul, add, sqrt */ }

#[cfg(not(target_feature = "simd128"))]
fn batch_distances(...) { /* scalar fallback */ }
```

Not all browsers expose simd128; the fallback preserves correctness everywhere.

---

## 7. Symmetric Tower LUT Caching

`closest_tower_angle(a, b)` and `closest_tower_angle(b, a)` are currently computed independently. Store `tower_lut[j][i] = (tower_lut[i][j].1, tower_lut[i][j].0)` to halve the trig calls:

```rust
let (ta, tb) = closest_tower_angle(&nodes[i], &nodes[j]);
tower_lut[i][j] = (ta, tb);
tower_lut[j][i] = (tb, ta);  // derived, no trig needed
```

---

## 8. Dijkstra with Binary Heap (Priority Queue)

Use `BinaryHeap<Reverse<(OrderedFloat<f64>, usize)>>` for O((V+E) log V) performance. The alive bitmask skip is O(1) per pop.

```rust
pub fn dijkstra(graph: &NetworkGraph, src: usize) -> Vec<f64> {
    let n = graph.n;
    let mut dist = DIST.with(|d| { let mut d = d.borrow_mut(); d.resize(n, f64::INFINITY); d.clone() });
    let mut heap = BinaryHeap::new();
    dist[src] = 0.0;
    heap.push(Reverse((OrderedFloat(0.0), src)));
    while let Some(Reverse((cost, u))) = heap.pop() {
        if cost.0 > dist[u] { continue; }
        for v in 0..n {
            let w = graph.get_tv(u, v);
            if w.is_finite() {
                let next = dist[u] + w;
                if next < dist[v] {
                    dist[v] = next;
                    heap.push(Reverse((OrderedFloat(next), v)));
                }
            }
        }
    }
    dist
}
```

---

## 9. Bit-Shifting for Radix Translations

Stack-allocated buffer avoids heap allocations during message transit loops. Per-byte encode/decode uses fast division-remainder loops.

```rust
// Stack-allocated base conversion — no heap alloc
pub fn to_base_n(mut n: u64, base: u8, buf: &mut [u8; 64]) -> &str {
    const DIGITS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let mut pos = 64usize;
    if n == 0 { buf[63] = b'0'; return std::str::from_utf8(&buf[63..]).unwrap(); }
    while n > 0 {
        pos -= 1;
        buf[pos] = DIGITS[(n % base as u64) as usize];
        n /= base as u64;
    }
    std::str::from_utf8(&buf[pos..]).unwrap()
}
```

Bit-shift shortcuts for bases that are powers of two (8, 16) skip the division.

---

## 10. Pre-Compute Tower Pair LUT (Closest Tower Lookup Table)

For each directed planet pair (A→B), the closest-tower-pair is static. Pre-compute and cache at initialization turning O(N_a × N_b) search into O(1).

---

## 11. Shortest Arc for Tp (Ring Segment Count)

Always take the *shorter arc* around the ring (clockwise vs counter-clockwise):

```rust
pub fn shortest_arc(entry: usize, exit: usize, n: usize) -> usize {
    let cw  = (exit + n - entry) % n;
    let ccw = (entry + n - exit) % n;
    cw.min(ccw)
}
```

---

## 12. Config Validation at Parse Time

Validate all constraints during deserialization:
- `active_towers >= 4`
- `codex >= 2`
- `radius_km > 0`, `atmosphere_thickness_km >= 0`
- `refraction_index >= 1.0`

---

## 13. WASM Binary Size — Release Profile

```toml
[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
panic = "abort"
strip = true
```

---

## 14. HashMap for O(1) Node Lookup

Replace `find_node_idx` linear scan with `HashMap<String, usize>` built at graph init time.

---

## 15. Architectural Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    TYPESCRIPT UI WRAPPER                        │
│ ┌──────────────────────┐               ┌──────────────────────┐ │
│ │  Drag-and-Drop JSON  │               │ Visual Canvas Map    │ │
│ └──────────┬───────────┘               └──────────▲───────────┘ │
└────────────┼──────────────────────────────────────┼─────────────┘
             │ Pass Raw JSON String                 │ Shared Pointer
             ▼                                      │ (Zero-Copy Arrays)
┌────────────┼──────────────────────────────────────┼─────────────┐
│            ▼            RUST ENGINE (WASM)        │             │
│ ┌──────────────────────┐               ┌──────────┴───────────┐ │
│ │ Serde JSON Parser    ├──────────────►│ Adjacency Graph      │ │
│ └──────────────────────┘               └──────────▲───────────┘ │
│                                                   │             │
│ ┌──────────────────────┐               ┌──────────┴───────────┐ │
│ │ Radix Base Codex     │               │ Fast Dijkstra        │ │
│ │ Translator           │               │ (Uses Live Bitmask)  │ │
│ └──────────────────────┘               └──────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Summary Priority Table

| Optimization | Complexity | Impact | Status |
|---|---|---|---|
| Alive bitmask (`u64`) | Low | High | ✅ Implemented |
| Tp matrix pre-compute | Low | High | ✅ Implemented |
| Vec pool for Dijkstra | Low | Medium | ✅ Implemented |
| Route result cache | Low | High (reroutes) | ✅ Implemented |
| Binary heap Dijkstra | Low | Medium | ✅ Implemented |
| Tower pair LUT | Low | Medium | ✅ Implemented |
| Shortest arc for Tp | Low | Correctness | ✅ Implemented |
| HashMap node lookup | Low | Low | ✅ Implemented |
| Zero-copy raw ptr cache | Medium | High | ✅ Implemented |
| Stack-allocated radix | Medium | Medium | ✅ Implemented |
| Config validation | Low | Correctness | ✅ Implemented |
| WASM release profile | Low | High (load) | ✅ Implemented |
| Remove ordered-float | Low | Low | ✅ Implemented |
| Symmetric LUT caching | Low | Low | ❌ Skipped (6-node graph, limited benefit) |
| SIMD batch distance | Low | Low | ❌ Skipped (6-node graph, limited benefit) |
| arrayvec inline | Low | Low | ❌ Skipped (limited benefit for 6-node graph) |
