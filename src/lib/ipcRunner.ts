/**
 * CKB VM IPC Runner - TypeScript wrapper for the ckb-vm WASM module
 * Provides functions to execute CKB scripts with IPC in the browser
 */

// The WASM module types (matching the Rust wasm-bindgen exports)
interface VmWasmModule {
  default: () => Promise<void>;
  execute_script: (
    binary: Uint8Array,
    args: string,
    json_request: string
  ) => ExecuteResultWasm;
  execute_script_with_mock_tx?: (
    binary: Uint8Array,
    args: string,
    json_request: string,
    mock_tx_json: string,
    cell_index: number,
    cell_type: string,
    script_group_type: string
  ) => ExecuteResultWasm;
}

interface ExecuteResultWasm {
  json_response: string;
  cycles: number;
  debug_messages: string[];
}

/** Result of executing a CKB script via IPC */
export interface IpcExecuteResult {
  jsonResponse: string;
  cycles: number;
  debugMessages: string[];
}

/** Optional mock_tx parameters for CKB syscall support */
export interface MockTxParams {
  /** The mock_tx JSON string */
  mockTxJson: string;
  /** Cell index in the mock_tx */
  cellIndex: number;
  /** Cell type: "input" or "output" */
  cellType: "input" | "output";
  /** Script group type: "lock" or "type" */
  scriptGroupType: "lock" | "type";
}

// Module state
let wasmModule: VmWasmModule | null = null;
let isInitialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Initialize the ckb-vm WASM module
 */
export async function initializeIpcRunner(): Promise<void> {
  if (isInitialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // Dynamic import - the WASM module may not be compiled yet
      const mod = await import("./ckb-vm-ipc-wasm/ckb_script_ipc_web.js");
      await mod.default();
      wasmModule = mod as unknown as VmWasmModule;
      isInitialized = true;
      console.log("CKB VM IPC WASM module initialized");
    } catch (error) {
      initPromise = null;
      throw new Error(
        `Failed to load ckb-vm IPC WASM module: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  })();

  return initPromise;
}

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
      error: `IPC WASM module not available: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Check if the WASM module supports mock_tx execution
 */
export function isMockTxSupported(): boolean {
  return wasmModule != null && typeof wasmModule.execute_script_with_mock_tx === "function";
}

/**
 * Execute a CKB script binary with IPC
 *
 * @param binary - The RISC-V binary (CKB script) as a byte array
 * @param args - Comma-separated arguments for the script (e.g. "server_entry")
 * @param jsonRequest - The JSON request string to send to the server
 * @param mockTxParams - Optional mock_tx parameters for CKB syscall support
 * @returns The execution result including JSON response, cycles, and debug messages
 */
export async function executeScript(
  binary: Uint8Array,
  args: string,
  jsonRequest: string,
  mockTxParams?: MockTxParams
): Promise<IpcExecuteResult> {
  await initializeIpcRunner();

  if (!wasmModule) {
    throw new Error("WASM module not initialized");
  }

  let result: ExecuteResultWasm;

  if (mockTxParams && typeof wasmModule.execute_script_with_mock_tx === "function") {
    result = wasmModule.execute_script_with_mock_tx(
      binary,
      args,
      jsonRequest,
      mockTxParams.mockTxJson,
      mockTxParams.cellIndex,
      mockTxParams.cellType,
      mockTxParams.scriptGroupType
    );
  } else {
    result = wasmModule.execute_script(binary, args, jsonRequest);
  }

  return {
    jsonResponse: result.json_response,
    cycles: result.cycles,
    debugMessages: Array.from(result.debug_messages),
  };
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
