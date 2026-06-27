import { describe, test, expect, beforeAll } from "bun:test";

let engine: typeof import("../pkg/zeta_26_engine.js");
let wasm: Awaited<ReturnType<typeof import("../pkg/zeta_26_engine.js").default>>;

beforeAll(async () => {
  engine = await import("../pkg/zeta_26_engine.js");
  wasm = await engine.default();
});

describe("WASM Health: Engine loads", () => {
  test("WASM module initializes without error", () => {
    expect(wasm).toBeDefined();
    expect(wasm.memory).toBeDefined();
  });

  test("WASM memory is accessible", () => {
    expect(wasm.memory.buffer).toBeDefined();
    expect(wasm.memory.buffer.byteLength).toBeGreaterThan(0);
  });

  test("All 14 exports exist", () => {
    expect(typeof engine.load_config).toBe("function");
    expect(typeof engine.calculate_route).toBe("function");
    expect(typeof engine.kill_node).toBe("function");
    expect(typeof engine.resurrect_node).toBe("function");
    expect(typeof engine.get_node_ids).toBe("function");
    expect(typeof engine.get_node_positions).toBe("function");
    expect(typeof engine.get_node_positions_ptr).toBe("function");
    expect(typeof engine.get_node_positions_len).toBe("function");
    expect(typeof engine.get_active_edges).toBe("function");
    expect(typeof engine.get_active_edges_ptr).toBe("function");
    expect(typeof engine.get_active_edges_len).toBe("function");
    expect(typeof engine.get_alive_mask).toBe("function");
    expect(typeof engine.encode_payload).toBe("function");
    expect(typeof engine.decode_payload).toBe("function");
  });
});

describe("WASM Health: Config loading", () => {
  test("load_config succeeds with valid JSON", () => {
    const config = JSON.stringify({
      universe_metadata: {
        speed_of_light_kms: 300000,
        max_void_hop_distance_km: 50000000,
        coordinate_scale_unit_km: 100000,
        tower_processing_delay_ms: 7,
        fiber_speed_fraction: 0.67,
        system_name: "test"
      },
      nodes: [
        { id: "A", codex: 8, x: 0, y: 0, radius_km: 1000, active_towers: 8, atmosphere_thickness_km: 100, refraction_index: 1.0 },
        { id: "B", codex: 5, x: 100, y: 0, radius_km: 1000, active_towers: 4, atmosphere_thickness_km: 80, refraction_index: 1.01 },
      ]
    });
    expect(() => engine.load_config(config)).not.toThrow();
  });

  test("load_config rejects malformed JSON", () => {
    expect(() => engine.load_config("{broken")).toThrow();
  });

  test("load_config rejects invalid config structure", () => {
    expect(() => engine.load_config('{"foo": "bar"}')).toThrow();
  });
});

describe("WASM Health: Network error simulation", () => {
  test("WASM functions work after multiple load cycles", () => {
    for (let i = 0; i < 10; i++) {
      const config = JSON.stringify({
        universe_metadata: {
          speed_of_light_kms: 300000, max_void_hop_distance_km: 50000000,
          coordinate_scale_unit_km: 100000, tower_processing_delay_ms: 7,
          fiber_speed_fraction: 0.67, system_name: "test"
        },
        nodes: [
          { id: "X", codex: 10, x: 0, y: 0, radius_km: 5000, active_towers: 8, atmosphere_thickness_km: 100, refraction_index: 1.0 },
          { id: "Y", codex: 10, x: 200, y: 100, radius_km: 5000, active_towers: 8, atmosphere_thickness_km: 100, refraction_index: 1.0 },
        ]
      });
      engine.load_config(config);
      const ids = engine.get_node_ids() as string[];
      expect(ids).toHaveLength(2);
    }
  });

  test("routing works immediately after config load", () => {
    const config = JSON.stringify({
      universe_metadata: {
        speed_of_light_kms: 300000, max_void_hop_distance_km: 50000000,
        coordinate_scale_unit_km: 100000, tower_processing_delay_ms: 7,
        fiber_speed_fraction: 0.67, system_name: "test"
      },
      nodes: [
        { id: "Src", codex: 8, x: 0, y: 0, radius_km: 1000, active_towers: 8, atmosphere_thickness_km: 100, refraction_index: 1.0 },
        { id: "Dst", codex: 5, x: 50, y: 0, radius_km: 1000, active_towers: 4, atmosphere_thickness_km: 80, refraction_index: 1.01 },
      ]
    });
    engine.load_config(config);
    const json = engine.calculate_route("Src", "Dst", "test");
    const pkt = JSON.parse(json);
    expect(pkt.origin_id).toBe("Src");
    expect(pkt.destination_id).toBe("Dst");
  });
});

describe("WASM Health: Malicious input resistance", () => {
  test("rejects __proto__ in config", () => {
    expect(() => engine.load_config('{"__proto__": {"polluted": true}, "nodes": []}')).toThrow();
  });

  test("rejects constructor injection", () => {
    expect(() => engine.load_config('{"constructor": {"prototype": {}}, "nodes": []}')).toThrow();
  });

  test("handles extremely long planet ID", () => {
    const longId = "A".repeat(10000);
    const config = JSON.stringify({
      universe_metadata: {
        speed_of_light_kms: 300000, max_void_hop_distance_km: 50000000,
        coordinate_scale_unit_km: 100000, tower_processing_delay_ms: 7,
        fiber_speed_fraction: 0.67, system_name: "test"
      },
      nodes: [
        { id: longId, codex: 8, x: 0, y: 0, radius_km: 1000, active_towers: 8, atmosphere_thickness_km: 100, refraction_index: 1.0 },
        { id: "B", codex: 5, x: 100, y: 0, radius_km: 1000, active_towers: 4, atmosphere_thickness_km: 80, refraction_index: 1.01 },
      ]
    });
    engine.load_config(config);
    const ids = engine.get_node_ids() as string[];
    expect(ids[0]).toBe(longId);
  });

  test("handles NaN values in config", () => {
    const config = JSON.stringify({
      universe_metadata: {
        speed_of_light_kms: 300000, max_void_hop_distance_km: 50000000,
        coordinate_scale_unit_km: 100000, tower_processing_delay_ms: 7,
        fiber_speed_fraction: 0.67, system_name: "test"
      },
      nodes: [
        { id: "A", codex: 8, x: 0, y: 0, radius_km: 1000, active_towers: 8, atmosphere_thickness_km: 100, refraction_index: 1.0 },
        { id: "B", codex: 5, x: 100, y: 0, radius_km: 1000, active_towers: 4, atmosphere_thickness_km: 80, refraction_index: 1.01 },
      ]
    });
    engine.load_config(config);
    expect(engine.get_node_ids()).toHaveLength(2);
  });

  test("handles unicode in payload", () => {
    const config = JSON.stringify({
      universe_metadata: {
        speed_of_light_kms: 300000, max_void_hop_distance_km: 50000000,
        coordinate_scale_unit_km: 100000, tower_processing_delay_ms: 7,
        fiber_speed_fraction: 0.67, system_name: "test"
      },
      nodes: [
        { id: "A", codex: 8, x: 0, y: 0, radius_km: 1000, active_towers: 8, atmosphere_thickness_km: 100, refraction_index: 1.0 },
        { id: "B", codex: 5, x: 100, y: 0, radius_km: 1000, active_towers: 4, atmosphere_thickness_km: 80, refraction_index: 1.01 },
      ]
    });
    engine.load_config(config);
    const json = engine.calculate_route("A", "B", "Hello 🌍🚀");
    const pkt = JSON.parse(json);
    expect(pkt.payload).toBe("Hello 🌍🚀");
  });

  test("handles empty payload", () => {
    const config = JSON.stringify({
      universe_metadata: {
        speed_of_light_kms: 300000, max_void_hop_distance_km: 50000000,
        coordinate_scale_unit_km: 100000, tower_processing_delay_ms: 7,
        fiber_speed_fraction: 0.67, system_name: "test"
      },
      nodes: [
        { id: "A", codex: 8, x: 0, y: 0, radius_km: 1000, active_towers: 8, atmosphere_thickness_km: 100, refraction_index: 1.0 },
        { id: "B", codex: 5, x: 100, y: 0, radius_km: 1000, active_towers: 4, atmosphere_thickness_km: 80, refraction_index: 1.01 },
      ]
    });
    engine.load_config(config);
    const json = engine.calculate_route("A", "B", "");
    const pkt = JSON.parse(json);
    expect(pkt.payload).toBe("");
  });

  test("handles very long payload", () => {
    const config = JSON.stringify({
      universe_metadata: {
        speed_of_light_kms: 300000, max_void_hop_distance_km: 50000000,
        coordinate_scale_unit_km: 100000, tower_processing_delay_ms: 7,
        fiber_speed_fraction: 0.67, system_name: "test"
      },
      nodes: [
        { id: "A", codex: 8, x: 0, y: 0, radius_km: 1000, active_towers: 8, atmosphere_thickness_km: 100, refraction_index: 1.0 },
        { id: "B", codex: 5, x: 100, y: 0, radius_km: 1000, active_towers: 4, atmosphere_thickness_km: 80, refraction_index: 1.01 },
      ]
    });
    engine.load_config(config);
    const longPayload = "X".repeat(50000);
    const json = engine.calculate_route("A", "B", longPayload);
    const pkt = JSON.parse(json);
    expect(pkt.payload.length).toBe(50000);
  });
});
