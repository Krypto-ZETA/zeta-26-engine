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
let configStr: string;

beforeAll(async () => {
  engine = await import("../pkg/zeta_26_engine.js");
  await engine.default();
  configStr = await Bun.file("./tests/universe-config.json").text();
  engine.load_config(configStr);
});

const BENCH_SAMPLES = 100;

function bench(name: string, fn: () => void, iterations = BENCH_SAMPLES) {
  for (let i = 0; i < 10; i++) fn();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;
  const perOp = (elapsed / iterations) * 1000;
  console.log(`  ${name}: ${perOp.toFixed(1)} µs/op (${iterations} iterations)`);
  return perOp;
}

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
          JSON.parse(json) as RouteResult;
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

describe("Benchmarks", () => {
  test("load_config", () => {
    const us = bench("load_config", () => {
      engine.load_config(configStr);
    }, 100);
    expect(us).toBeLessThan(10000);
  });

  test("calculate_route (Aegis→Caelum)", () => {
    const us = bench("calculate_route", () => {
      engine.calculate_route("Aegis", "Caelum", "bench");
    }, 500);
    expect(us).toBeLessThan(100);
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
    expect(us).toBeLessThan(15);
  });

  test("get_active_edges (raw ptr)", () => {
    const us = bench("get_active_edges_ptr", () => {
      engine.get_active_edges_ptr();
      engine.get_active_edges_len();
    }, 5000);
    expect(us).toBeLessThan(8);
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
    expect(us).toBeLessThan(5000);
  });
});
