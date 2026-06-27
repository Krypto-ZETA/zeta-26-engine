/* tslint:disable */
/* eslint-disable */

export function calculate_route(origin_id: string, dest_id: string, payload: string): string;

export function decode_payload(encoded: string, base: number): string;

export function encode_payload(payload: string, base: number): string;

export function get_active_edges(): Uint32Array;

export function get_active_edges_len(): number;

/**
 * Returns a raw pointer into WASM linear memory for zero-copy edge reads.
 * SAFETY: Pointer is invalidated by load_config(), kill_node(), or resurrect_node().
 * Do not cache this pointer across those calls.
 */
export function get_active_edges_ptr(): number;

export function get_alive_mask(): Uint8Array;

export function get_node_ids(): Array<any>;

export function get_node_positions(): Float64Array;

export function get_node_positions_len(): number;

/**
 * Returns a raw pointer into WASM linear memory for zero-copy position reads.
 * SAFETY: Pointer is invalidated by load_config(), kill_node(), or resurrect_node().
 * Do not cache this pointer across those calls.
 */
export function get_node_positions_ptr(): number;

export function kill_node(id: string): void;

export function load_config(json: string): void;

export function resurrect_node(id: string): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly calculate_route: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly decode_payload: (a: number, b: number, c: number, d: number) => void;
    readonly encode_payload: (a: number, b: number, c: number, d: number) => void;
    readonly get_active_edges: () => number;
    readonly get_active_edges_len: () => number;
    readonly get_active_edges_ptr: () => number;
    readonly get_alive_mask: (a: number) => void;
    readonly get_node_ids: (a: number) => void;
    readonly get_node_positions: (a: number) => void;
    readonly get_node_positions_len: () => number;
    readonly get_node_positions_ptr: (a: number) => void;
    readonly kill_node: (a: number, b: number, c: number) => void;
    readonly load_config: (a: number, b: number, c: number) => void;
    readonly resurrect_node: (a: number, b: number, c: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
