/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

// Supported languages
export type Language = "en" | "zh";

// Translation key type
type TranslationKey = string;
type TranslationParams = Record<string, string | number>;

// Translation dictionary structure
type TranslationDict = Record<TranslationKey, string>;

// English translations (default)
const en: TranslationDict = {
  // App header
  "app.title": "CKB Debugger Online",
  "app.subtitle": "Run CKB contract debugger in browser",
  
  // File upload section
  "fileUpload.title": "File Upload",
  "fileUpload.fetchFromChain": "Fetch Transaction from Chain",
  "fileUpload.orManualUpload": "or upload manually",
  "fileUpload.mockTxJson": "Mock TX JSON",
  "fileUpload.mockTxHelp": "Upload mock_tx.json transaction file",
  "fileUpload.binaryReplacement": "Binary Replacement File (optional)",
  "fileUpload.binaryHelp": "Used to replace binary files referenced in scripts",
  "fileUpload.dropzone": "Drag and drop file here, or",
  "fileUpload.clickToSelect": "click to select",
  
  // Parameters section
  "params.title": "Parameters",
  "params.cellIndex": "Cell Index",
  "params.cellType": "Cell Type",
  "params.scriptGroupType": "Script Group Type",
  "params.maxCycles": "Max Cycles",
  "params.equivalentCommand": "Equivalent Command:",
  
  // Run buttons
  "run.single": "Run Single Script",
  "run.all": "Run All Scripts",
  "run.running": "Running...",
  
  // Output console
  "output.title": "Output",
  "output.running": "Running...",
  "output.executing": "Executing contract...",
  "output.noOutput": "(No output)",
  "output.placeholder": "Output will appear here after running the debugger",
  "output.copyTitle": "Copy output",
  
  // Transaction fetcher
  "txFetcher.title": "Fetch Transaction from Chain",
  "txFetcher.network": "Network",
  "txFetcher.rpcAddress": "RPC Address",
  "txFetcher.customRpc": "Custom RPC",
  "txFetcher.txHash": "Transaction Hash",
  "txFetcher.rawTxJson": "Raw TX JSON",
  "txFetcher.transactionView": "TransactionView",
  "txFetcher.fetch": "Fetch",
  "txFetcher.fetching": "Fetching",
  "txFetcher.convert": "Convert to MockTx",
  "txFetcher.converting": "Converting",
  "txFetcher.success": "MockTx generated, ready to debug",
  "txFetcher.mainnet": "Mainnet",
  "txFetcher.testnet": "Testnet",
  
  // Error messages
  "error.uploadMockTx": "Please upload mock_tx.json file first",
  "error.enterTxHash": "Please enter transaction hash",
  "error.invalidTxHash": "Invalid transaction hash format, should be 0x followed by 64 hex characters",
  "error.enterCustomRpc": "Please enter custom RPC address",
  "error.enterTxJson": "Please enter transaction JSON",
  "error.enterTransactionView": "Please enter TransactionView data",
  "error.provideRpc": "Please provide a valid RPC address",
  "error.txNotFound": "Transaction not found",
  "error.cannotGetTx": "Cannot get transaction",
  "error.cellIndexOutOfBounds": "Cell index out of bounds",
  "error.invalidTransactionView": "Invalid TransactionView format, please enter hex data",
  "error.transactionViewTooShort": "TransactionView data too short",
  "error.parseTransactionViewFailed": "Failed to parse TransactionView",
  
  // Success messages
  "success.debuggerReady": "Debugger is ready",
  "success.mockTxGenerated": "MockTx generated",
  "success.executionSuccess": "Execution successful",
  "success.verificationSuccess": "Verification successful, total Cycles",
  
  // Error/warning messages
  "warning.initWarning": "Initialization Warning",
  "warning.runWasmScript": "Please run",
  "warning.toCompileWasm": "to compile WASM module",
  "warning.retry": "Retry",
  "error.executionFailed": "Execution failed, exit code",
  "error.executionError": "Execution error",
  "error.partialFailure": "Some scripts failed",
  
  // Error boundary
  "errorBoundary.title": "Something went wrong",
  "errorBoundary.description": "The application encountered an error. This may be due to browser incompatibility or WASM module loading failure.",
  "errorBoundary.reload": "Reload",
  "errorBoundary.browserSupport": "If the problem persists, please check if your browser supports WebAssembly and SharedArrayBuffer",
  
  // Progress messages
  "progress.fetchingTx": "Fetching transaction...",
  "progress.parsingTx": "Parsing transaction...",
  "progress.parsingTransactionView": "Parsing TransactionView...",
  "progress.fetchingInputCells": "Fetching input Cells",
  "progress.fetchingCellDeps": "Fetching cell dependencies",
  "progress.fetchingHeaders": "Fetching block headers",
  "progress.conversionComplete": "Conversion complete",
};

// Chinese translations
const zh: TranslationDict = {
  // App header
  "app.title": "CKB Debugger Online",
  "app.subtitle": "在浏览器中运行 CKB 合约调试器",
  
  // File upload section
  "fileUpload.title": "文件上传",
  "fileUpload.fetchFromChain": "从链上获取交易",
  "fileUpload.orManualUpload": "或手动上传文件",
  "fileUpload.mockTxJson": "Mock TX JSON",
  "fileUpload.mockTxHelp": "上传 mock_tx.json 交易文件",
  "fileUpload.binaryReplacement": "二进制替换文件 (可选)",
  "fileUpload.binaryHelp": "用于替换脚本中引用的二进制文件",
  "fileUpload.dropzone": "拖放文件到这里，或",
  "fileUpload.clickToSelect": "点击选择",
  
  // Parameters section
  "params.title": "参数配置",
  "params.cellIndex": "Cell Index",
  "params.cellType": "Cell Type",
  "params.scriptGroupType": "Script Group Type",
  "params.maxCycles": "最大 Cycles",
  "params.equivalentCommand": "等效命令：",
  
  // Run buttons
  "run.single": "运行单个脚本",
  "run.all": "一键执行全部",
  "run.running": "运行中...",
  
  // Output console
  "output.title": "输出",
  "output.running": "运行中...",
  "output.executing": "正在执行合约...",
  "output.noOutput": "(无输出)",
  "output.placeholder": "运行调试器后输出将显示在这里",
  "output.copyTitle": "复制输出",
  
  // Transaction fetcher
  "txFetcher.title": "从链上获取交易",
  "txFetcher.network": "网络",
  "txFetcher.rpcAddress": "RPC 地址",
  "txFetcher.customRpc": "自定义 RPC",
  "txFetcher.txHash": "交易哈希",
  "txFetcher.rawTxJson": "Raw TX JSON",
  "txFetcher.transactionView": "TransactionView",
  "txFetcher.fetch": "获取",
  "txFetcher.fetching": "获取中",
  "txFetcher.convert": "转换为 MockTx",
  "txFetcher.converting": "转换中",
  "txFetcher.success": "MockTx 已生成，可以开始调试",
  "txFetcher.mainnet": "主网",
  "txFetcher.testnet": "测试网",
  
  // Error messages
  "error.uploadMockTx": "请先上传 mock_tx.json 文件",
  "error.enterTxHash": "请输入交易哈希",
  "error.invalidTxHash": "交易哈希格式不正确，应为 0x 开头的 64 位十六进制字符串",
  "error.enterCustomRpc": "请输入自定义 RPC 地址",
  "error.enterTxJson": "请输入交易 JSON",
  "error.enterTransactionView": "请输入 TransactionView 数据",
  "error.provideRpc": "请提供有效的 RPC 地址",
  "error.txNotFound": "交易不存在",
  "error.cannotGetTx": "无法获取交易",
  "error.cellIndexOutOfBounds": "Cell 索引越界",
  "error.invalidTransactionView": "无效的 TransactionView 格式，请输入十六进制数据",
  "error.transactionViewTooShort": "TransactionView 数据太短",
  "error.parseTransactionViewFailed": "解析 TransactionView 失败",
  
  // Success messages
  "success.debuggerReady": "调试器已就绪",
  "success.mockTxGenerated": "MockTx 已生成",
  "success.executionSuccess": "执行成功",
  "success.verificationSuccess": "验证成功，总 Cycles",
  
  // Error/warning messages
  "warning.initWarning": "初始化警告",
  "warning.runWasmScript": "请运行",
  "warning.toCompileWasm": "编译 WASM 模块",
  "warning.retry": "重试",
  "error.executionFailed": "执行失败，退出码",
  "error.executionError": "执行出错",
  "error.partialFailure": "部分脚本执行失败",
  
  // Error boundary
  "errorBoundary.title": "出错了",
  "errorBoundary.description": "应用程序遇到了一个错误。这可能是由于浏览器不支持某些功能或 WASM 模块加载失败。",
  "errorBoundary.reload": "重新加载",
  "errorBoundary.browserSupport": "如果问题持续存在，请检查浏览器是否支持 WebAssembly 和 SharedArrayBuffer",
  
  // Progress messages
  "progress.fetchingTx": "正在获取交易...",
  "progress.parsingTx": "正在解析交易...",
  "progress.parsingTransactionView": "正在解析 TransactionView...",
  "progress.fetchingInputCells": "正在获取输入 Cells",
  "progress.fetchingCellDeps": "正在获取依赖 Cells",
  "progress.fetchingHeaders": "正在获取区块头",
  "progress.conversionComplete": "转换完成",
};

// All translations
const translations: Record<Language, TranslationDict> = { en, zh };

// i18n context
interface I18nContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

// Storage key for persisting language preference
const LANGUAGE_STORAGE_KEY = "ckb-debugger-language";

// Get initial language from localStorage or browser settings
function getInitialLanguage(): Language {
  // Check localStorage first
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "en" || stored === "zh") {
      return stored;
    }
    
    // Check browser language
    const browserLang = navigator.language.toLowerCase();
    if (browserLang.startsWith("zh")) {
      return "zh";
    }
  }
  
  // Default to English
  return "en";
}

// Provider component
interface I18nProviderProps {
  children: ReactNode;
}

export function I18nProvider({ children }: I18nProviderProps) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    // Update document lang attribute
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, []);

  const t = useCallback((key: TranslationKey, params?: TranslationParams): string => {
    let text = translations[language][key] || translations.en[key] || key;
    
    // Replace parameters
    if (params) {
      Object.entries(params).forEach(([paramKey, value]) => {
        text = text.replace(new RegExp(`\\{${paramKey}\\}`, "g"), String(value));
      });
    }
    
    return text;
  }, [language]);

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
}

// Hook to use i18n
export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}

// Language switcher component
export function LanguageSwitcher() {
  const { language, setLanguage } = useI18n();

  return (
    <div className="flex items-center space-x-2">
      <button
        onClick={() => setLanguage("en")}
        className={`px-2 py-1 text-sm rounded transition-colors ${
          language === "en"
            ? "bg-blue-100 text-blue-700 font-medium"
            : "text-gray-600 hover:text-gray-900"
        }`}
      >
        EN
      </button>
      <span className="text-gray-300">|</span>
      <button
        onClick={() => setLanguage("zh")}
        className={`px-2 py-1 text-sm rounded transition-colors ${
          language === "zh"
            ? "bg-blue-100 text-blue-700 font-medium"
            : "text-gray-600 hover:text-gray-900"
        }`}
      >
        中文
      </button>
    </div>
  );
}
