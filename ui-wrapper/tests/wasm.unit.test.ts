import { describe, test, expect, beforeAll } from "bun:test";

interface HopLogEntry {
  planet: string;
  tower_entry?: number;
  tower_exit?: number;
  payload_state: string;
  tp_ms: number;
  tv_from_prev_ms?: number;
}

interface RouteResult {
  origin_id: string;
  destination_id: string;
  current_id: string;
  payload: string;
  hop_log: HopLogEntry[];
}

let wasm: Awaited<ReturnType<typeof import("../pkg/zeta_26_engine.js").default>>;
let engine: typeof import("../pkg/zeta_26_engine.js");
let configStr: string;
let configJson: any;

beforeAll(async () => {
  engine = await import("../pkg/zeta_26_engine.js");
  wasm = await engine.default();
  configStr = await Bun.file("./tests/universe-config.json").text();
  configJson = JSON.parse(configStr);
});

describe("Unit: load_config", () => {
  test("loads valid config without error", () => {
    expect(() => engine.load_config(configStr)).not.toThrow();
  });

  test("throws on malformed JSON", () => {
    expect(() => engine.load_config("not json")).toThrow();
  });

  test("config has 6 nodes", () => {
    expect(configJson.nodes).toHaveLength(6);
  });
});

describe("Unit: get_node_ids", () => {
  test("returns all 6 planet IDs in order", () => {
    const ids = engine.get_node_ids() as string[];
    expect(ids).toHaveLength(6);
    expect(ids[0]).toBe("Aegis");
    expect(ids[1]).toBe("Boreas");
    expect(ids[2]).toBe("Dawn");
    expect(ids[3]).toBe("Elysium");
    expect(ids[4]).toBe("Fenix");
    expect(ids[5]).toBe("Caelum");
  });
});

describe("Unit: get_node_positions", () => {
  test("returns Float64Array with 12 elements (6*2)", () => {
    const positions = engine.get_node_positions() as Float64Array;
    expect(positions.length).toBe(12);
    expect(positions[0]).toBeCloseTo(0, 0);
    expect(positions[1]).toBeCloseTo(0, 0);
  });

  test("raw pointer returns same data", () => {
    const ptr = engine.get_node_positions_ptr();
    const len = engine.get_node_positions_len();
    expect(len).toBe(12);
    const view = new Float64Array(wasm.memory.buffer, ptr, len);
    expect(view[0]).toBeCloseTo(0, 0);
    expect(view[1]).toBeCloseTo(0, 0);
  });
});

describe("Unit: get_active_edges", () => {
  test("returns edges as Uint32Array pairs", () => {
    const edges = engine.get_active_edges() as Uint32Array;
    expect(edges.length % 2).toBe(0);
    expect(edges.length).toBeGreaterThan(0);
  });

  test("raw pointer returns same data", () => {
    const ptr = engine.get_active_edges_ptr();
    const len = engine.get_active_edges_len();
    expect(len % 2).toBe(0);
    expect(len).toBeGreaterThan(0);
    const view = new Uint32Array(wasm.memory.buffer, ptr, len);
    expect(view[0]).toBeNumber();
  });
});

describe("Unit: get_alive_mask", () => {
  test("returns Uint8Array of length 8 (u64 LE mask)", () => {
    const mask = engine.get_alive_mask() as Uint8Array;
    expect(mask.length).toBe(8);
    expect(mask[0]).toBe(0x3F);
    expect(mask[1]).toBe(0);
  });
});

describe("Unit: calculate_route", () => {
  test("returns valid JSON string for Aegis → Boreas", () => {
    const json = engine.calculate_route("Aegis", "Boreas", "Hello");
    const pkt = JSON.parse(json) as RouteResult;
    expect(pkt.origin_id).toBe("Aegis");
    expect(pkt.destination_id).toBe("Boreas");
    expect(pkt.current_id).toBe("Boreas");
    expect(pkt.payload).toBe("Hello");
    expect(pkt.hop_log.length).toBeGreaterThanOrEqual(1);
  });

  test("packet schema has all mandatory fields", () => {
    const json = engine.calculate_route("Aegis", "Caelum", "Test");
    const pkt = JSON.parse(json) as RouteResult;
    expect(pkt).toHaveProperty("origin_id");
    expect(pkt).toHaveProperty("destination_id");
    expect(pkt).toHaveProperty("current_id");
    expect(pkt).toHaveProperty("payload");
    expect(pkt).toHaveProperty("hop_log");
    expect(Array.isArray(pkt.hop_log)).toBe(true);
    for (const hop of pkt.hop_log) {
      expect(hop).toHaveProperty("planet");
      expect(hop).toHaveProperty("payload_state");
      expect(hop).toHaveProperty("tp_ms");
    }
  });

  test("first hop has tower_exit only", () => {
    const json = engine.calculate_route("Aegis", "Caelum", "Hello");
    const pkt = JSON.parse(json) as RouteResult;
    const first = pkt.hop_log[0];
    expect(first.tower_entry).toBeUndefined();
    expect(first.tower_exit).toBeDefined();
  });

  test("last hop has tower_entry only", () => {
    const json = engine.calculate_route("Aegis", "Caelum", "Hello");
    const pkt = JSON.parse(json) as RouteResult;
    const last = pkt.hop_log[pkt.hop_log.length - 1];
    expect(last.tower_entry).toBeDefined();
    expect(last.tower_exit).toBeUndefined();
  });

  test("payload encodes per-planet codex along route", () => {
    const json = engine.calculate_route("Aegis", "Boreas", "Hello");
    const pkt = JSON.parse(json) as RouteResult;
    expect(pkt.hop_log[0].payload_state).toContain("Base");
    expect(pkt.hop_log[pkt.hop_log.length - 1].payload_state).toBe("Hello");
  });

  test("first hop has no tv_from_prev_ms", () => {
    const json = engine.calculate_route("Aegis", "Boreas", "X");
    const pkt = JSON.parse(json) as RouteResult;
    expect(pkt.hop_log[0].tv_from_prev_ms).toBeUndefined();
  });

  test("middle hops have tv_from_prev_ms", () => {
    const json = engine.calculate_route("Aegis", "Caelum", "X");
    const pkt = JSON.parse(json) as RouteResult;
    for (let i = 1; i < pkt.hop_log.length; i++) {
      expect(pkt.hop_log[i].tv_from_prev_ms).toBeDefined();
      expect(pkt.hop_log[i].tv_from_prev_ms!).toBeGreaterThan(0);
    }
  });

  test("returns error for unknown origin", () => {
    expect(() => engine.calculate_route("Unknown", "Aegis", "X")).toThrow();
  });

  test("returns error for unknown destination", () => {
    expect(() => engine.calculate_route("Aegis", "Unknown", "X")).toThrow();
  });
});

describe("Unit: kill_node / resurrect_node", () => {
  test("killing a node changes alive mask", () => {
    const { get_alive_mask, kill_node, resurrect_node } = engine;
    const before = get_alive_mask() as Uint8Array;
    expect(before[0] & (1 << 1)).toBe(2);

    kill_node("Boreas");
    const during = get_alive_mask() as Uint8Array;
    expect(during[0] & (1 << 1)).toBe(0);

    resurrect_node("Boreas");
    const after = get_alive_mask() as Uint8Array;
    expect(after[0] & (1 << 1)).toBe(2);
  });

  test("routing fails when all intermediate nodes killed", () => {
    const { kill_node, resurrect_node, calculate_route } = engine;
    const allNodes = ["Aegis", "Boreas", "Dawn", "Elysium", "Fenix", "Caelum"];
    for (const n of allNodes) {
      if (n !== "Aegis" && n !== "Caelum") {
        kill_node(n);
      }
    }
    expect(() => calculate_route("Aegis", "Caelum", "X")).toThrow();
    for (const n of allNodes) {
      if (n !== "Aegis" && n !== "Caelum") {
        resurrect_node(n);
      }
    }
  });

  test("killing unknown node throws", () => {
    expect(() => engine.kill_node("NotAPlanet")).toThrow();
  });

  test("resurrecting unknown node throws", () => {
    expect(() => engine.resurrect_node("NotAPlanet")).toThrow();
  });
});

describe("Unit: encode_payload / decode_payload", () => {
  test("encode_payload returns a string", () => {
    const enc = engine.encode_payload("Hello", 5);
    expect(typeof enc).toBe("string");
    expect(enc.length).toBeGreaterThan(0);
  });

  test("decode_payload roundtrips", () => {
    const original = "Hello WASM";
    const encoded = engine.encode_payload(original, 5);
    const decoded = engine.decode_payload(encoded, 5);
    expect(decoded).toBe(original);
  });

  test("roundtrip with various bases", () => {
    const bases = [5, 8, 12, 14, 16];
    for (const base of bases) {
      const enc = engine.encode_payload("Test", base);
      const dec = engine.decode_payload(enc, base);
      expect(dec).toBe("Test");
    }
  });

  test("decode of invalid string throws error", () => {
    expect(() => engine.decode_payload("ZZZ", 5)).toThrow();
  });
});

describe("Unit: edge cache auto-refresh on kill", () => {
  test("edge count changes after killing a node", () => {
    const { get_active_edges_len, kill_node, resurrect_node } = engine;
    const before = get_active_edges_len();
    kill_node("Boreas");
    const during = get_active_edges_len();
    expect(during).toBeLessThan(before);
    resurrect_node("Boreas");
    const after = get_active_edges_len();
    expect(after).toBe(before);
  });

  test("get_active_edges returns empty array when all nodes killed", () => {
    const ids = engine.get_node_ids() as string[];
    ids.forEach((id: string) => engine.kill_node(id));
    const edges = engine.get_active_edges();
    expect(edges).toHaveLength(0);
    const len = engine.get_active_edges_len();
    expect(len).toBe(0);
    ids.forEach((id: string) => engine.resurrect_node(id));
  });

  test("get_active_edges returns Uint32Array (not throws)", () => {
    const edges = engine.get_active_edges();
    expect(edges).toBeInstanceOf(Uint32Array);
  });
});

describe("System: kill→reroute→resurrect cycle", () => {
  test("route avoids killed Boreas", () => {
    const { calculate_route, kill_node, resurrect_node, get_node_ids } = engine;

    const before = JSON.parse(calculate_route("Aegis", "Caelum", "X")) as RouteResult;
    const before_path = before.hop_log.map(h => h.planet);

    kill_node("Boreas");
    const during = JSON.parse(calculate_route("Aegis", "Caelum", "X")) as RouteResult;
    const during_path = during.hop_log.map(h => h.planet);
    expect(during_path).not.toContain("Boreas");

    resurrect_node("Boreas");
    const after = JSON.parse(calculate_route("Aegis", "Caelum", "X")) as RouteResult;
    expect(after.hop_log.length).toBeGreaterThanOrEqual(1);
  });

  test("all-pairs routing succeeds", () => {
    const { calculate_route, get_node_ids } = engine;
    const ids = get_node_ids() as string[];
    for (const src of ids) {
      for (const dst of ids) {
        if (src === dst) continue;
        const json = calculate_route(src, dst, "smoke");
        const pkt = JSON.parse(json) as RouteResult;
        expect(pkt.origin_id).toBe(src);
        expect(pkt.destination_id).toBe(dst);
        expect(pkt.hop_log.length).toBeGreaterThan(0);
      }
    }
  });

  test("same-origin-destination returns single hop", () => {
    const json = engine.calculate_route("Aegis", "Aegis", "loop");
    const pkt = JSON.parse(json) as RouteResult;
    expect(pkt.hop_log).toHaveLength(1);
    expect(pkt.hop_log[0].planet).toBe("Aegis");
  });
});
