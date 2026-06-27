# Hackathon Constraints & Core Specifications

## 1. Physical Propagation & Environment Metrics

- **Maximum Space Hop Distance ($L_{max}$)**: A single space transmission between consecutive nodes cannot exceed $50,000,000\text{ km}$. Any edge greater than this is structurally invalid.
- **Speed of Light ($C$)**: Fixed uniformly at $300,000\text{ km/s}$.
- **Equatorial Fiber Transit Velocity**: Core data transit lines within planetary surfaces operate at $0.67 \times C$.
- **Processing Delay Penalty ($\Delta t$)**: Every communication tower processing a packet incurs an unalterable $7\text{ ms}$ delay.

## 2. Configuration & Ingestion Invariants

- **Dynamic Configuration**: The entire grid must spin up at runtime by parsing a `universe-config.json` stream.
- **No Code Hardcoding**: All global values (scaling units, physics delays) and node details (radius, coordinates, tower counts, refraction index) must be loaded from the metadata layer.

## 3. Topological Matrix & Calculation Simplifications

- **Coordinate Space Scaling**: Grid units $(x, y)$ are scaled to kilometers by multiplying by `coordinate_scale_unit_km`.
- **Planetary Radius**: Planet radius ($R$) is provided directly in kilometers — no scaling applied.
- **Straight-Line Void Distance ($L$)**:
  $$L = \sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2} \times S - (R_1 + h_1) - (R_2 + h_2)$$
- **Atmospheric Signal Depth**: Treated as passing straight through at exactly thickness $h$, ignoring diagonal angles.

## 4. Data Translation & Schema Specifications

- **Base Conversion (Codex)**: Text streams are translated into the unique base layout (the planet's `codex` integer) prior to space transmission.
- **Internal Planetary Transit**: Data moving across internal tower topologies converts to standard ASCII.
- **Packet Structure**: Every packet must have these keys:
  - `origin_id` — Source planet identifier
  - `destination_id` — Terminal destination identifier
  - `current_id` — Location tracker during execution
  - `payload` — Text stream converting per local codex
  - `hop_log` — Sequential array of traversed tower elements

## 5. System Resilience

- **Chaos Mitigation**: The app must monitor real-time node failures (e.g., user-disabled nodes) and instantly compute an alternate valid path without message loss or crashes.
