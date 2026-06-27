import { describe, test, expect, beforeAll } from "bun:test";

interface HopLogEntry {
  planet: string;
  tower_entry?: number;
  tower_exit?: number;
  payload_state: string;
  tp_ms: number;
  fiber_transit_ms: number;
  tower_delay_ms: number;
  tv_from_prev_ms?: number;
  atmospheric_refraction_ms?: number;
  void_transmission_ms?: number;
}

interface RouteResult {
  origin_id: string;
  destination_id: string;
  current_id: string;
  payload: string;
  hop_log: HopLogEntry[];
  path: number[];
  total_latency_ms: number;
}

let engine: typeof import("../pkg/zeta_26_engine.js");
let wasm: Awaited<ReturnType<typeof import("../pkg/zeta_26_engine.js").default>>;
let configStr: string;
let configJson: any;

beforeAll(async () => {
  engine = await import("../pkg/zeta_26_engine.js");
  wasm = await engine.default();
  configStr = await Bun.file("./tests/universe-config.json").text();
  configJson = JSON.parse(configStr);
  engine.load_config(configStr);
});

describe("Universe: Config metadata", () => {
  test("loads all 6 planets", () => {
    expect(configJson.nodes).toHaveLength(6);
    const ids = engine.get_node_ids() as string[];
    expect(ids).toEqual(["Aegis", "Boreas", "Dawn", "Elysium", "Fenix", "Caelum"]);
  });

  test("metadata values match config", () => {
    const m = configJson.universe_metadata;
    expect(m.speed_of_light_kms).toBe(300000);
    expect(m.max_void_hop_distance_km).toBe(50000000);
    expect(m.coordinate_scale_unit_km).toBe(100000);
    expect(m.tower_processing_delay_ms).toBe(7);
    expect(m.fiber_speed_fraction).toBe(0.67);
  });

  test("each planet has valid codex (>=2) and active_towers (>=4)", () => {
    for (const n of configJson.nodes) {
      expect(n.codex).toBeGreaterThanOrEqual(2);
      expect(n.active_towers).toBeGreaterThanOrEqual(4);
      expect(n.radius_km).toBeGreaterThan(0);
      expect(n.refraction_index).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("Universe: Node positions scaled", () => {
  test("Aegis at (0, 0)", () => {
    const pos = engine.get_node_positions() as Float64Array;
    expect(pos[0]).toBeCloseTo(0, 0);
    expect(pos[1]).toBeCloseTo(0, 0);
    expect(pos[2]).toBeCloseTo(150 * 100000, 0);
    expect(pos[3]).toBeCloseTo(100 * 100000, 0);
  });

  test("raw pointer matches typed array", () => {
    const ptr = engine.get_node_positions_ptr();
    const len = engine.get_node_positions_len();
    expect(len).toBe(12);
    const view = new Float64Array(wasm.memory.buffer, ptr, len);
    expect(view[0]).toBeCloseTo(0, 0);
    expect(view[3]).toBeCloseTo(100 * 100000, 0);
  });
});

describe("Universe: Edge graph", () => {
  test("12 valid edges", () => {
    const edges = engine.get_active_edges() as Uint32Array;
    expect(edges.length / 2).toBe(12);
  });

  test("all dropped pairs excluded", () => {
    const edges = engine.get_active_edges() as Uint32Array;
    const pairs = new Set<string>();
    for (let i = 0; i < edges.length; i += 2) {
      const a = edges[i];
      const b = edges[i + 1];
      pairs.add(`${Math.min(a, b)}-${Math.max(a, b)}`);
    }
    const ids = engine.get_node_ids() as string[];
    const idx = (name: string) => ids.indexOf(name);
    expect(pairs.has(`${idx("Aegis")}-${idx("Fenix")}`)).toBe(false);
    expect(pairs.has(`${idx("Aegis")}-${idx("Caelum")}`)).toBe(false);
    expect(pairs.has(`${idx("Boreas")}-${idx("Caelum")}`)).toBe(false);
  });
});

describe("Universe: Alive mask", () => {
  test("all 6 bits set", () => {
    const mask = engine.get_alive_mask() as Uint8Array;
    expect(mask[0]).toBe(0x3F);
    expect(mask[1]).toBe(0);
  });

  test("changes after kill/resurrect", () => {
    engine.kill_node("Dawn");
    const dead = engine.get_alive_mask() as Uint8Array;
    expect(dead[0] & (1 << 2)).toBe(0);
    engine.resurrect_node("Dawn");
    const alive = engine.get_alive_mask() as Uint8Array;
    expect(alive[0] & (1 << 2)).toBe(4);
  });
});

describe("Universe: Route payload schema", () => {
  test("JSON includes path and total_latency_ms", () => {
    const json = engine.calculate_route("Aegis", "Boreas", "Hello");
    const pkt = JSON.parse(json) as RouteResult;
    expect(pkt).toHaveProperty("path");
    expect(Array.isArray(pkt.path)).toBe(true);
    expect(pkt).toHaveProperty("total_latency_ms");
    expect(pkt.total_latency_ms).toBeGreaterThan(0);
  });

  test("Aegis→Boreas path is [0, 1]", () => {
    const pkt = JSON.parse(engine.calculate_route("Aegis", "Boreas", "Hello")) as RouteResult;
    expect(pkt.path).toEqual([0, 1]);
  });

  test("first hop has tv_from_prev_ms undefined", () => {
    const pkt = JSON.parse(engine.calculate_route("Aegis", "Boreas", "X")) as RouteResult;
    expect(pkt.hop_log[0].tv_from_prev_ms).toBeUndefined();
  });

  test("last hop has tv_from_prev_ms defined", () => {
    const pkt = JSON.parse(engine.calculate_route("Aegis", "Boreas", "X")) as RouteResult;
    expect(pkt.hop_log[pkt.hop_log.length - 1].tv_from_prev_ms).toBeDefined();
  });
});

describe("Universe: Hop log breakdown components", () => {
  test("all hops have tp_ms, fiber_transit_ms, tower_delay_ms", () => {
    const pkt = JSON.parse(engine.calculate_route("Aegis", "Caelum", "X")) as RouteResult;
    for (const hop of pkt.hop_log) {
      expect(hop.tp_ms).toBeGreaterThanOrEqual(0);
      expect(hop.fiber_transit_ms).toBeGreaterThanOrEqual(0);
      expect(hop.tower_delay_ms).toBeGreaterThanOrEqual(0);
      expect(hop.fiber_transit_ms + hop.tower_delay_ms).toBeCloseTo(hop.tp_ms, 8);
    }
  });

  test("middle hops have atmospheric_refraction_ms and void_transmission_ms", () => {
    const pkt = JSON.parse(engine.calculate_route("Aegis", "Caelum", "X")) as RouteResult;
    for (let i = 1; i < pkt.hop_log.length; i++) {
      expect(pkt.hop_log[i].atmospheric_refraction_ms).toBeGreaterThan(0);
      expect(pkt.hop_log[i].void_transmission_ms).toBeGreaterThan(0);
    }
  });

  test("first hop has no atmospheric/void fields", () => {
    const pkt = JSON.parse(engine.calculate_route("Aegis", "Boreas", "X")) as RouteResult;
    expect(pkt.hop_log[0].atmospheric_refraction_ms).toBeUndefined();
    expect(pkt.hop_log[0].void_transmission_ms).toBeUndefined();
  });

  test("tp_ms >= tower_delay_ms (minimum 1 tower hit)", () => {
    const pkt = JSON.parse(engine.calculate_route("Aegis", "Boreas", "X")) as RouteResult;
    for (const hop of pkt.hop_log) {
      expect(hop.tp_ms).toBeGreaterThanOrEqual(hop.tower_delay_ms);
    }
  });

  test("fiber + tower sum to tp for self-route", () => {
    const pkt = JSON.parse(engine.calculate_route("Aegis", "Aegis", "X")) as RouteResult;
    const hop = pkt.hop_log[0];
    expect(hop.fiber_transit_ms + hop.tower_delay_ms).toBeCloseTo(hop.tp_ms, 8);
    expect(hop.tower_delay_ms).toBe(7.0);
    expect(hop.fiber_transit_ms).toBe(0);
  });
});

describe("Universe: Payload encoding per planet codex", () => {
  test("Aegis→Boreas hop 0 encodes in Base5", () => {
    const pkt = JSON.parse(engine.calculate_route("Aegis", "Boreas", "Hello")) as RouteResult;
    expect(pkt.hop_log[0].payload_state).toContain("Base5");
  });

  test("Aegis→Caelum first hop encodes for next planet, last encoded in Caelum's Base14", () => {
    const pkt = JSON.parse(engine.calculate_route("Aegis", "Caelum", "Hello")) as RouteResult;
    expect(pkt.hop_log[0].payload_state).toMatch(/\(Base\d+\)/);
    expect(pkt.hop_log[pkt.hop_log.length - 1].payload_state).toContain("Base14");
  });

  test("encoding roundtrip per planet codex via WASM", () => {
    for (const n of configJson.nodes) {
      const enc = engine.encode_payload("Zeta-26", n.codex);
      const dec = engine.decode_payload(enc, n.codex);
      expect(dec).toBe("Zeta-26");
    }
  });

  test("different payloads produce different hop 0 states", () => {
    const pkt1 = JSON.parse(engine.calculate_route("Aegis", "Boreas", "AAAA")) as RouteResult;
    const pkt2 = JSON.parse(engine.calculate_route("Aegis", "Boreas", "BBBB")) as RouteResult;
    expect(pkt1.hop_log[0].payload_state).not.toBe(pkt2.hop_log[0].payload_state);
  });
});

describe("Universe: Tower orientation", () => {
  test("tower indices are within planet tower count", () => {
    const ids = engine.get_node_ids() as string[];
    const pkt = JSON.parse(engine.calculate_route("Aegis", "Caelum", "X")) as RouteResult;
    for (const hop of pkt.hop_log) {
      const pi = ids.indexOf(hop.planet);
      const maxTowers = configJson.nodes[pi].active_towers;
      if (hop.tower_entry !== undefined) expect(hop.tower_entry).toBeLessThan(maxTowers);
      if (hop.tower_exit !== undefined) expect(hop.tower_exit).toBeLessThan(maxTowers);
    }
  });

  test("self-route has no tower_entry or tower_exit", () => {
    for (const planet of ["Aegis", "Boreas", "Dawn", "Elysium", "Fenix", "Caelum"]) {
      const pkt = JSON.parse(engine.calculate_route(planet, planet, "self")) as RouteResult;
      expect(pkt.hop_log[0].tower_entry).toBeUndefined();
      expect(pkt.hop_log[0].tower_exit).toBeUndefined();
    }
  });
});

describe("Universe: All-pairs routing", () => {
  test("every pair reachable", () => {
    const ids = engine.get_node_ids() as string[];
    for (const src of ids) {
      for (const dst of ids) {
        if (src === dst) continue;
        const json = engine.calculate_route(src, dst, "test");
        const pkt = JSON.parse(json) as RouteResult;
        expect(pkt.origin_id).toBe(src);
        expect(pkt.destination_id).toBe(dst);
        expect(pkt.path.length).toBeGreaterThanOrEqual(2);
        const idIdx = (name: string) => ids.indexOf(name);
        expect(pkt.path[0]).toBe(idIdx(src));
        expect(pkt.path[pkt.path.length - 1]).toBe(idIdx(dst));
      }
    }
  });

  test("all self-routes return single hop", () => {
    const ids = engine.get_node_ids() as string[];
    for (const id of ids) {
      const pkt = JSON.parse(engine.calculate_route(id, id, "self")) as RouteResult;
      expect(pkt.hop_log).toHaveLength(1);
      expect(pkt.hop_log[0].planet).toBe(id);
      expect(pkt.path).toEqual([ids.indexOf(id)]);
    }
  });

  test("multi-hop routes have higher latency than direct", () => {
    const direct = JSON.parse(engine.calculate_route("Aegis", "Boreas", "X")) as RouteResult;
    const multi = JSON.parse(engine.calculate_route("Aegis", "Caelum", "X")) as RouteResult;
    expect(multi.total_latency_ms).toBeGreaterThan(direct.total_latency_ms);
  });
});

describe("Universe: Kill → reroute → resurrect", () => {
  test("route avoids killed Boreas", () => {
    engine.kill_node("Boreas");
    const pkt = JSON.parse(engine.calculate_route("Aegis", "Caelum", "X")) as RouteResult;
    expect(pkt.hop_log.map(h => h.planet)).not.toContain("Boreas");
    engine.resurrect_node("Boreas");
  });

  test("killing then resurrecting restores original latency", () => {
    const before = JSON.parse(engine.calculate_route("Aegis", "Caelum", "X")) as RouteResult;
    engine.kill_node("Boreas");
    engine.resurrect_node("Boreas");
    const after = JSON.parse(engine.calculate_route("Aegis", "Caelum", "X")) as RouteResult;
    expect(after.total_latency_ms).toBeCloseTo(before.total_latency_ms, 6);
  });

  test("edge count drops and restores on kill/resurrect", () => {
    const before = engine.get_active_edges_len();
    engine.kill_node("Elysium");
    const killed = engine.get_active_edges_len();
    expect(killed).toBeLessThan(before);
    engine.resurrect_node("Elysium");
    const restored = engine.get_active_edges_len();
    expect(restored).toBe(before);
  });

  test("alive mask changes correctly on kill/resurrect", () => {
    const ids = engine.get_node_ids() as string[];
    const idx = (name: string) => ids.indexOf(name);
    engine.kill_node("Dawn");
    const mask1 = engine.get_alive_mask() as Uint8Array;
    expect(mask1[0] & (1 << idx("Dawn"))).toBe(0);
    engine.resurrect_node("Dawn");
    const mask2 = engine.get_alive_mask() as Uint8Array;
    expect(mask2[0] & (1 << idx("Dawn"))).not.toBe(0);
  });
});

describe("Universe: Edge cache", () => {
  test("returns Uint32Array of edges", () => {
    const edges = engine.get_active_edges() as Uint32Array;
    expect(edges).toBeInstanceOf(Uint32Array);
    expect(edges.length).toBeGreaterThan(0);
  });

  test("raw pointer matches typed array data", () => {
    const ptr = engine.get_active_edges_ptr();
    const len = engine.get_active_edges_len();
    const view = new Uint32Array(wasm.memory.buffer, ptr, len);
    expect(view.length).toBe(24);
  });
});
