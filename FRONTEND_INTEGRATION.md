# Zeta-26 Engine: TypeScript Integration Guide

## Quick Start

```typescript
import init, {
    load_config,
    calculate_route,
    kill_node,
    resurrect_node,
    get_node_ids,
    get_node_positions,
    get_node_positions_ptr,
    get_node_positions_len,
    get_active_edges,
    get_active_edges_ptr,
    get_active_edges_len,
    get_alive_mask,
    encode_payload,
    decode_payload
} from "./pkg/zeta_26_engine.js";

async function bootEngine() {
    await init();
    load_config(rawJsonString);
}
```

## API Reference

### `load_config(json: string): void`
Load the `universe-config.json` at runtime. Must be called before any other API.

### `calculate_route(origin_id: string, dest_id: string, payload: string): string`
Returns a JSON string. Must `JSON.parse()` the result.

**Packet schema:**
```typescript
interface RouteResult {
    origin_id: string;
    destination_id: string;
    current_id: string;
    payload: string;
    hop_log: HopLogEntry[];
}
interface HopLogEntry {
    planet: string;
    tower_entry?: number;   // omitted on first hop
    tower_exit?: number;    // omitted on last hop
    payload_state: string;  // "(ASCII)" or "(BaseN)"
    tp_ms: number;          // crust transit time (ms)
    tv_from_prev_ms?: number; // omitted on first hop
}
```

**Important:** `payload` is automatically encoded per-planet codex by the engine. Input is plain ASCII text.

### `kill_node(id: string): void`
### `resurrect_node(id: string): void`
O(1) bitmask operations. Active edges cache auto-refreshes after each call.

### `get_node_ids(): string[]`
Returns all planet IDs in order.

## Zero-Copy Canvas Rendering (60 FPS)

Use raw pointers to read Rust memory directly — no allocations:

```typescript
// Get a direct view into Rust's position buffer
const wasm = await import("./pkg/zeta_26_engine.js");

// After load_config:
const ptr = get_node_positions_ptr();
const len = get_node_positions_len();  // n * 2 (x, y pairs)
const positions = new Float64Array(wasm.memory.buffer, ptr, len);

// For edges:
const edgePtr = get_active_edges_ptr();
const edgeLen = get_active_edges_len();  // num_pairs * 2
const edges = new Uint32Array(wasm.memory.buffer, edgePtr, edgeLen);

// Loop at 60 FPS — no garbage, no allocations
function renderFrame() {
    // positions and edges are already up to date
    for (let i = 0; i < positions.length; i += 2) {
        const x = positions[i];
        const y = positions[i + 1];
        // draw planet at (x, y)
    }
    for (let i = 0; i < edges.length; i += 2) {
        const a = edges[i];
        const b = edges[i + 1];
        // draw edge between positions[a*2]..positions[a*2+1]
        // and positions[b*2]..positions[b*2+1]
    }
    requestAnimationFrame(renderFrame);
}
```

**Do not re-fetch `wasm.memory.buffer` every frame** — cache the buffer reference and only re-grab it if the WASM memory grows (you can listen for growth events).

## Error Handling

```typescript
let packet: RouteResult | null = null;
try {
    const json = calculate_route("Aegis", "Caelum", "Hello world");
    packet = JSON.parse(json);
    if (!packet.hop_log || packet.hop_log.length === 0) {
        // No route — node may be dead
    }
} catch (e) {
    // JSON parse failed or route returned error
}
```

## Tower Orientation (for Canvas Drawing)

Tower 0 is at **12 o'clock** (positive y-axis). Indices increase **clockwise**. Use this formula to place towers:

```typescript
function towerPosition(cx: number, cy: number, radius: number, index: number, totalTowers: number) {
    const angle = (Math.PI / 2) - (2 * Math.PI * index / totalTowers); // -π/2 offset
    return {
        x: cx + radius * Math.cos(angle),
        y: cy - radius * Math.sin(angle)  // canvas y-axis is inverted
    };
}
```

## Planet Order (from config)

| Index | Planet | Codex | Towers | Radius (km) | Atmosphere (km) | Refraction |
|-------|--------|-------|--------|-------------|-----------------|------------|
| 0 | Aegis | 8 | 8 | 6371 | 120 | 1.0003 |
| 1 | Boreas | 5 | 4 | 3389 | 85 | 1.0520 |
| 2 | Dawn | 6 | 6 | 1500 | 30 | 1.0110 |
| 3 | Elysium | 10 | 12 | 6051 | 250 | 1.1850 |
| 4 | Fenix | 16 | 4 | 1200 | 15 | 1.0050 |
| 5 | Caelum | 14 | 16 | 58232 | 500 | 1.3210 |

> Coordinates are in abstract units — multiply by `coordinate_scale_unit_km` (100,000) for km.

## Kill/Resurrect Flow

```typescript
// User clicks a planet → kill it
kill_node("Boreas");

// All routes automatically reroute around the dead node
const result = calculate_route("Aegis", "Caelum", "Hello");
// Result avoids Boreas entirely

// User clicks again → resurrect
resurrect_node("Boreas");
// Routes now consider Boreas again
```

A graph with 0 live nodes → empty edge set → all routes return error. Handle this in your UI.
