# Universe Routing & Latency Mathematical Reference

Exact formulas for computing void distances, travel times, and total route latency. All config values are read at runtime from `universe-config.json` — never hardcoded.

## 1. Void Distance ($L$)
The straight-line distance across the vacuum of space between two planets is calculated using their center-to-center Euclidean distance, adjusted by the universe coordinate scaling factor, minus the physical boundaries (radius and atmosphere) of both worlds.

$$L = \sqrt{(x_{2}-x_{1})^{2}+(y_{2}-y_{1})^{2}} \times S - (R_{1}+h_{1}) - (R_{2}+h_{2})$$

### Symbol Definitions:
* $x_{1}, y_{1}$: Grid coordinates of the origin planet center (from configuration).
* $x_{2}, y_{2}$: Grid coordinates of the destination planet center (from configuration).
* $S$: `coordinate_scale_unit_km` (from `universe_metadata`) — converts abstract grid units to actual kilometers.
* $R_{1} / R_{2}$: `radius_km` of the origin and destination planets, respectively.
* $h_{1} / h_{2}$: `atmosphere_thickness_km` of the origin and destination planets, respectively.

---

## 2. Void Travel Time ($T_{v}$)
The time taken for a laser signal to traverse the atmospheric layers of both planets and the void between them. The signal moves at the speed of light but is slowed down within the atmospheres by local refraction indices.

$$T_{v} = \frac{(h_{1} \times n_{1}) + (h_{2} \times n_{2}) + L}{C}$$

### Symbol Definitions:
* $h_{1} / h_{2}$: `atmosphere_thickness_km` of the origin and destination planets.
* $n_{1} / n_{2}$: `refraction_index` of the origin and destination planets (affects signal speed through the atmosphere).
* $L$: Void distance calculated from Formula 1.
* $C$: `speed_of_light_kms` (from `universe_metadata`; defaults to $300,000\text{ km/s}$).

> **Note on Unit Normalization**: Since $C$ is in kilometers per second ($\text{km/s}$), the resulting $T_{v}$ value will be in seconds. Your core engine must multiply this result by $1000$ to convert it to milliseconds ($\text{ms}$) before combining it with millisecond-based tower delays.

---

## 3. Internal Crust Transit Time ($T_{p}$)
The time taken for a packet to travel internally along a planet's subsurface fiber optic ring between its entry tower and exit tower, plus the local processing delay accumulated by every tower hit.

$$T_{p} = \frac{2\pi r \times s}{N \times f \times C} + m \times \Delta t$$

### Symbol Definitions:
* $r$: `radius_km` of the current planet.
* $N$: `active_towers` of the current planet (total routing towers distributed equally along the ring).
* $s$: Number of segments traveled along the circular ring between the entry and exit towers. 
    * *Calculation*: $\text{angular distance} \div (360^{\circ} / N)$.
    * *Special Case*: $s = 0$ if the entry tower is the exact same as the exit tower.
* $m$: Number of distinct routing towers hit on this planet that incur a processing delay charge.
    * *General Case*: $m = s + 1$.
    * *Deduplication Case*: $m = 1$ when the entry tower equals the exit tower (the packet is hit only once because the same tower handles both receiving from space and routing/transmitting).
* $f$: `fiber_speed_fraction` (from `universe_metadata`; defaults to $0.67$).
* $C$: `speed_of_light_kms` ($300,000\text{ km/s}$).
* $\Delta t$: `tower_processing_delay_ms` (from `universe_metadata`; defaults to $7\text{ ms}$).

---

## End-to-End Route Composition

To compute the **Total Latency** for an entire multi-hop path across the network, sum up the internal planetary delays for every planet visited and add the void transmission travel times for every jump between planets:

$$\text{Total Latency} = \sum_{i=1}^{k} T_{p}(P_{i}) + \sum_{i=1}^{k-1} T_{v}(P_{i}, P_{i+1})$$

### Core Composition Rules:
1.  **One $T_{p}$ Per Planet**: Every single planet visited along the route (including the initial origin planet and final destination planet) incurs exactly one $T_{p}$ calculation to handle its internal routing configurations and tower overheads.
2.  **One $T_{v}$ Per Void Hop**: Every space gap jumped between consecutive planets ($P_{i}$ to $P_{i+1}$) incurs exactly one $T_{v}$ charge.
3.  **No Double-Counting**: Tower processing delays ($\Delta t$) must **only** enter the latency equation through the $m \times \Delta t$ term inside the internal transit formula ($T_{p}$). Do not add arbitrary flat tower penalties anywhere else in the pathfinding engine.