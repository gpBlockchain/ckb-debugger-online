import { useState, useCallback } from "react";
import {
  ArrowDownTrayIcon,
  MagnifyingGlassIcon,
  DocumentTextIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@heroicons/react/24/outline";
import type { UploadedFile } from "./FileUploader";
import {
  type NetworkType,
  type ConversionProgress,
  createClient,
  fetchTransaction,
  convertToMockTx,
  parseRawTxJson,
  parseTransactionView,
  mockTxToBytes,
} from "../lib/txConverter";
import { useI18n } from "../lib/i18n";

interface TxFetcherProps {
  /** 获取成功后的回调 */
  onMockTxReady: (file: UploadedFile) => void;
  /** 是否禁用 */
  disabled?: boolean;
}

type InputMode = "hash" | "json" | "molecule";

// Network RPC endpoints
const NETWORK_RPC = {
  mainnet: "https://mainnet.ckbapp.dev/rpc",
  testnet: "https://testnet.ckbapp.dev/rpc",
} as const;

export function TxFetcher({ onMockTxReady, disabled = false }: TxFetcherProps) {
  const { t } = useI18n();
  
  // 网络配置
  const [network, setNetwork] = useState<NetworkType>("testnet");
  const [customRpc, setCustomRpc] = useState("");
  
  // 输入模式
  const [inputMode, setInputMode] = useState<InputMode>("hash");
  
  // 输入值
  const [txHash, setTxHash] = useState("");
  const [rawTxJson, setRawTxJson] = useState("");
  const [moleculeHex, setMoleculeHex] = useState("");
  
  // 状态
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<ConversionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  // 展开/折叠状态
  const [isExpanded, setIsExpanded] = useState(true);

  // 获取当前 RPC URL
  const getCurrentRpc = useCallback(() => {
    if (network === "custom") {
      return customRpc;
    }
    return NETWORK_RPC[network];
  }, [network, customRpc]);

  // 验证交易哈希格式
  const isValidTxHash = useCallback((hash: string) => {
    return /^0x[a-fA-F0-9]{64}$/.test(hash);
  }, []);

  // 从链上获取交易并转换
  const handleFetchByHash = useCallback(async () => {
    if (!txHash.trim()) {
      setError(t("error.enterTxHash"));
      return;
    }

    if (!isValidTxHash(txHash)) {
      setError(t("error.invalidTxHash"));
      return;
    }

    if (network === "custom" && !customRpc.trim()) {
      setError(t("error.enterCustomRpc"));
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(false);
    setProgress({ stage: "fetching_tx", current: 0, total: 1, message: t("progress.fetchingTx") });

    try {
      const client = createClient(network, customRpc);
      const tx = await fetchTransaction(client, txHash);
      
      const mockTx = await convertToMockTx(client, tx, setProgress);
      const content = mockTxToBytes(mockTx);
      
      onMockTxReady({
        name: `mock_tx_${txHash.slice(0, 10)}.json`,
        content,
        size: content.length,
      });
      
      setSuccess(true);
      setProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProgress(null);
    } finally {
      setIsLoading(false);
    }
  }, [txHash, network, customRpc, isValidTxHash, onMockTxReady, t]);

  // 从 JSON 转换
  const handleConvertFromJson = useCallback(async () => {
    if (!rawTxJson.trim()) {
      setError(t("error.enterTxJson"));
      return;
    }

    if (network === "custom" && !customRpc.trim()) {
      setError(t("error.enterCustomRpc"));
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(false);
    setProgress({ stage: "fetching_tx", current: 0, total: 1, message: t("progress.parsingTx") });

    try {
      const tx = parseRawTxJson(rawTxJson);
      const client = createClient(network, customRpc);
      
      const mockTx = await convertToMockTx(client, tx, setProgress);
      const content = mockTxToBytes(mockTx);
      
      onMockTxReady({
        name: `mock_tx_converted.json`,
        content,
        size: content.length,
      });
      
      setSuccess(true);
      setProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProgress(null);
    } finally {
      setIsLoading(false);
    }
  }, [rawTxJson, network, customRpc, onMockTxReady, t]);

  // 从 TransactionView (molecule hex) 转换
  const handleConvertFromMolecule = useCallback(async () => {
    if (!moleculeHex.trim()) {
      setError(t("error.enterTransactionView"));
      return;
    }

    if (network === "custom" && !customRpc.trim()) {
      setError(t("error.enterCustomRpc"));
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(false);
    setProgress({ stage: "fetching_tx", current: 0, total: 1, message: t("progress.parsingTransactionView") });

    try {
      const tx = parseTransactionView(moleculeHex);
      const client = createClient(network, customRpc);
      
      const mockTx = await convertToMockTx(client, tx, setProgress);
      const content = mockTxToBytes(mockTx);
      
      onMockTxReady({
        name: `mock_tx_from_view.json`,
        content,
        size: content.length,
      });
      
      setSuccess(true);
      setProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProgress(null);
    } finally {
      setIsLoading(false);
    }
  }, [moleculeHex, network, customRpc, onMockTxReady, t]);

  // 进度条组件
  const ProgressBar = () => {
    if (!progress) return null;
    
    const percent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
    
    return (
      <div className="mt-3">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>{progress.message}</span>
          <span>{Math.round(percent)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* 标题栏（可折叠） */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between text-left"
        disabled={disabled}
      >
        <div className="flex items-center space-x-2">
          <ArrowDownTrayIcon className="h-5 w-5 text-blue-500" />
          <span className="text-sm font-medium text-gray-700">{t("txFetcher.title")}</span>
        </div>
        {isExpanded ? (
          <ChevronUpIcon className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronDownIcon className="h-4 w-4 text-gray-400" />
        )}
      </button>

      {isExpanded && (
        <div className="space-y-4 pl-7">
          {/* 网络选择 */}
          <div className="flex items-center space-x-4">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">{t("txFetcher.network")}</label>
              <select
                value={network}
                onChange={(e) => setNetwork(e.target.value as NetworkType)}
                disabled={disabled || isLoading}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              >
                <option value="mainnet">{t("txFetcher.mainnet")}</option>
                <option value="testnet">{t("txFetcher.testnet")}</option>
                <option value="custom">{t("txFetcher.customRpc")}</option>
              </select>
            </div>
            
            {network === "custom" ? (
              <div className="flex-[2]">
                <label className="block text-xs text-gray-500 mb-1">{t("txFetcher.rpcAddress")}</label>
                <input
                  type="text"
                  value={customRpc}
                  onChange={(e) => setCustomRpc(e.target.value)}
                  placeholder="https://your-node.com/rpc"
                  disabled={disabled || isLoading}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                />
              </div>
            ) : (
              <div className="flex-[2]">
                <label className="block text-xs text-gray-500 mb-1">{t("txFetcher.rpcAddress")}</label>
                <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
                  {getCurrentRpc()}
                </div>
              </div>
            )}
          </div>

          {/* 输入模式选择 */}
          <div className="flex space-x-2">
            <button
              type="button"
              onClick={() => setInputMode("hash")}
              disabled={disabled || isLoading}
              className={`flex-1 flex items-center justify-center space-x-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                inputMode === "hash"
                  ? "bg-blue-50 text-blue-700 border-2 border-blue-500"
                  : "bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100"
              } disabled:opacity-50`}
            >
              <MagnifyingGlassIcon className="h-4 w-4" />
              <span>{t("txFetcher.txHash")}</span>
            </button>
            <button
              type="button"
              onClick={() => setInputMode("json")}
              disabled={disabled || isLoading}
              className={`flex-1 flex items-center justify-center space-x-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                inputMode === "json"
                  ? "bg-blue-50 text-blue-700 border-2 border-blue-500"
                  : "bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100"
              } disabled:opacity-50`}
            >
              <DocumentTextIcon className="h-4 w-4" />
              <span>{t("txFetcher.rawTxJson")}</span>
            </button>
            <button
              type="button"
              onClick={() => setInputMode("molecule")}
              disabled={disabled || isLoading}
              className={`flex-1 flex items-center justify-center space-x-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                inputMode === "molecule"
                  ? "bg-blue-50 text-blue-700 border-2 border-blue-500"
                  : "bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100"
              } disabled:opacity-50`}
            >
              <DocumentTextIcon className="h-4 w-4" />
              <span>{t("txFetcher.transactionView")}</span>
            </button>
          </div>

          {/* 输入区域 */}
          {inputMode === "hash" && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("txFetcher.txHash")}</label>
              <div className="flex space-x-2">
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
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={handleFetchByHash}
                  disabled={disabled || isLoading || !txHash.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {isLoading ? (
                    <>
                      <ArrowPathIcon className="h-4 w-4 animate-spin" />
                      <span>{t("txFetcher.fetching")}</span>
                    </>
                  ) : (
                    <>
                      <ArrowDownTrayIcon className="h-4 w-4" />
                      <span>{t("txFetcher.fetch")}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
          {inputMode === "json" && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("txFetcher.rawTxJson")}</label>
              <textarea
                value={rawTxJson}
                onChange={(e) => {
                  setRawTxJson(e.target.value);
                  setError(null);
                  setSuccess(false);
                }}
                placeholder='{"version": "0x0", "cell_deps": [...], "inputs": [...], ...}'
                disabled={disabled || isLoading}
                rows={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 resize-y"
              />
              <button
                type="button"
                onClick={handleConvertFromJson}
                disabled={disabled || isLoading || !rawTxJson.trim()}
                className="mt-2 w-full px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                {isLoading ? (
                  <>
                    <ArrowPathIcon className="h-4 w-4 animate-spin" />
                    <span>{t("txFetcher.converting")}</span>
                  </>
                ) : (
                  <>
                    <ArrowDownTrayIcon className="h-4 w-4" />
                    <span>{t("txFetcher.convert")}</span>
                  </>
                )}
              </button>
            </div>
          )}
          {inputMode === "molecule" && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("txFetcher.transactionView")} (Molecule Hex)</label>
              <textarea
                value={moleculeHex}
                onChange={(e) => {
                  setMoleculeHex(e.target.value);
                  setError(null);
                  setSuccess(false);
                }}
                placeholder="TransactionView { data: Transaction(0x...) } or 0x..."
                disabled={disabled || isLoading}
                rows={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 resize-y"
              />
              <button
                type="button"
                onClick={handleConvertFromMolecule}
                disabled={disabled || isLoading || !moleculeHex.trim()}
                className="mt-2 w-full px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                {isLoading ? (
                  <>
                    <ArrowPathIcon className="h-4 w-4 animate-spin" />
                    <span>{t("txFetcher.converting")}</span>
                  </>
                ) : (
                  <>
                    <ArrowDownTrayIcon className="h-4 w-4" />
                    <span>{t("txFetcher.convert")}</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* 进度条 */}
          <ProgressBar />

          {/* 错误提示 */}
          {error && (
            <div className="flex items-start space-x-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <ExclamationCircleIcon className="h-5 w-5 text-red-500 flex-shrink-0" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* 成功提示 */}
          {success && (
            <div className="flex items-start space-x-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircleIcon className="h-5 w-5 text-green-500 flex-shrink-0" />
              <p className="text-sm text-green-700">{t("txFetcher.success")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
