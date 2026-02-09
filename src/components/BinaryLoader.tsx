import { useState, useCallback, useEffect } from "react";
import {
  ArrowUpTrayIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  DocumentIcon,
  XMarkIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  MagnifyingGlassIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@heroicons/react/24/outline";
import type { NetworkType } from "../lib/txConverter";
import { createClient } from "../lib/txConverter";
import { hexToBytes } from "../lib/ipcRunner";
import { useI18n } from "../lib/i18n";

export interface LoadedBinary {
  name: string;
  data: Uint8Array;
  size: number;
}

interface BinaryLoaderProps {
  /** Binary loaded callback */
  onBinaryReady: (binary: LoadedBinary) => void;
  /** Currently loaded binary */
  binary: LoadedBinary | null;
  /** Clear binary callback */
  onClear: () => void;
  /** Whether disabled */
  disabled?: boolean;
  /** Pre-fill values for the fetch-from-chain panel (e.g. from demo) */
  prefill?: {
    network: NetworkType;
    txHash: string;
    outputIndex: string;
  } | null;
}

// Network RPC endpoints
const NETWORK_RPC = {
  mainnet: "https://mainnet.ckbapp.dev/rpc",
  testnet: "https://testnet.ckbapp.dev/rpc",
} as const;

export function BinaryLoader({
  onBinaryReady,
  binary,
  onClear,
  disabled = false,
  prefill,
}: BinaryLoaderProps) {
  const { t } = useI18n();
  const [isDragging, setIsDragging] = useState(false);
  const [showFetchPanel, setShowFetchPanel] = useState(false);

  // Fetch from chain state
  const [network, setNetwork] = useState<NetworkType>("testnet");
  const [customRpc, setCustomRpc] = useState("");
  const [txHash, setTxHash] = useState("");
  const [outputIndex, setOutputIndex] = useState("0");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Apply prefill values when they change (e.g. from demo button)
  useEffect(() => {
    if (prefill) {
      setNetwork(prefill.network);
      setTxHash(prefill.txHash);
      setOutputIndex(prefill.outputIndex);
      setShowFetchPanel(true);
      setError(null);
      setSuccess(false);
    }
  }, [prefill]);

  const getCurrentRpc = useCallback(() => {
    if (network === "custom") return customRpc;
    return NETWORK_RPC[network];
  }, [network, customRpc]);

  // Handle file upload
  const handleFile = useCallback(
    async (file: File) => {
      const arrayBuffer = await file.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);
      onBinaryReady({
        name: file.name,
        data,
        size: data.length,
      });
    },
    [onBinaryReady]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) setIsDragging(true);
    },
    [disabled]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (disabled) return;
      const files = e.dataTransfer.files;
      if (files.length > 0) handleFile(files[0]);
    },
    [disabled, handleFile]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) handleFile(files[0]);
    },
    [handleFile]
  );

  // Fetch binary from chain via get_transaction
  const handleFetchFromChain = useCallback(async () => {
    if (!txHash.trim()) {
      setError(t("ipc.error.enterTxHash"));
      return;
    }

    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      setError(t("error.invalidTxHash"));
      return;
    }

    if (network === "custom" && !customRpc.trim()) {
      setError(t("error.enterCustomRpc"));
      return;
    }

    const idx = parseInt(outputIndex, 10);
    if (isNaN(idx) || idx < 0) {
      setError(t("ipc.error.invalidOutputIndex"));
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const client = createClient(network, customRpc);
      const result = await client.getTransaction(txHash);

      if (!result) {
        throw new Error(t("error.txNotFound"));
      }

      const tx = result.transaction;

      if (idx >= tx.outputsData.length) {
        throw new Error(
          `${t("error.cellIndexOutOfBounds")}: ${idx} >= ${tx.outputsData.length}`
        );
      }

      const dataHex = tx.outputsData[idx];
      if (!dataHex || dataHex === "0x") {
        throw new Error(t("ipc.error.emptyCellData"));
      }

      const binaryData = hexToBytes(dataHex);

      onBinaryReady({
        name: `cell_${txHash.slice(0, 10)}_${idx}`,
        data: binaryData,
        size: binaryData.length,
      });

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [txHash, outputIndex, network, customRpc, onBinaryReady, t]);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">
        {t("ipc.loadBinary")}
      </label>

      {binary ? (
        // Loaded binary display
        <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="flex items-center space-x-3">
            <DocumentIcon className="h-8 w-8 text-blue-500" />
            <div>
              <p className="text-sm font-medium text-gray-900">{binary.name}</p>
              <p className="text-xs text-gray-500">{formatSize(binary.size)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            className="p-1 text-gray-400 hover:text-red-500 disabled:opacity-50 transition-colors"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
      ) : (
        // Upload area
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            dropzone cursor-pointer
            ${isDragging ? "active" : ""}
            ${disabled ? "opacity-50 cursor-not-allowed" : ""}
          `}
        >
          <input
            type="file"
            onChange={handleInputChange}
            disabled={disabled}
            className="hidden"
            id="binary-upload"
          />
          <label
            htmlFor="binary-upload"
            className={`flex flex-col items-center ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
          >
            <ArrowUpTrayIcon className="h-10 w-10 text-gray-400 mb-2" />
            <span className="text-sm text-gray-600">
              {t("fileUpload.dropzone")}{" "}
              <span className="text-blue-500 hover:underline">
                {t("fileUpload.clickToSelect")}
              </span>
            </span>
            <span className="text-xs text-gray-400 mt-1">
              {t("ipc.binaryHelp")}
            </span>
          </label>
        </div>
      )}

      {/* Fetch from chain section */}
      <button
        type="button"
        onClick={() => setShowFetchPanel(!showFetchPanel)}
        className="w-full flex items-center justify-between text-left py-1"
        disabled={disabled}
      >
        <div className="flex items-center space-x-2">
          <ArrowDownTrayIcon className="h-4 w-4 text-blue-500" />
          <span className="text-xs font-medium text-gray-600">
            {t("ipc.fetchFromChain")}
          </span>
        </div>
        {showFetchPanel ? (
          <ChevronUpIcon className="h-3 w-3 text-gray-400" />
        ) : (
          <ChevronDownIcon className="h-3 w-3 text-gray-400" />
        )}
      </button>

      {showFetchPanel && (
        <div className="space-y-3 pl-6 border-l-2 border-blue-200">
          {/* Network selection */}
          <div className="flex items-center space-x-3">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">
                {t("txFetcher.network")}
              </label>
              <select
                value={network}
                onChange={(e) => setNetwork(e.target.value as NetworkType)}
                disabled={disabled || isLoading}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              >
                <option value="mainnet">{t("txFetcher.mainnet")}</option>
                <option value="testnet">{t("txFetcher.testnet")}</option>
                <option value="custom">{t("txFetcher.customRpc")}</option>
              </select>
            </div>
            {network === "custom" ? (
              <div className="flex-[2]">
                <label className="block text-xs text-gray-500 mb-1">
                  {t("txFetcher.rpcAddress")}
                </label>
                <input
                  type="text"
                  value={customRpc}
                  onChange={(e) => setCustomRpc(e.target.value)}
                  placeholder="https://your-node.com/rpc"
                  disabled={disabled || isLoading}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                />
              </div>
            ) : (
              <div className="flex-[2]">
                <label className="block text-xs text-gray-500 mb-1">
                  {t("txFetcher.rpcAddress")}
                </label>
                <div className="px-2 py-1.5 bg-gray-50 border border-gray-200 rounded text-xs text-gray-600">
                  {getCurrentRpc()}
                </div>
              </div>
            )}
          </div>

          {/* TX Hash and Output Index */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              {t("txFetcher.txHash")}
            </label>
            <input
              type="text"
              value={txHash}
              onChange={(e) => {
                setTxHash(e.target.value);
                setError(null);
                setSuccess(false);
              }}
              placeholder="0x..."
              disabled={disabled || isLoading}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
            />
          </div>

          <div className="flex items-end space-x-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">
                {t("ipc.outputIndex")}
              </label>
              <input
                type="number"
                min="0"
                value={outputIndex}
                onChange={(e) => {
                  setOutputIndex(e.target.value);
                  setError(null);
                  setSuccess(false);
                }}
                disabled={disabled || isLoading}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              />
            </div>
            <button
              type="button"
              onClick={handleFetchFromChain}
              disabled={disabled || isLoading || !txHash.trim()}
              className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1"
            >
              {isLoading ? (
                <>
                  <ArrowPathIcon className="h-3 w-3 animate-spin" />
                  <span>{t("txFetcher.fetching")}</span>
                </>
              ) : (
                <>
                  <MagnifyingGlassIcon className="h-3 w-3" />
                  <span>{t("txFetcher.fetch")}</span>
                </>
              )}
            </button>
          </div>

          {/* Error/success */}
          {error && (
            <div className="flex items-start space-x-2 p-2 bg-red-50 border border-red-200 rounded">
              <ExclamationCircleIcon className="h-4 w-4 text-red-500 flex-shrink-0" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}
          {success && (
            <div className="flex items-start space-x-2 p-2 bg-green-50 border border-green-200 rounded">
              <CheckCircleIcon className="h-4 w-4 text-green-500 flex-shrink-0" />
              <p className="text-xs text-green-700">
                {t("ipc.binaryFetched")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
