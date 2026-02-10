/**
 * CKB IPC Runner - TypeScript wrapper for the ckb-debugger WASM module's ipc_call function.
 *
 * Since ckb-standalone-debugger now natively supports IPC calls
 * (see: https://github.com/gpBlockchain/ckb-standalone-debugger/pull/1),
 * we no longer maintain a separate IPC VM. Instead, we reuse the existing
 * ckb-debugger-wasm module which exposes `ipc_call`.
 */

import { initializeWasmer } from "./wasmer";

// Re-export initializeWasmer as the IPC runner init (they share the same WASM module)
export const initializeIpcRunner = initializeWasmer;

/**
 * Check if the IPC runner WASM module is available
 */
export async function checkIpcRunnerAvailability(): Promise<{
  available: boolean;
  error?: string;
}> {
  try {
    await initializeIpcRunner();
    return { available: true };
  } catch (error) {
    return {
      available: false,
      error: `WASM module not available: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** IPC request structure matching the ckb-standalone-debugger format */
export interface IpcRequest {
  version: number;
  method_id: number;
  payload_format: string;
  payload: unknown;
}

/** IPC response structure returned by ipc_call */
export interface IpcResponse {
  version?: number;
  error_code?: number;
  payload_format?: string;
  payload?: unknown;
  error?: string;
}

/** Result of executing an IPC call */
export interface IpcExecuteResult {
  /** Raw JSON response string from ipc_call */
  rawResponse: string;
  /** Parsed response object */
  response: IpcResponse;
}

/**
 * Execute an IPC call to a CKB script.
 *
 * The script binary must be embedded in the mock_tx (as a cell_dep).
 * The full CKB verifier is used, so all CKB syscalls work correctly.
 *
 * @param mockTxJson - JSON string of a mock transaction (ReprMockTransaction)
 * @param scriptGroupType - "lock" or "type"
 * @param scriptHash - Hex-encoded script hash (0x-prefixed)
 * @param maxCycles - Maximum cycles allowed
 * @param ipcRequest - IPC request object
 * @returns The IPC response
 */
export async function executeIpcCall(
  mockTxJson: string,
  scriptGroupType: string,
  scriptHash: string,
  maxCycles: string,
  ipcRequest: IpcRequest
): Promise<IpcExecuteResult> {
  await initializeIpcRunner();

  // Dynamic import to avoid circular dependency issues
  const { ipc_call } = await import("./ckb-debugger-wasm/ckb_debugger");

  const ipcRequestJson = JSON.stringify(ipcRequest);

  const rawResponse = ipc_call(
    mockTxJson,
    scriptGroupType,
    scriptHash,
    maxCycles,
    ipcRequestJson
  );

  let response: IpcResponse;
  try {
    response = JSON.parse(rawResponse) as IpcResponse;
  } catch {
    response = { error: rawResponse };
  }

  return { rawResponse, response };
}

/**
 * Convert hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (cleanHex.length === 0) return new Uint8Array(0);
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
