import { useState, useCallback, useEffect, useMemo } from "react";
import {
  PlayIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  BeakerIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/solid";
import { OutputConsole } from "./OutputConsole";
import {
  checkIpcRunnerAvailability,
  executeIpcCall,
  executeScriptDirect,
  executeScriptWithMockTx,
  hexToBytes,
  type IpcRequest,
  type IpcExecuteResult,
} from "../lib/ipcRunner";
import type { DebuggerResult } from "../lib/wasmer";
import { useToast } from "./Toast";
import { useI18n } from "../lib/i18n";
import { blake2b } from "blakejs";
import { TxFetcher, FileUploader, type UploadedFile, BinaryLoader, type LoadedBinary } from "./index";

// ---------------------------------------------------------------------------
// Script hash helpers (compute blake2b-256 with CKB personalization)
// ---------------------------------------------------------------------------

const CKB_HASH_PERSONALIZATION = new Uint8Array([
  99, 107, 98, 45, 100, 101, 102, 97, 117, 108, 116, 45, 104, 97, 115, 104,
]); // "ckb-default-hash"

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// CKB hash_type encoding: data=0x00, type=0x01, data1=0x02, data2=0x04
function hashTypeToNum(ht: string): number {
  switch (ht) {
    case "data": return 0;
    case "type": return 1;
    case "data1": return 2;
    case "data2": return 4;
    default: return 0;
  }
}

function serializeScript(codeHash: Uint8Array, hashType: number, args: Uint8Array): Uint8Array {
  const headerSize = 4 + 4 * 3;
  const totalSize = headerSize + 32 + 1 + 4 + args.length;
  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);
  view.setUint32(0, totalSize, true);
  view.setUint32(4, headerSize, true);
  view.setUint32(8, headerSize + 32, true);
  view.setUint32(12, headerSize + 33, true);
  buf.set(codeHash, headerSize);
  buf[headerSize + 32] = hashType;
  view.setUint32(headerSize + 33, args.length, true);
  buf.set(args, headerSize + 37);
  return buf;
}

function computeScriptHash(script: {
  code_hash: string;
  hash_type: string;
  args: string;
}): string {
  const codeHash = hexToBytes(script.code_hash);
  const hashType = hashTypeToNum(script.hash_type);
  const args = hexToBytes(script.args);
  const serialized = serializeScript(codeHash, hashType, args);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hash = (blake2b as any)(serialized, undefined, 32, undefined, CKB_HASH_PERSONALIZATION) as Uint8Array;
  return "0x" + bytesToHex(hash);
}

/** Detected script group from mock_tx */
interface ScriptGroupOption {
  label: string;
  scriptGroupType: "lock" | "type";
  scriptHash: string;
  /** First matching cell index for this script group */
  cellIndex: number;
  /** Cell type: "input" or "output" */
  cellType: "input" | "output";
}

function extractScriptGroups(mockTxStr: string): ScriptGroupOption[] {
  try {
    const obj = JSON.parse(mockTxStr);
    const groups: Map<string, ScriptGroupOption> = new Map();
    const mockInfo = obj.mock_info;
    const tx = obj.tx;
    if (!mockInfo || !tx) return [];

    // Extract from inputs
    const inputs = mockInfo.inputs as Array<Record<string, unknown>>;
    if (inputs) {
      for (let i = 0; i < inputs.length; i++) {
        const inp = inputs[i];
        const output = inp.output as Record<string, unknown>;
        if (!output) continue;
        const lock = output.lock as Record<string, unknown>;
        if (lock) {
          const hash = computeScriptHash({
            code_hash: lock.code_hash as string,
            hash_type: lock.hash_type as string,
            args: lock.args as string,
          });
          const key = `lock:${hash}`;
          if (!groups.has(key)) {
            groups.set(key, {
              label: `Lock ${hash.slice(0, 10)}...${hash.slice(-6)}`,
              scriptGroupType: "lock",
              scriptHash: hash,
              cellIndex: i,
              cellType: "input",
            });
          }
        }
        const type_ = output.type as Record<string, unknown> | null;
        if (type_) {
          const hash = computeScriptHash({
            code_hash: type_.code_hash as string,
            hash_type: type_.hash_type as string,
            args: type_.args as string,
          });
          const key = `type:${hash}`;
          if (!groups.has(key)) {
            groups.set(key, {
              label: `Type (input[${i}]) ${hash.slice(0, 10)}...${hash.slice(-6)}`,
              scriptGroupType: "type",
              scriptHash: hash,
              cellIndex: i,
              cellType: "input",
            });
          }
        }
      }
    }

    // Extract from outputs
    const outputs = tx.outputs as Array<Record<string, unknown>>;
    if (outputs) {
      for (let i = 0; i < outputs.length; i++) {
        const out = outputs[i];
        const type_ = out.type as Record<string, unknown> | null;
        if (type_) {
          const hash = computeScriptHash({
            code_hash: type_.code_hash as string,
            hash_type: type_.hash_type as string,
            args: type_.args as string,
          });
          const key = `type:${hash}`;
          if (!groups.has(key)) {
            groups.set(key, {
              label: `Type (output[${i}]) ${hash.slice(0, 10)}...${hash.slice(-6)}`,
              scriptGroupType: "type",
              scriptHash: hash,
              cellIndex: i,
              cellType: "output",
            });
          }
        }
      }
    }

    return Array.from(groups.values());
  } catch {
    return [];
  }
}

export function IpcPlayground() {
  const toast = useToast();
  const { t } = useI18n();

  // WASM state
  const [isAvailable, setIsAvailable] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Script binary state (required)
  const [binaryFile, setBinaryFile] = useState<LoadedBinary | null>(null);
  const [scriptArgs, setScriptArgs] = useState("0x");
  const [binaryPrefill, setBinaryPrefill] = useState<{
    network: "mainnet" | "testnet" | "custom";
    txHash: string;
    outputIndex: string;
    _ts?: number; // timestamp to force re-trigger
  } | null>(null);

  // Mock TX state (optional)
  const [mockTxFile, setMockTxFile] = useState<UploadedFile | null>(null);
  const [selectedScriptGroup, setSelectedScriptGroup] = useState<string>("");
  const [mockTxExpanded, setMockTxExpanded] = useState(false);
  const [cellIndex, setCellIndex] = useState(0);
  const [cellType, setCellType] = useState("input");
  const [scriptGroupType, setScriptGroupType] = useState("lock");

  // IPC Request fields
  const [ipcPayload, setIpcPayload] = useState("");
  const [methodId, setMethodId] = useState(0);
  const [maxCycles, setMaxCycles] = useState("70000000");

  // Execution state
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<DebuggerResult | null>(null);

  // Get mock_tx as string
  const mockTxStr = useMemo(() => {
    if (!mockTxFile) return "";
    try {
      const decoder = new TextDecoder();
      return decoder.decode(mockTxFile.content);
    } catch (e) {
      console.warn("Failed to decode mock_tx file:", e);
      return "";
    }
  }, [mockTxFile]);

  // Detect script groups from mock_tx
  const scriptGroups = useMemo<ScriptGroupOption[]>(() => {
    if (!mockTxStr) return [];
    return extractScriptGroups(mockTxStr);
  }, [mockTxStr]);

  // Auto-select first script group and sync cellIndex/cellType/scriptGroupType
  useEffect(() => {
    if (scriptGroups.length > 0 && !selectedScriptGroup) {
      const first = scriptGroups[0];
      setSelectedScriptGroup(`${first.scriptGroupType}:${first.scriptHash}`);
      setCellIndex(first.cellIndex);
      setCellType(first.cellType);
      setScriptGroupType(first.scriptGroupType);
    }
  }, [scriptGroups, selectedScriptGroup]);

  // When selectedScriptGroup changes, sync cellIndex/cellType/scriptGroupType
  const handleScriptGroupChange = useCallback((value: string) => {
    setSelectedScriptGroup(value);
    const match = scriptGroups.find(
      (g) => `${g.scriptGroupType}:${g.scriptHash}` === value
    );
    if (match) {
      setCellIndex(match.cellIndex);
      setCellType(match.cellType);
      setScriptGroupType(match.scriptGroupType);
    }
  }, [scriptGroups]);

  // Load demo example - auto-fetch binary from testnet
  const handleLoadDemo = useCallback(() => {
    setBinaryFile(null);
    setScriptArgs("0x");
    setMockTxFile(null);
    setSelectedScriptGroup("");
    setMockTxExpanded(false);
    setMethodId(0);
    setIpcPayload('{"TestPrimitiveTypes":{"arg1":1,"arg2":2,"arg3":3,"arg4":4,"arg5":5,"arg6":6,"arg7":7,"arg8":8,"arg9":9,"arg10":10,"arg11":true}}');
    setMaxCycles("70000000");
    setResult(null);
    // Trigger BinaryLoader to fetch from testnet (timestamp ensures re-trigger)
    setBinaryPrefill({
      network: "testnet",
      txHash: "0xd9f0427fd961edfab00d1e37cec34ec301eed54e7099628c7b59bff003a8956a",
      outputIndex: "0",
      _ts: Date.now(),
    });
    toast.addToast("info", t("ipc.demoLoadedNew"));
  }, [toast, t]);

  // Initialize WASM
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsInitializing(true);
      const avail = await checkIpcRunnerAvailability();
      if (cancelled) return;
      setIsAvailable(avail.available);
      setInitError(avail.available ? null : (avail.error || null));
      setIsInitializing(false);
      if (avail.available) {
        toast.addToast("success", t("ipc.wasmReady"));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Retry initialization
  const handleRetryInit = useCallback(async () => {
    setIsInitializing(true);
    setInitError(null);
    const avail = await checkIpcRunnerAvailability();
    setIsAvailable(avail.available);
    setInitError(avail.available ? null : (avail.error || null));
    setIsInitializing(false);
  }, []);

  // Handle TxFetcher mock tx ready
  const handleMockTxReady = useCallback((file: UploadedFile) => {
    setMockTxFile(file);
    setSelectedScriptGroup("");
    toast.addToast("success", t("success.mockTxGenerated"));
  }, [toast, t]);

  // Determine if we have a mock_tx context
  const hasMockTx = mockTxFile !== null && mockTxStr !== "";

  // Determine execution mode:
  // Mode A: binary only (no mock_tx) → execute_script
  // Mode B: binary + mock_tx → execute_script_with_mock_tx
  // Mode C: mock_tx only (no binary) → ipc_call (legacy/demo mode)
  const hasBinary = binaryFile !== null;

  // Execute IPC call
  const handleExecute = useCallback(async () => {
    // Must have either binary or mock_tx
    if (!hasBinary && !hasMockTx) {
      toast.addToast("warning", t("ipc.error.uploadBinaryOrMockTx"));
      return;
    }

    if (!ipcPayload.trim()) {
      toast.addToast("warning", t("ipc.error.enterRequest"));
      return;
    }

    // Validate JSON payload
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(ipcPayload);
    } catch {
      toast.addToast("warning", t("ipc.error.invalidJson"));
      return;
    }

    // If mock_tx is provided without binary (Mode C), validate script group selection
    if (hasMockTx && !hasBinary && !selectedScriptGroup) {
      toast.addToast("warning", t("ipc.error.selectScriptGroup"));
      return;
    }

    setIsRunning(true);
    setResult(null);
    const startTime = performance.now();

    try {
      const ipcRequest: IpcRequest = {
        version: 0,
        method_id: methodId,
        payload_format: "json",
        payload: parsedPayload,
      };

      let execResult: IpcExecuteResult;

      if (hasBinary && hasMockTx) {
        // Mode B: binary + mock_tx → execute_script_with_mock_tx
        execResult = await executeScriptWithMockTx(
          binaryFile!.data,
          scriptArgs,
          ipcRequest,
          mockTxStr,
          cellIndex,
          cellType,
          scriptGroupType
        );
      } else if (hasBinary) {
        // Mode A: binary only → execute_script
        execResult = await executeScriptDirect(
          binaryFile!.data,
          scriptArgs,
          ipcRequest
        );
      } else {
        // Mode C: mock_tx only → ipc_call (legacy/demo mode)
        const [sgt, hash] = selectedScriptGroup.split(":");
        execResult = await executeIpcCall(
          mockTxStr,
          sgt,
          hash,
          maxCycles,
          ipcRequest
        );
      }

      const duration = performance.now() - startTime;

      // Format output
      let formattedResponse: string;
      try {
        formattedResponse = JSON.stringify(execResult.response, null, 2);
      } catch {
        formattedResponse = execResult.rawResponse;
      }

      const hasError = execResult.response.error !== undefined;

      let stdout = "";
      if (hasError) {
        stdout += `✗ ${t("ipc.executionError")}\n\n`;
        stdout += `${t("ipc.error.detail")}: ${execResult.response.error}\n`;
      } else {
        stdout += `✓ ${t("ipc.executionSuccess")}\n\n`;
        stdout += `${t("ipc.jsonResponse")}:\n${formattedResponse}\n\n`;
      }
      stdout += `${t("ipc.executionTime")}: ${(duration / 1000).toFixed(2)}s`;

      setResult({
        stdout,
        stderr: hasError ? String(execResult.response.error) : "",
        exitCode: hasError ? 1 : 0,
        success: !hasError,
        duration,
      });

      if (hasError) {
        toast.addToast("error", `${t("error.executionError")}: ${execResult.response.error}`);
      } else {
        toast.addToast(
          "success",
          `${t("success.executionSuccess")} (${(duration / 1000).toFixed(2)}s)`
        );
      }
    } catch (error) {
      const duration = performance.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      setResult({
        stdout: "",
        stderr: `${t("ipc.executionError")}: ${errorMessage}`,
        exitCode: 1,
        success: false,
        duration,
      });

      toast.addToast("error", `${t("error.executionError")}: ${errorMessage}`);
    } finally {
      setIsRunning(false);
    }
  }, [hasBinary, binaryFile, scriptArgs, ipcPayload, methodId, maxCycles, hasMockTx, mockTxStr, selectedScriptGroup, cellIndex, cellType, scriptGroupType, toast, t]);

  // Clear
  const handleClear = useCallback(() => {
    setIpcPayload("");
    setResult(null);
  }, []);

  // Determine current execution mode for display
  const executionMode = hasBinary && hasMockTx ? "B" : hasBinary ? "A" : hasMockTx ? "C" : null;

  // Can run if: has binary, OR has mock_tx with a script group selected
  const canRun = isAvailable && !isRunning && (
    hasBinary || (hasMockTx && selectedScriptGroup !== "")
  );

  return (
    <div className="space-y-6">
      {/* Init warning */}
      {initError && !isInitializing && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start space-x-3">
          <ExclamationTriangleIcon className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-medium text-yellow-800">
              {t("ipc.wasmNotAvailable")}
            </h3>
            <p className="text-sm text-yellow-700 mt-1">{initError}</p>
            <p className="text-sm text-yellow-700 mt-2">
              {t("ipc.runBuildScript")}{" "}
              <code className="bg-yellow-100 px-1 rounded">
                ./scripts/build-wasm.sh
              </code>
            </p>
            <button
              onClick={handleRetryInit}
              className="mt-2 text-sm text-yellow-800 hover:text-yellow-900 flex items-center space-x-1"
            >
              <ArrowPathIcon className="h-4 w-4" />
              <span>{t("warning.retry")}</span>
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Configuration */}
        <div className="space-y-6">
          {/* Demo button */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-blue-800">{t("ipc.demoTitle")}</h3>
                <p className="text-xs text-blue-600 mt-1">{t("ipc.demoDescriptionNew")}</p>
                <p className="text-xs text-blue-600 mt-1">
                  {t("ipc.demoSourceCode")}:{" "}
                  <a
                    href="https://github.com/XuJiandong/ckb-script-ipc/blob/main/contracts/unit-tests/src/server_entry.rs"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-blue-800"
                  >
                    server_entry.rs
                  </a>
                </p>
              </div>
              <button
                onClick={handleLoadDemo}
                disabled={isRunning}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2 transition-colors"
              >
                <BeakerIcon className="h-4 w-4" />
                <span>{t("ipc.loadDemo")}</span>
              </button>
            </div>
          </div>

          {/* Step 1: Script Binary */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-2">
              {t("ipc.step1Binary")}
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              {t("ipc.binaryHelpNew")}
            </p>

            {/* Binary file upload / fetch from chain */}
            <BinaryLoader
              binary={binaryFile}
              onBinaryReady={setBinaryFile}
              onClear={() => setBinaryFile(null)}
              disabled={isRunning}
              prefill={binaryPrefill}
            />

            {/* Script Args */}
            <div className="mt-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t("ipc.scriptArgs")}
              </label>
              <input
                type="text"
                value={scriptArgs}
                onChange={(e) => setScriptArgs(e.target.value)}
                disabled={isRunning}
                placeholder="0x"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              />
              <p className="text-xs text-gray-400 mt-1">{t("ipc.scriptArgsHelp")}</p>
            </div>
          </div>

          {/* Step 2: IPC Request */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-2">
              {t("ipc.step2New")}
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              {t("ipc.requestHelpNew")}
            </p>

            {/* Method ID */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                method_id
              </label>
              <input
                type="number"
                min="0"
                value={methodId}
                onChange={(e) => setMethodId(parseInt(e.target.value, 10) || 0)}
                disabled={isRunning}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              />
            </div>

            {/* Payload */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                payload (JSON)
              </label>
              <textarea
                value={ipcPayload}
                onChange={(e) => setIpcPayload(e.target.value)}
                disabled={isRunning}
                rows={6}
                placeholder='{"TestPrimitiveTypes":{"arg1":1,"arg2":2,"arg3":3}}'
                spellCheck={false}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 resize-y"
              />
            </div>

            {/* Max Cycles */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t("params.maxCycles")}
              </label>
              <input
                type="text"
                value={maxCycles}
                onChange={(e) => setMaxCycles(e.target.value)}
                disabled={isRunning}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              />
            </div>
          </div>

          {/* Optional: Mock TX Context (Collapsible) */}
          <div className="bg-white rounded-lg shadow">
            <button
              onClick={() => setMockTxExpanded(!mockTxExpanded)}
              className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 rounded-lg transition-colors"
            >
              <div className="flex items-center space-x-2">
                {mockTxExpanded ? (
                  <ChevronDownIcon className="h-4 w-4 text-gray-500" />
                ) : (
                  <ChevronRightIcon className="h-4 w-4 text-gray-500" />
                )}
                <h2 className="text-lg font-medium text-gray-900">
                  {t("ipc.mockTxOptional")}
                </h2>
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                  {t("ipc.optional")}
                </span>
                {hasMockTx && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                    {t("ipc.mockTxLoaded")}
                  </span>
                )}
              </div>
            </button>

            {mockTxExpanded && (
              <div className="px-6 pb-6 space-y-4">
                <p className="text-xs text-gray-500">
                  {t("ipc.mockTxHelpOptional")}
                </p>

                {/* Fetch from chain */}
                <TxFetcher
                  onMockTxReady={handleMockTxReady}
                  disabled={isRunning}
                />

                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="bg-white px-2 text-gray-400">
                      {t("fileUpload.orManualUpload")}
                    </span>
                  </div>
                </div>

                {/* File upload for mock_tx */}
                <FileUploader
                  label={t("fileUpload.mockTxJson")}
                  accept=".json"
                  helpText={t("fileUpload.mockTxHelp")}
                  file={mockTxFile}
                  onFileChange={setMockTxFile}
                  disabled={isRunning}
                />

                {/* Mock TX params: cell_index, cell_type, script_group_type */}
                {hasMockTx && (
                  <div className="space-y-3 pt-2 border-t border-gray-100">
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">
                          {t("params.cellIndex")}
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={cellIndex}
                          onChange={(e) => setCellIndex(parseInt(e.target.value, 10) || 0)}
                          disabled={isRunning}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">
                          {t("params.cellType")}
                        </label>
                        <select
                          value={cellType}
                          onChange={(e) => setCellType(e.target.value)}
                          disabled={isRunning}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                        >
                          <option value="input">input</option>
                          <option value="output">output</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">
                          {t("params.scriptGroupType")}
                        </label>
                        <select
                          value={scriptGroupType}
                          onChange={(e) => setScriptGroupType(e.target.value)}
                          disabled={isRunning}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                        >
                          <option value="lock">lock</option>
                          <option value="type">type</option>
                        </select>
                      </div>
                    </div>

                    {/* Script group selector (auto-detected) */}
                    {scriptGroups.length > 0 && (
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">
                          {t("ipc.scriptGroup")} ({t("ipc.autoDetected")})
                        </label>
                        <select
                          value={selectedScriptGroup}
                          onChange={(e) => handleScriptGroupChange(e.target.value)}
                          disabled={isRunning}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                        >
                          {scriptGroups.map((g) => (
                            <option
                              key={`${g.scriptGroupType}:${g.scriptHash}`}
                              value={`${g.scriptGroupType}:${g.scriptHash}`}
                            >
                              {g.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {mockTxFile && scriptGroups.length === 0 && (
                      <p className="text-xs text-yellow-600">
                        {t("ipc.noScriptGroups")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Execution mode indicator */}
          {executionMode && (
            <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
              {executionMode === "A" && (
                <span>🔧 <strong>Mode A</strong>: {t("ipc.modeA")}</span>
              )}
              {executionMode === "B" && (
                <span>🔄 <strong>Mode B</strong>: {t("ipc.modeB")} (cell_index={cellIndex}, {cellType}, {scriptGroupType})</span>
              )}
              {executionMode === "C" && (
                <span>📋 <strong>Mode C</strong>: {t("ipc.modeC")}</span>
              )}
            </div>
          )}

          {/* Execute / Clear buttons */}
          <div className="flex space-x-3">
            <button
              onClick={handleExecute}
              disabled={!canRun}
              className={`
                flex-1 py-3 px-4 rounded-lg font-medium text-white
                flex items-center justify-center space-x-2
                transition-colors
                ${canRun ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-400 cursor-not-allowed"}
              `}
            >
              {isRunning ? (
                <>
                  <ArrowPathIcon className="h-5 w-5 animate-spin" />
                  <span>{t("run.running")}</span>
                </>
              ) : (
                <>
                  <PlayIcon className="h-5 w-5" />
                  <span>{t("ipc.execute")}</span>
                </>
              )}
            </button>

            <button
              onClick={handleClear}
              className="px-4 py-3 rounded-lg font-medium text-gray-700 bg-gray-200 hover:bg-gray-300 transition-colors"
            >
              {t("ipc.clear")}
            </button>
          </div>
        </div>

        {/* Right: Output */}
        <div className="lg:h-[calc(100vh-12rem)]">
          <OutputConsole result={result} isRunning={isRunning} />
        </div>
      </div>
    </div>
  );
}
