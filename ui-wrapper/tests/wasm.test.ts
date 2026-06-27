import { describe, test, expect, beforeAll } from "bun:test";

// ── Types matching WASM schema ──
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

// ─────────────────────────────────────────────
// UNIT TESTS
// ─────────────────────────────────────────────

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
    expect(positions[0]).toBeCloseTo(0, 0);      // Aegis at (0, 0) * S
    expect(positions[1]).toBeCloseTo(0, 0);
  });

  test("raw pointer returns same data", () => {
    const ptr = engine.get_node_positions_ptr();
    const len = engine.get_node_positions_len();
    expect(len).toBe(12);
    const view = new Float64Array(wasm.memory.buffer, ptr, len);
    expect(view[0]).toBeCloseTo(0, 0);           // Aegis at (0, 0)
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
    // All 6 nodes alive = lower 6 bits set = 0x3F
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
      // tower_entry absent on first hop, tower_exit absent on last
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
    expect(pkt.hop_log[0].payload_state).toContain("Base5");
    expect(pkt.hop_log[1].payload_state).toContain("(ASCII)");
  });

  test("first hop has no tv_from_prev_ms", () => {
    const json = engine.calculate_route("Aegis", "Boreas", "X");
    const pkt = JSON.parse(json) as RouteResult;
    expect(pkt.hop_log[0].tv_from_prev_ms).toBeUndefined();
  });

  test("middle hops have tv_from_prev_ms", () => {
    const json = engine.calculate_route("Aegis", "Caelum", "X");
    const pkt = JSON.parse(json) as RouteResult;
    // Aegis → ... → Caelum: multiple hops
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
    // u64 LE: bit 1 = Boreas (0x02)
    expect(before[0] & (1 << 1)).toBe(2); // Boreas is alive

    kill_node("Boreas");
    const during = get_alive_mask() as Uint8Array;
    expect(during[0] & (1 << 1)).toBe(0); // Boreas is dead

    resurrect_node("Boreas");
    const after = get_alive_mask() as Uint8Array;
    expect(after[0] & (1 << 1)).toBe(2); // Boreas is alive again
  });

  test("routing fails when all intermediate nodes killed", () => {
    const { kill_node, resurrect_node, calculate_route } = engine;
    // Kill Boreas (only path from Aegis to Caelum if Dawn is also dead...)
    // But actually with 6 nodes there are multiple paths.
    // Kill all nodes except origin and destination
    const allNodes = ["Aegis", "Boreas", "Dawn", "Elysium", "Fenix", "Caelum"];
    for (const n of allNodes) {
      if (n !== "Aegis" && n !== "Caelum") {
        kill_node(n);
      }
    }
    // Only Aegis and Caelum alive, no edge should exist
    // Actually they might not be directly connected
    expect(() => calculate_route("Aegis", "Caelum", "X")).toThrow();
    // Restore
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
});

// ─────────────────────────────────────────────
// SYSTEM / SMOKE TESTS
// ─────────────────────────────────────────────

describe("System: kill→reroute→resurrect cycle", () => {
  test("route avoids killed Boreas", () => {
    const { calculate_route, kill_node, resurrect_node, get_node_ids } = engine;

    // Baseline: route through Boreas (direct edge Aegis-Boreas)
    const before = JSON.parse(calculate_route("Aegis", "Caelum", "X")) as RouteResult;
    const before_path = before.hop_log.map(h => h.planet);

    // Kill Boreas
    kill_node("Boreas");
    const during = JSON.parse(calculate_route("Aegis", "Caelum", "X")) as RouteResult;
    const during_path = during.hop_log.map(h => h.planet);
    expect(during_path).not.toContain("Boreas");

    // Resurrect
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

// ─────────────────────────────────────────────
// STRESS TESTS
// ─────────────────────────────────────────────

describe("Stress: routing", () => {
  test("5000 route calculations", () => {
    const { calculate_route, get_node_ids } = engine;
    const ids = get_node_ids() as string[];
    for (let iter = 0; iter < 5000; iter++) {
      const src = ids[iter % ids.length];
      const dst = ids[(iter + 1) % ids.length];
      const json = calculate_route(src, dst, `stress-${iter}`);
      const pkt = JSON.parse(json) as RouteResult;
      expect(pkt.origin_id).toBe(src);
      expect(pkt.hop_log.length).toBeGreaterThan(0);
    }
  });

  test("1000 kill-resurrect cycles", () => {
    const { kill_node, resurrect_node, get_node_ids, calculate_route } = engine;
    const ids = get_node_ids() as string[];
    for (let i = 0; i < 1000; i++) {
      const target = ids[i % ids.length];
      if (target === "Aegis" || target === "Caelum") continue;
      kill_node(target);
      resurrect_node(target);
      // Verify routing still works
      const json = calculate_route("Aegis", "Caelum", "stress");
      const pkt = JSON.parse(json) as RouteResult;
      expect(pkt.hop_log.length).toBeGreaterThan(0);
    }
  });

  test("1000 all-pairs routes", () => {
    const { calculate_route, get_node_ids } = engine;
    const ids = get_node_ids() as string[];
    for (let iter = 0; iter < 1000; iter++) {
      for (const src of ids) {
        for (const dst of ids) {
          if (src === dst) continue;
          const json = calculate_route(src, dst, `ap-${iter}`);
          JSON.parse(json) as RouteResult; // just parse, no validation
        }
      }
    }
  });

  test("5000 encode-decode roundtrips", () => {
    const { encode_payload, decode_payload } = engine;
    for (let i = 0; i < 5000; i++) {
      const payload = `msg-${i}`;
      const encoded = encode_payload(payload, 5);
      const decoded = decode_payload(encoded, 5);
      expect(decoded).toBe(payload);
    }
  });

  test("10000 edge cache reads", () => {
    const { get_active_edges_len, get_active_edges_ptr } = engine;
    for (let i = 0; i < 10000; i++) {
      const len = get_active_edges_len();
      const ptr = get_active_edges_ptr();
      expect(len % 2).toBe(0);
      expect(ptr).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────
// BENCHMARKS
// ─────────────────────────────────────────────

const BENCH_SAMPLES = 100;

function bench(name: string, fn: () => void, iterations = BENCH_SAMPLES) {
  // Warmup
  for (let i = 0; i < 10; i++) fn();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;
  const perOp = (elapsed / iterations) * 1000; // microseconds
  console.log(`  ${name}: ${perOp.toFixed(1)} µs/op (${iterations} iterations)`);
  return perOp;
}

describe("Benchmarks", () => {

  test("load_config", () => {
    const cfg = Bun.file("./tests/universe-config.json");
    // Re-load each time with fresh config string
    const us = bench("load_config", () => {
      engine.load_config(configStr);
    }, 100);
    expect(us).toBeLessThan(10000); // should be <10ms
  });

  test("calculate_route (Aegis→Caelum)", () => {
    const us = bench("calculate_route", () => {
      engine.calculate_route("Aegis", "Caelum", "bench");
    }, 500);
    expect(us).toBeLessThan(100); // should be <<100µs
  });

  test("calculate_route (Aegis→Boreas direct)", () => {
    const us = bench("calculate_route direct", () => {
      engine.calculate_route("Aegis", "Boreas", "bench");
    }, 500);
    expect(us).toBeLessThan(100);
  });

  test("kill_node + resurrect_node", () => {
    const us = bench("kill+resurrect pair", () => {
      engine.kill_node("Boreas");
      engine.resurrect_node("Boreas");
    }, 500);
    expect(us).toBeLessThan(100);
  });

  test("get_node_positions (typed array)", () => {
    const us = bench("get_node_positions", () => {
      engine.get_node_positions();
    }, 5000);
    expect(us).toBeLessThan(20);
  });

  test("get_node_positions (raw ptr)", () => {
    const us = bench("get_node_positions_ptr", () => {
      engine.get_node_positions_ptr();
      engine.get_node_positions_len();
    }, 5000);
    expect(us).toBeLessThan(15);
  });

  test("get_active_edges (typed array)", () => {
    const us = bench("get_active_edges", () => {
      engine.get_active_edges();
    }, 5000);
    expect(us).toBeLessThan(10);
  });

  test("get_active_edges (raw ptr)", () => {
    const us = bench("get_active_edges_ptr", () => {
      engine.get_active_edges_ptr();
      engine.get_active_edges_len();
    }, 5000);
    expect(us).toBeLessThan(5);
  });

  test("encode_payload + decode_payload", () => {
    const us = bench("encode+decode pair", () => {
      const enc = engine.encode_payload("HelloWorld", 5);
      engine.decode_payload(enc, 5);
    }, 1000);
    expect(us).toBeLessThan(50);
  });

  test("all-pairs route (30 pairs)", () => {
    const ids = engine.get_node_ids() as string[];
    const us = bench("all-pairs route", () => {
      for (const src of ids) {
        for (const dst of ids) {
          if (src !== dst) engine.calculate_route(src, dst, "all");
        }
      }
    }, 20);
    expect(us).toBeLessThan(5000); // should be <5ms for 30 routes
  });
});

// ─────────────────────────────────────────────
// MULTIVERSE 200-PLANET TESTS
// ─────────────────────────────────────────────

let mvConfigStr: string;
let mvConfigJson: any;

beforeAll(async () => {
  mvConfigStr = await Bun.file("./tests/multiverse-config.json").text();
  mvConfigJson = JSON.parse(mvConfigStr);
});

describe("Multiverse: config loading (200 planets)", () => {
  test("loads 200-planet config", () => {
    engine.load_config(mvConfigStr);
  });

  test("node count is 200", () => {
    const ids = engine.get_node_ids() as string[];
    expect(ids).toHaveLength(200);
  });

  test("node IDs are Planet_1..Planet_200", () => {
    const ids = engine.get_node_ids() as string[];
    expect(ids[0]).toBe("Planet_1");
    expect(ids[199]).toBe("Planet_200");
  });

  test("positions array has 400 elements (200*2)", () => {
    const pos = engine.get_node_positions();
    expect(pos).toHaveLength(400);
  });

  test("alive mask length covers 200 nodes (32 bytes)", () => {
    const mask = engine.get_alive_mask();
    expect(mask.byteLength).toBe(32);
    const usedBits = 200;
    const fullBytes = Math.floor(usedBits / 8);
    const partialBits = usedBits % 8;
    for (let i = 0; i < fullBytes; i++) {
      expect(mask[i]).toBe(0xff);
    }
    if (partialBits > 0) {
      const expected = (1 << partialBits) - 1;
      expect(mask[fullBytes]).toBe(expected);
    }
    for (let i = fullBytes + (partialBits > 0 ? 1 : 0); i < 32; i++) {
      expect(mask[i]).toBe(0x00);
    }
  });

  test("all nodes have non-zero positions", () => {
    const pos = engine.get_node_positions();
    let zeroCount = 0;
    for (let i = 0; i < pos.length; i++) {
      if (pos[i] === 0) zeroCount++;
    }
    expect(zeroCount).toBe(0);
  });
});

describe("Multiverse: edge graph (200 planets)", () => {
  test("active edges exist between reachable planets", () => {
    engine.load_config(mvConfigStr);
    const edges = engine.get_active_edges();
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.length % 2).toBe(0); // pairs
  });

  test("edge count is plausible for 200 planets", () => {
    const edges = engine.get_active_edges();
    const edgeCount = edges.length / 2;
    // 200 planets, each can have up to 199 edges, but many dropped by Lmax
    expect(edgeCount).toBeGreaterThan(100);
    expect(edgeCount).toBeLessThan(40000);
  });

  test("every edge references valid node indices (0..199)", () => {
    const edges = engine.get_active_edges();
    for (let i = 0; i < edges.length; i++) {
      expect(edges[i]).toBeGreaterThanOrEqual(0);
      expect(edges[i]).toBeLessThan(200);
    }
  });
});

describe("Multiverse: routing (200 planets)", () => {
  beforeAll(() => {
    engine.load_config(mvConfigStr);
  });

  test("route Planet_1 → Planet_200 succeeds", () => {
    const json = engine.calculate_route("Planet_1", "Planet_200", "multiverse_msg");
    const pkt = JSON.parse(json) as RouteResult;
    expect(pkt.origin_id).toBe("Planet_1");
    expect(pkt.destination_id).toBe("Planet_200");
    expect(pkt.hop_log.length).toBeGreaterThan(0);
    expect(pkt.hop_log[pkt.hop_log.length - 1].payload_state).toContain("(ASCII)");
  });

  test("route Planet_100 → Planet_1 (reverse direction) succeeds", () => {
    const json = engine.calculate_route("Planet_100", "Planet_1", "back_msg");
    const pkt = JSON.parse(json) as RouteResult;
    expect(pkt.origin_id).toBe("Planet_100");
    expect(pkt.destination_id).toBe("Planet_1");
    expect(pkt.hop_log.length).toBeGreaterThan(0);
  });

  test("self-route Planet_50 → Planet_50 has 1 hop", () => {
    const json = engine.calculate_route("Planet_50", "Planet_50", "loop");
    const pkt = JSON.parse(json) as RouteResult;
    expect(pkt.hop_log).toHaveLength(1);
    expect(pkt.hop_log[0].planet).toBe("Planet_50");
    expect(pkt.hop_log[0].tower_entry).toBeUndefined();
    expect(pkt.hop_log[0].tower_exit).toBeUndefined();
    expect(pkt.hop_log[0].tv_from_prev_ms).toBeUndefined();
  });

  test("route payload encodes per-hop codex", () => {
    const json = engine.calculate_route("Planet_1", "Planet_10", "TestPayload");
    const pkt = JSON.parse(json) as RouteResult;
    if (pkt.hop_log.length > 1) {
      // intermediate hops show BaseN encoding
      for (let i = 0; i < pkt.hop_log.length - 1; i++) {
        expect(pkt.hop_log[i].payload_state).toContain("(Base");
      }
      // last hop shows ASCII
      expect(pkt.hop_log[pkt.hop_log.length - 1].payload_state).toContain("(ASCII)");
    }
  });

  test("every hop has non-negative tp_ms", () => {
    const json = engine.calculate_route("Planet_1", "Planet_50", "check_tp");
    const pkt = JSON.parse(json) as RouteResult;
    for (const hop of pkt.hop_log) {
      expect(hop.tp_ms).toBeGreaterThanOrEqual(0);
    }
  });

  test("multi-hop routes: tv_from_prev_ms present on hop 2+", () => {
    const json = engine.calculate_route("Planet_1", "Planet_200", "hop_check");
    const pkt = JSON.parse(json) as RouteResult;
    if (pkt.hop_log.length > 1) {
      expect(pkt.hop_log[0].tv_from_prev_ms).toBeUndefined();
      for (let i = 1; i < pkt.hop_log.length; i++) {
        expect(pkt.hop_log[i].tv_from_prev_ms).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("throws on unknown origin in 200-planet config", () => {
    expect(() => engine.calculate_route("NoSuchPlanet", "Planet_1", "x")).toThrow();
  });

  test("throws on unknown destination in 200-planet config", () => {
    expect(() => engine.calculate_route("Planet_1", "NoSuchPlanet", "x")).toThrow();
  });
});

describe("Multiverse: kill / resurrect (200 planets)", () => {
  beforeAll(() => {
    engine.load_config(mvConfigStr);
  });

  test("killing Planet_50 changes alive mask", () => {
    const maskBefore = engine.get_alive_mask();
    engine.kill_node("Planet_50");
    const maskAfter = engine.get_alive_mask();
    // Planet_50 (0-indexed): word=50/64=0, byte=50/8=6, bit=50%8=2
    expect(maskAfter[6]).not.toBe(maskBefore[6]);
  });

  test("routing through killed Planet_50 fails or reroutes", () => {
    engine.load_config(mvConfigStr);
    engine.kill_node("Planet_50");
    // Route that might go through Planet_50 — either reroutes or throws
    try {
      const json = engine.calculate_route("Planet_49", "Planet_51", "reroute");
      const pkt = JSON.parse(json) as RouteResult;
      // If route succeeded, it must NOT pass through killed Planet_50
      for (const hop of pkt.hop_log) {
        expect(hop.planet).not.toBe("Planet_50");
      }
    } catch {
      // acceptable — no route around killed node
    }
  });

  test("resurrect Planet_50 restores mask", () => {
    engine.load_config(mvConfigStr);
    engine.kill_node("Planet_50");
    engine.resurrect_node("Planet_50");
    const mask = engine.get_alive_mask();
    // Verify the byte for Planet_50 is restored
    expect(mask[6]).toBe(0xff);
  });

  test("kill multiple nodes reduces edge count", () => {
    engine.load_config(mvConfigStr);
    const edgesBefore = engine.get_active_edges().length;
    engine.kill_node("Planet_1");
    engine.kill_node("Planet_2");
    engine.kill_node("Planet_3");
    const edgesAfter = engine.get_active_edges().length;
    expect(edgesAfter).toBeLessThan(edgesBefore);
  });

  test("resurrect restores edge count", () => {
    engine.load_config(mvConfigStr);
    const edgesBefore = engine.get_active_edges().length;
    engine.kill_node("Planet_1");
    engine.kill_node("Planet_2");
    engine.resurrect_node("Planet_1");
    engine.resurrect_node("Planet_2");
    const edgesAfter = engine.get_active_edges().length;
    expect(edgesAfter).toBe(edgesBefore);
  });
});

describe("Multiverse: stress (200 planets)", () => {
  beforeAll(() => {
    engine.load_config(mvConfigStr);
  });

  test("100 random routes succeed", () => {
    const ids = engine.get_node_ids() as string[];
    for (let i = 0; i < 100; i++) {
      const src = ids[Math.floor(Math.random() * ids.length)];
      const dst = ids[Math.floor(Math.random() * ids.length)];
      const json = engine.calculate_route(src, dst, "stress");
      const pkt = JSON.parse(json) as RouteResult;
      expect(pkt.origin_id).toBe(src);
      expect(pkt.destination_id).toBe(dst);
    }
  }, 30000);

  test("100 kill-resurrect cycles on random nodes", () => {
    const ids = engine.get_node_ids() as string[];
    for (let i = 0; i < 100; i++) {
      const victim = ids[Math.floor(Math.random() * ids.length)];
      engine.kill_node(victim);
      engine.resurrect_node(victim);
    }
    const mask = engine.get_alive_mask();
    // First 25 bytes cover 200 bits — all should be 0xFF
    for (let i = 0; i < 25; i++) {
      expect(mask[i]).toBe(0xff);
    }
  });

  test("all-pairs route on first 15 planets", () => {
    const ids = engine.get_node_ids() as string[];
    const subset = ids.slice(0, 15);
    for (const src of subset) {
      for (const dst of subset) {
        if (src === dst) continue;
        const json = engine.calculate_route(src, dst, "allpairs");
        const pkt = JSON.parse(json) as RouteResult;
        expect(pkt.hop_log.length).toBeGreaterThan(0);
      }
    }
  }, 30000);
});

describe("Multiverse: performance (200 planets)", () => {
  beforeAll(() => {
    engine.load_config(mvConfigStr);
  });

  test("load_config for 200 planets < 30ms", () => {
    const us = bench("mv_load_config", () => {
      engine.load_config(mvConfigStr);
    }, 20);
    expect(us).toBeLessThan(30000);
  });

  test("single route < 1ms", () => {
    const us = bench("mv_calculate_route", () => {
      engine.calculate_route("Planet_1", "Planet_200", "bench");
    }, 500);
    expect(us).toBeLessThan(1000);
  });

  test("get_node_positions < 50µs", () => {
    const us = bench("mv_positions", () => {
      engine.get_node_positions();
    }, 5000);
    expect(us).toBeLessThan(50);
  });

  test("get_active_edges < 200µs", () => {
    const us = bench("mv_edges", () => {
      engine.get_active_edges();
    }, 5000);
    expect(us).toBeLessThan(200);
  });

  test("kill + resurrect pair < 2ms", () => {
    const us = bench("mv_kill_resurrect", () => {
      engine.kill_node("Planet_100");
      engine.resurrect_node("Planet_100");
    }, 500);
    expect(us).toBeLessThan(2000);
  });

  test("100-route batch < 5ms", () => {
    const ids = engine.get_node_ids() as string[];
    const ms = bench("mv_100_routes_ms", () => {
      for (let i = 0; i < 100; i++) {
        engine.calculate_route(ids[i % ids.length], ids[(i + 50) % ids.length], "batch");
      }
    }, 10);
    expect(ms).toBeLessThan(5000);
  });
});
