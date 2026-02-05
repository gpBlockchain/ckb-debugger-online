import { useState, useCallback, useEffect } from "react";
import {
  initializeWasmer,
  runBinaryMode,
  runMockTxMode,
  checkWasmAvailability,
  type DebuggerResult,
  type BinaryModeParams,
  type MockTxModeParams,
} from "../lib/wasmer";

export type DebuggerMode = "binary" | "mockTx";

export interface DebuggerState {
  /** 当前模式 */
  mode: DebuggerMode;
  /** 是否正在运行 */
  isRunning: boolean;
  /** 是否已初始化 */
  isInitialized: boolean;
  /** 初始化错误 */
  initError: string | null;
  /** 运行结果 */
  result: DebuggerResult | null;
  /** WASM 是否可用 */
  wasmAvailable: boolean;
}

export interface UseDebuggerReturn extends DebuggerState {
  /** 设置模式 */
  setMode: (mode: DebuggerMode) => void;
  /** 运行 Binary 模式 */
  runBinary: (params: BinaryModeParams) => Promise<DebuggerResult>;
  /** 运行 Mock TX 模式 */
  runMockTx: (params: MockTxModeParams) => Promise<DebuggerResult>;
  /** 清除结果 */
  clearResult: () => void;
  /** 重新初始化 */
  reinitialize: () => Promise<void>;
}

export function useDebugger(): UseDebuggerReturn {
  const [mode, setMode] = useState<DebuggerMode>("binary");
  const [isRunning, setIsRunning] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [result, setResult] = useState<DebuggerResult | null>(null);
  const [wasmAvailable, setWasmAvailable] = useState(false);

  // 初始化
  const initialize = useCallback(async () => {
    setInitError(null);
    
    try {
      // 检查 WASM 是否可用
      const availability = await checkWasmAvailability();
      setWasmAvailable(availability.available);
      
      if (!availability.available) {
        setInitError(availability.error || "WASM 不可用");
        return;
      }
      
      // 初始化 Wasmer
      await initializeWasmer();
      setIsInitialized(true);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setInitError(`初始化失败: ${errorMessage}`);
    }
  }, []);

  // 组件挂载时初始化
  useEffect(() => {
    initialize();
  }, [initialize]);

  // 运行 Binary 模式
  const runBinary = useCallback(async (params: BinaryModeParams): Promise<DebuggerResult> => {
    setIsRunning(true);
    setResult(null);
    
    try {
      const debugResult = await runBinaryMode(params);
      setResult(debugResult);
      return debugResult;
    } finally {
      setIsRunning(false);
    }
  }, []);

  // 运行 Mock TX 模式
  const runMockTx = useCallback(async (params: MockTxModeParams): Promise<DebuggerResult> => {
    setIsRunning(true);
    setResult(null);
    
    try {
      const debugResult = await runMockTxMode(params);
      setResult(debugResult);
      return debugResult;
    } finally {
      setIsRunning(false);
    }
  }, []);

  // 清除结果
  const clearResult = useCallback(() => {
    setResult(null);
  }, []);

  // 重新初始化
  const reinitialize = useCallback(async () => {
    setIsInitialized(false);
    await initialize();
  }, [initialize]);

  return {
    mode,
    isRunning,
    isInitialized,
    initError,
    result,
    wasmAvailable,
    setMode,
    runBinary,
    runMockTx,
    clearResult,
    reinitialize,
  };
}
