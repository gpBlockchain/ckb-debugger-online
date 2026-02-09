/* tslint:disable */
/* eslint-disable */

export class ExecuteResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly cycles: bigint;
    readonly debug_messages: Array<any>;
    readonly json_response: string;
}

/**
 * Execute a CKB script binary with the given arguments and JSON request.
 *
 * # Arguments
 * * `binary` - The RISC-V binary (CKB script) as a byte array
 * * `args` - Comma-separated command-line arguments for the script (e.g. "server_entry")
 * * `json_request` - The JSON request string to send to the server
 *
 * # Returns
 * An `ExecuteResult` containing the JSON response, debug messages, and cycle count.
 */
export function execute_script(binary: Uint8Array, args: string, json_request: string): ExecuteResult;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_executeresult_free: (a: number, b: number) => void;
    readonly executeresult_json_response: (a: number) => [number, number];
    readonly executeresult_cycles: (a: number) => bigint;
    readonly executeresult_debug_messages: (a: number) => any;
    readonly execute_script: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
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
