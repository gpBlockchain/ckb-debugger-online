import { useState, useCallback, useEffect } from "react";
import {
  PlayIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  BeakerIcon,
} from "@heroicons/react/24/solid";
import { BinaryLoader, type LoadedBinary } from "./BinaryLoader";
import { FileUploader, type UploadedFile } from "./FileUploader";
import { MockTxParamsEditor, type MockTxParams } from "./ParamsEditor";
import { OutputConsole } from "./OutputConsole";
import {
  checkIpcRunnerAvailability,
  executeScript,
  type IpcExecuteResult,
} from "../lib/ipcRunner";
import {
  initializeWasmer,
  runMockTxMode,
} from "../lib/wasmer";
import type { NetworkType } from "../lib/txConverter";
import type { DebuggerResult } from "../lib/wasmer";
import { useToast } from "./Toast";
import { useI18n } from "../lib/i18n";

type IpcExecMode = "binary" | "mockTx";

// Demo example configuration
const DEMO_CONFIG = {
  network: "testnet" as NetworkType,
  txHash: "0xd9f0427fd961edfab00d1e37cec34ec301eed54e7099628c7b59bff003a8956a",
  outputIndex: "0",
  args: "server_entry",
  jsonRequest: '{"TestPrimitiveTypes":{"arg1":1,"arg2":2,"arg3":3,"arg4":4,"arg5":5,"arg6":6,"arg7":7,"arg8":8,"arg9":9,"arg10":10,"arg11":true}}',
};

export function IpcPlayground() {
  const toast = useToast();
  const { t } = useI18n();

  // WASM state
  const [isAvailable, setIsAvailable] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Execution mode
  const [ipcExecMode, setIpcExecMode] = useState<IpcExecMode>("binary");

  // Binary state
  const [binary, setBinary] = useState<LoadedBinary | null>(null);

  // Mock TX state
  const [mockTxFile, setMockTxFile] = useState<UploadedFile | null>(null);
  const [mockTxParams, setMockTxParams] = useState<MockTxParams>({
    cellIndex: 0,
    cellType: "input",
    scriptGroupType: "lock",
    maxCycles: 3500000000,
  });

  // Args and request
  const [args, setArgs] = useState("server_entry");
  const [jsonRequest, setJsonRequest] = useState("");

  // Execution state
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<DebuggerResult | null>(null);

  // Prefill state for BinaryLoader (used by "Load Demo")
  const [binaryPrefill, setBinaryPrefill] = useState<{
    network: NetworkType;
    txHash: string;
    outputIndex: string;
  } | null>(null);

  // Load demo example
  const handleLoadDemo = useCallback(() => {
    setBinary(null);
    setArgs(DEMO_CONFIG.args);
    setJsonRequest(DEMO_CONFIG.jsonRequest);
    setResult(null);
    // Trigger prefill with a new object reference so useEffect fires
    setBinaryPrefill({
      network: DEMO_CONFIG.network,
      txHash: DEMO_CONFIG.txHash,
      outputIndex: DEMO_CONFIG.outputIndex,
    });
    toast.addToast("success", t("ipc.demoLoaded"));
  }, [toast, t]);

  // Initialize WASM
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsInitializing(true);
      // Initialize IPC runner WASM; also try debugger WASM for mock_tx mode
      const avail = await checkIpcRunnerAvailability();
      try { await initializeWasmer(); } catch { /* ok if not available */ }
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
    try { await initializeWasmer(); } catch { /* ok if not available */ }
    setIsAvailable(avail.available);
    setInitError(avail.available ? null : (avail.error || null));
    setIsInitializing(false);
  }, []);

  // Execute
  const handleExecute = useCallback(async () => {
    if (!binary) {
      toast.addToast("warning", t("ipc.error.loadBinary"));
      return;
    }

    if (!jsonRequest.trim()) {
      toast.addToast("warning", t("ipc.error.enterRequest"));
      return;
    }

    setIsRunning(true);
    setResult(null);
    const startTime = performance.now();

    try {
      const execResult: IpcExecuteResult = await executeScript(
        binary.data,
        args,
        jsonRequest
      );

      const duration = performance.now() - startTime;

      // Format output
      let formattedJson: string;
      try {
        formattedJson = JSON.stringify(JSON.parse(execResult.jsonResponse), null, 2);
      } catch {
        formattedJson = execResult.jsonResponse;
      }

      let stdout = "";
      stdout += `✓ ${t("ipc.executionSuccess")}\n\n`;
      stdout += `${t("ipc.jsonResponse")}:\n${formattedJson}\n\n`;
      stdout += `${t("ipc.cyclesUsed")}: ${execResult.cycles.toLocaleString()}\n`;
      stdout += `${t("ipc.executionTime")}: ${(duration / 1000).toFixed(2)}s`;

      if (execResult.debugMessages.length > 0) {
        stdout += `\n\n${t("ipc.debugOutput")}:\n${execResult.debugMessages.join("\n")}`;
      }

      setResult({
        stdout,
        stderr: "",
        exitCode: 0,
        success: true,
        duration,
      });

      toast.addToast(
        "success",
        `${t("success.executionSuccess")} (${(duration / 1000).toFixed(2)}s)`
      );
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

      // Show only the first line in the toast; full details are in the console
      const shortMessage = errorMessage.split("\n")[0] || errorMessage;
      toast.addToast("error", `${t("error.executionError")}: ${shortMessage}`);
    } finally {
      setIsRunning(false);
    }
  }, [binary, args, jsonRequest, toast, t]);

  // Execute Mock TX
  const handleExecuteMockTx = useCallback(async () => {
    if (!mockTxFile) {
      toast.addToast("warning", t("ipc.error.uploadMockTx"));
      return;
    }

    setIsRunning(true);
    setResult(null);

    try {
      const debugResult = await runMockTxMode({
        mockTx: mockTxFile.content,
        cellIndex: mockTxParams.cellIndex,
        cellType: mockTxParams.cellType,
        scriptGroupType: mockTxParams.scriptGroupType,
        maxCycles: mockTxParams.maxCycles,
      });

      setResult(debugResult);

      if (debugResult.success) {
        toast.addToast(
          "success",
          `${t("success.executionSuccess")} (${(debugResult.duration / 1000).toFixed(2)}s)`
        );
      } else {
        toast.addToast("error", `${t("error.executionFailed")}: ${debugResult.exitCode}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      setResult({
        stdout: "",
        stderr: `${t("ipc.executionError")}: ${errorMessage}`,
        exitCode: 1,
        success: false,
        duration: 0,
      });

      toast.addToast("error", `${t("error.executionError")}: ${errorMessage}`);
    } finally {
      setIsRunning(false);
    }
  }, [mockTxFile, mockTxParams, toast, t]);

  // Clear
  const handleClear = useCallback(() => {
    setJsonRequest("");
    setResult(null);
  }, []);

  const canRun = ipcExecMode === "binary"
    ? isAvailable && !isRunning && binary !== null
    : !isRunning && mockTxFile !== null;

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
                ./scripts/build-vm-wasm.sh
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
          {/* Execution mode toggle */}
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setIpcExecMode("binary")}
              className={`
                flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors
                ${ipcExecMode === "binary"
                  ? "bg-white text-blue-700 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"}
              `}
            >
              {t("ipc.modeBinary")}
            </button>
            <button
              onClick={() => setIpcExecMode("mockTx")}
              className={`
                flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors
                ${ipcExecMode === "mockTx"
                  ? "bg-white text-blue-700 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"}
              `}
            >
              {t("ipc.modeMockTx")}
            </button>
          </div>

          {ipcExecMode === "binary" ? (
            <>
              {/* Demo button */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-blue-800">{t("ipc.demoTitle")}</h3>
                    <p className="text-xs text-blue-600 mt-1">{t("ipc.demoDescription")}</p>
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

              {/* Binary loader */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-medium text-gray-900 mb-4">
                  {t("ipc.step1")}
                </h2>
                <BinaryLoader
                  onBinaryReady={setBinary}
                  binary={binary}
                  onClear={() => setBinary(null)}
                  disabled={isRunning}
                  prefill={binaryPrefill}
                />
              </div>

              {/* Server arguments */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-medium text-gray-900 mb-4">
                  {t("ipc.step2")}
                </h2>
                <p className="text-xs text-gray-500 mb-2">
                  {t("ipc.argsHelp")}
                </p>
                <input
                  type="text"
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  disabled={isRunning}
                  placeholder="server_entry"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                />
              </div>

              {/* JSON request */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-medium text-gray-900 mb-4">
                  {t("ipc.step3")}
                </h2>
                <p className="text-xs text-gray-500 mb-2">
                  {t("ipc.requestHelp")}
                </p>
                <textarea
                  value={jsonRequest}
                  onChange={(e) => setJsonRequest(e.target.value)}
                  disabled={isRunning}
                  rows={6}
                  placeholder='{"TestPrimitiveTypes":{"arg1":1,"arg2":2,"arg3":3}}'
                  spellCheck={false}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 resize-y"
                />
              </div>
            </>
          ) : (
            <>
              {/* Mock TX file upload */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-medium text-gray-900 mb-4">
                  {t("ipc.mockTxStep1")}
                </h2>
                <FileUploader
                  label={t("fileUpload.mockTxJson")}
                  accept=".json"
                  helpText={t("fileUpload.mockTxHelp")}
                  file={mockTxFile}
                  onFileChange={setMockTxFile}
                  disabled={isRunning}
                />
              </div>

              {/* Script parameters */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-medium text-gray-900 mb-4">
                  {t("ipc.mockTxStep2")}
                </h2>
                <MockTxParamsEditor
                  params={mockTxParams}
                  onChange={setMockTxParams}
                  disabled={isRunning}
                />
              </div>
            </>
          )}

          {/* Execute / Clear buttons */}
          <div className="flex space-x-3">
            <button
              onClick={ipcExecMode === "binary" ? handleExecute : handleExecuteMockTx}
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
