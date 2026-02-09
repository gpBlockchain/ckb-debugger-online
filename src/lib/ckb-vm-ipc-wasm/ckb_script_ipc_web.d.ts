/**
 * Type declarations for the ckb-vm IPC WASM module.
 *
 * This module is compiled from ckb-vm-web/ via wasm-pack.
 * Run ./scripts/build-vm-wasm.sh to generate the actual JS/WASM files.
 */

export interface ExecuteResult {
  readonly json_response: string;
  readonly cycles: number;
  readonly debug_messages: string[];
}

/**
 * Initialize the WASM module
 */
export default function init(): Promise<void>;

/**
 * Execute a CKB script binary with the given arguments and JSON request.
 */
export function execute_script(
  binary: Uint8Array,
  args: string,
  json_request: string
): ExecuteResult;
