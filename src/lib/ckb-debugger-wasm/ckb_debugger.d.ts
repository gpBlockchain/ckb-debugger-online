/* tslint:disable */
/* eslint-disable */
export function run_json(mock_tx: string, script_group_type: string, script_hash: string, max_cycle: string): string;
/**
 * Perform an IPC call to a CKB script.
 *
 * # Arguments
 * * `mock_tx` - JSON string of a mock transaction (ReprMockTransaction)
 * * `script_group_type` - "lock" or "type"
 * * `script_hash` - hex-encoded script hash
 * * `max_cycle` - maximum cycles allowed
 * * `ipc_request` - JSON string of an IPC request with fields: version, method_id, payload_format, payload
 *
 * # Returns
 * JSON string of the IPC response with fields: version, error_code, payload_format, payload
 */
export function ipc_call(mock_tx: string, script_group_type: string, script_hash: string, max_cycle: string, ipc_request: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly run_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
  readonly ipc_call: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
  readonly __internal_syscall: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
  readonly rustsecp256k1_v0_10_0_context_create: (a: number) => number;
  readonly rustsecp256k1_v0_10_0_context_destroy: (a: number) => void;
  readonly rustsecp256k1_v0_10_0_default_illegal_callback_fn: (a: number, b: number) => void;
  readonly rustsecp256k1_v0_10_0_default_error_callback_fn: (a: number, b: number) => void;
  readonly __wbindgen_export_0: WebAssembly.Table;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_start: () => void;
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
