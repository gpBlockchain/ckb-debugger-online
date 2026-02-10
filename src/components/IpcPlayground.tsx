import { useState, useCallback, useEffect, useMemo } from "react";
import {
  PlayIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  BeakerIcon,
} from "@heroicons/react/24/solid";
import { OutputConsole } from "./OutputConsole";
import {
  checkIpcRunnerAvailability,
  executeIpcCall,
  hexToBytes,
  type IpcRequest,
} from "../lib/ipcRunner";
import type { DebuggerResult } from "../lib/wasmer";
import { useToast } from "./Toast";
import { useI18n } from "../lib/i18n";
import { blake2b } from "blakejs";
import { TxFetcher, FileUploader, type UploadedFile } from "./index";

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
      for (const inp of inputs) {
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
              label: `Type ${hash.slice(0, 10)}...${hash.slice(-6)}`,
              scriptGroupType: "type",
              scriptHash: hash,
            });
          }
        }
      }
    }

    // Extract from outputs
    const outputs = tx.outputs as Array<Record<string, unknown>>;
    if (outputs) {
      for (const out of outputs) {
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
              label: `Type ${hash.slice(0, 10)}...${hash.slice(-6)}`,
              scriptGroupType: "type",
              scriptHash: hash,
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

  // Mock TX state (required for ipc_call)
  const [mockTxFile, setMockTxFile] = useState<UploadedFile | null>(null);
  const [selectedScriptGroup, setSelectedScriptGroup] = useState<string>("");

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

  // Auto-select first script group
  useEffect(() => {
    if (scriptGroups.length > 0 && !selectedScriptGroup) {
      setSelectedScriptGroup(`${scriptGroups[0].scriptGroupType}:${scriptGroups[0].scriptHash}`);
    }
  }, [scriptGroups, selectedScriptGroup]);

  // Load demo example
  const handleLoadDemo = useCallback(() => {
    setMockTxFile(null);
    setSelectedScriptGroup("");
    setMethodId(0);
    setIpcPayload('{"TestPrimitiveTypes":{"arg1":1,"arg2":2,"arg3":3,"arg4":4,"arg5":5,"arg6":6,"arg7":7,"arg8":8,"arg9":9,"arg10":10,"arg11":true}}');
    setMaxCycles("70000000");
    setResult(null);
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

  // Execute IPC call
  const handleExecute = useCallback(async () => {
    if (!mockTxFile || !mockTxStr) {
      toast.addToast("warning", t("ipc.error.loadMockTx"));
      return;
    }

    if (!selectedScriptGroup) {
      toast.addToast("warning", t("ipc.error.selectScriptGroup"));
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

    setIsRunning(true);
    setResult(null);
    const startTime = performance.now();

    try {
      const [sgt, hash] = selectedScriptGroup.split(":");

      const ipcRequest: IpcRequest = {
        version: 0,
        method_id: methodId,
        payload_format: "json",
        payload: parsedPayload,
      };

      const execResult = await executeIpcCall(
        mockTxStr,
        sgt,
        hash,
        maxCycles,
        ipcRequest
      );

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
  }, [mockTxFile, mockTxStr, selectedScriptGroup, ipcPayload, methodId, maxCycles, toast, t]);

  // Clear
  const handleClear = useCallback(() => {
    setIpcPayload("");
    setResult(null);
  }, []);

  const canRun = isAvailable && !isRunning && mockTxFile !== null && selectedScriptGroup !== "";

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

          {/* Step 1: Load Mock TX */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-2">
              {t("ipc.step1New")}
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              {t("ipc.mockTxHelpNew")}
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

            {/* Script group selector */}
            {scriptGroups.length > 0 && (
              <div className="mt-4">
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  {t("ipc.scriptGroup")}
                </label>
                <select
                  value={selectedScriptGroup}
                  onChange={(e) => setSelectedScriptGroup(e.target.value)}
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
              <p className="text-xs text-yellow-600 mt-2">
                {t("ipc.noScriptGroups")}
              </p>
            )}
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
