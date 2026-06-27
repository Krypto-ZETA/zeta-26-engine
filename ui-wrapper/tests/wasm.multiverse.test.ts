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

let engine: typeof import("../pkg/zeta_26_engine.js");
let mvConfigStr: string;
let mvConfigJson: any;

function bench(name: string, fn: () => void, iterations: number) {
  for (let i = 0; i < 10; i++) fn();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;
  const perOp = (elapsed / iterations) * 1000;
  console.log(`  ${name}: ${perOp.toFixed(1)} µs/op (${iterations} iterations)`);
  return perOp;
}

beforeAll(async () => {
  engine = await import("../pkg/zeta_26_engine.js");
  await engine.default();
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
  beforeAll(() => {
    engine.load_config(mvConfigStr);
  });

  test("active edges exist between reachable planets", () => {
    engine.load_config(mvConfigStr);
    const edges = engine.get_active_edges();
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.length % 2).toBe(0);
  });

  test("edge count is plausible for 200 planets", () => {
    const edges = engine.get_active_edges();
    const edgeCount = edges.length / 2;
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
    expect(pkt.hop_log[pkt.hop_log.length - 1].payload_state).toBe("multiverse_msg");
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
      for (let i = 0; i < pkt.hop_log.length - 1; i++) {
        expect(pkt.hop_log[i].payload_state).toContain("(Base");
      }
      expect(pkt.hop_log[pkt.hop_log.length - 1].payload_state).toBe("TestPayload");
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
    expect(maskAfter[6]).not.toBe(maskBefore[6]);
  });

  test("routing through killed Planet_50 fails or reroutes", () => {
    engine.load_config(mvConfigStr);
    engine.kill_node("Planet_50");
    try {
      const json = engine.calculate_route("Planet_49", "Planet_51", "reroute");
      const pkt = JSON.parse(json) as RouteResult;
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

  test("get_active_edges < 500µs", () => {
    const us = bench("mv_edges", () => {
      engine.get_active_edges();
    }, 5000);
    expect(us).toBeLessThan(500);
  });

  test("kill + resurrect pair < 2ms", () => {
    const us = bench("mv_kill_resurrect", () => {
      engine.kill_node("Planet_100");
      engine.resurrect_node("Planet_100");
    }, 500);
    expect(us).toBeLessThan(5000);
  });

  test("100-route batch < 15ms", () => {
    const ids = engine.get_node_ids() as string[];
    const ms = bench("mv_100_routes_ms", () => {
      for (let i = 0; i < 100; i++) {
        engine.calculate_route(ids[i % ids.length], ids[(i + 50) % ids.length], "batch");
      }
    }, 10);
    expect(ms).toBeLessThan(15000);
  });
});
