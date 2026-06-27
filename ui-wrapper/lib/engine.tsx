'use client';

// Pure WASM adapter — all routing, physics, and graph logic lives in Rust.
// No TS fallback engines. WASM is the single source of truth.

import { create } from 'zustand';
import type { UniverseConfig, RouteResult } from './types';

let wasmReady = false;
let wasmModule: typeof import('../pkg/zeta_26_engine') | null = null;
let wasmMemory: WebAssembly.Memory | null = null;

async function initWasm() {
  if (!wasmModule) {
    wasmModule = await import('../pkg/zeta_26_engine');
    const initOutput = await wasmModule.default();
    wasmMemory = initOutput.memory;
    wasmReady = true;
  }
  return wasmModule;
}

function readEdgesFromWasm(): Uint32Array {
  if (!wasmModule || !wasmMemory) return new Uint32Array(0);
  const len = wasmModule.get_active_edges_len();
  if (len === 0) return new Uint32Array(0);
  const ptr = wasmModule.get_active_edges_ptr();
  return new Uint32Array(wasmMemory.buffer, ptr, len);
}

function readPositionsFromWasm(): Float64Array {
  if (!wasmModule || !wasmMemory) return new Float64Array(0);
  const len = wasmModule.get_node_positions_len();
  const ptr = wasmModule.get_node_positions_ptr();
  return new Float64Array(wasmMemory.buffer, ptr, len);
}

function readAliveFromWasm(): Uint8Array {
  if (!wasmModule) return new Uint8Array(0);
  return wasmModule.get_alive_mask();
}

interface EngineStore {
  config: UniverseConfig | null;
  nodeIds: string[];
  alive: Record<string, boolean>;
  edges: Uint32Array;
  positions: Float64Array;
  aliveMask: Uint8Array;
  routePath: number[] | null;
  routeResult: RouteResult | null;
  routeStatus: 'none' | 'active' | 'undeliverable';
  lastRouteParams: { origin_id: string; destination_id: string; payload: string } | null;
  error: string | null;
  loading: boolean;

  loadConfig: (data: UniverseConfig) => void;
  toggleNode: (id: string) => void;
  calculateRoute: (srcId: string, dstId: string, payload: string) => void;
  clearRoute: () => void;
}

export const useEngineStore = create<EngineStore>((set, get) => ({
  config: null,
  nodeIds: [],
  alive: {},
  edges: new Uint32Array(0),
  positions: new Float64Array(0),
  aliveMask: new Uint8Array(0),
  routePath: null,
  routeResult: null,
  routeStatus: 'none',
  lastRouteParams: null,
  error: null,
  loading: false,

  loadConfig: async (data: UniverseConfig) => {
    try {
      const wasm = await initWasm();
      wasm.load_config(JSON.stringify(data));

      const nodeIds = Array.from(wasm.get_node_ids()) as string[];
      const aliveMap: Record<string, boolean> = {};
      nodeIds.forEach(id => { aliveMap[id] = true; });

      const edges = readEdgesFromWasm();
      const positions = readPositionsFromWasm();
      const aliveMask = readAliveFromWasm();

      set({
        config: data,
        nodeIds,
        alive: aliveMap,
        edges,
        positions,
        aliveMask,
        routePath: null,
        routeResult: null,
        routeStatus: 'none',
        lastRouteParams: null,
        error: null,
      });
    } catch (err) {
      set({ error: `Failed to load config: ${err}` });
    }
  },

  toggleNode: async (id: string) => {
    const { alive } = get();
    if (!alive.hasOwnProperty(id)) return;

    try {
      const wasm = await initWasm();
      const wasAlive = alive[id];

      if (wasAlive) {
        wasm.kill_node(id);
      } else {
        wasm.resurrect_node(id);
      }

      const nextAlive = { ...alive, [id]: !wasAlive };
      const edges = readEdgesFromWasm();
      const aliveMask = readAliveFromWasm();

      // Re-read routeResult after async WASM call to avoid stale state
      const routeResult = get().routeResult;

      if (routeResult) {
        const isOrigin = routeResult.origin_id === id;
        const isDestination = routeResult.destination_id === id;
        const isHop = routeResult.hop_log.some(h => h.planet === id);

        if (isOrigin || isDestination) {
          const savedParams = { origin_id: routeResult.origin_id, destination_id: routeResult.destination_id, payload: routeResult.payload };
          if (wasAlive) {
            set({ alive: nextAlive, edges, aliveMask, routePath: null, routeResult: null, routeStatus: 'none', lastRouteParams: savedParams });
          } else {
            set({ alive: nextAlive, edges, aliveMask, routePath: null, routeResult: null, routeStatus: 'none' });
            try {
              const json = wasm.calculate_route(routeResult.origin_id, routeResult.destination_id, routeResult.payload);
              const route = JSON.parse(json) as RouteResult;
              set({ routePath: route.path, routeResult: route, routeStatus: 'active', lastRouteParams: null });
            } catch {
              set({ routeStatus: 'undeliverable', lastRouteParams: { origin_id: routeResult.origin_id, destination_id: routeResult.destination_id, payload: routeResult.payload } });
            }
          }
        } else if (isHop) {
          set({ alive: nextAlive, edges, aliveMask, routePath: null, routeResult: null, routeStatus: 'none' });
          try {
            const json = wasm.calculate_route(routeResult.origin_id, routeResult.destination_id, routeResult.payload);
            const route = JSON.parse(json) as RouteResult;
            set({ routePath: route.path, routeResult: route, routeStatus: 'active', lastRouteParams: null });
          } catch {
            set({ routeStatus: 'undeliverable', lastRouteParams: { origin_id: routeResult.origin_id, destination_id: routeResult.destination_id, payload: routeResult.payload } });
          }
        } else {
          if (!wasAlive) {
            set({ alive: nextAlive, edges, aliveMask });
            try {
              const json = wasm.calculate_route(routeResult.origin_id, routeResult.destination_id, routeResult.payload);
              const newRoute = JSON.parse(json) as RouteResult;
              if (newRoute.total_latency_ms < routeResult.total_latency_ms) {
                set({ routePath: newRoute.path, routeResult: newRoute, routeStatus: 'active' });
              }
            } catch { /* no better route */ }
          } else {
            set({ alive: nextAlive, edges, aliveMask });
          }
        }
      } else {
        set({ alive: nextAlive, edges, aliveMask });
        const { lastRouteParams } = get();
        if (lastRouteParams && !wasAlive) {
          try {
            const json = wasm.calculate_route(lastRouteParams.origin_id, lastRouteParams.destination_id, lastRouteParams.payload);
            const route = JSON.parse(json) as RouteResult;
            set({ routePath: route.path, routeResult: route, routeStatus: 'active', lastRouteParams: null });
          } catch { /* still undeliverable */ }
        }
      }
    } catch (err) {
      set({ error: `Failed to toggle node: ${err}` });
    }
  },

  calculateRoute: async (srcId: string, dstId: string, payload: string) => {
    const { config } = get();
    if (!config) {
      set({ error: 'No config loaded' });
      return;
    }

    set({ loading: true, error: null });

    try {
      const wasm = await initWasm();
      const json = wasm.calculate_route(srcId, dstId, payload);
      const route = JSON.parse(json) as RouteResult;
      set({
        routePath: route.path,
        routeResult: route,
        routeStatus: 'active',
        loading: false,
        error: null,
        lastRouteParams: null,
      });
    } catch (err) {
      const msg = String(err);
      if (msg.includes('no route found')) {
        set({ error: null, routeStatus: 'undeliverable', routePath: null, routeResult: null, loading: false, lastRouteParams: { origin_id: srcId, destination_id: dstId, payload } });
      } else {
        set({ error: `Route failed: ${err}`, loading: false });
      }
    }
  },

  clearRoute: () => set({ routePath: null, routeResult: null, routeStatus: 'none', lastRouteParams: null }),
}));

export function useEngine() {
  return useEngineStore();
}

export { readPositionsFromWasm };
