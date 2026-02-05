import { useState, useCallback, useEffect } from "react";
import { PlayIcon, ArrowPathIcon, ExclamationTriangleIcon } from "@heroicons/react/24/solid";
import { useDebugger } from "./hooks/useDebugger";
import {
  FileUploader,
  MockTxParamsEditor,
  OutputConsole,
  TxFetcher,
  useToast,
  type UploadedFile,
  type MockTxParams,
} from "./components";

function App() {
  const debugger_ = useDebugger();
  const toast = useToast();
  
  // 文件状态
  const [mockTxFile, setMockTxFile] = useState<UploadedFile | null>(null);
  const [replacementFile, setReplacementFile] = useState<UploadedFile | null>(null);
  
  // 参数状态
  const [mockTxParams, setMockTxParams] = useState<MockTxParams>({
    cellIndex: 0,
    cellType: "input",
    scriptGroupType: "lock",
    maxCycles: 3500000000,
  });

  // 运行调试器
  const handleRun = useCallback(async () => {
    if (!mockTxFile) {
      toast.addToast("warning", "请先上传 mock_tx.json 文件");
      return;
    }
    
    try {
      const result = await debugger_.runMockTx({
        mockTx: mockTxFile.content,
        cellIndex: mockTxParams.cellIndex,
        cellType: mockTxParams.cellType,
        scriptGroupType: mockTxParams.scriptGroupType,
        maxCycles: mockTxParams.maxCycles,
        binaryReplacement: replacementFile
          ? { content: replacementFile.content, name: replacementFile.name }
          : undefined,
      });
      
      if (result.success) {
        toast.addToast("success", `执行成功 (${(result.duration / 1000).toFixed(2)}s)`);
      } else {
        toast.addToast("error", `执行失败，退出码: ${result.exitCode}`);
      }
    } catch (error) {
      toast.addToast("error", `执行出错: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [debugger_, mockTxFile, replacementFile, mockTxParams, toast]);

  // 一键执行所有脚本组
  const handleRunAll = useCallback(async () => {
    if (!mockTxFile) {
      toast.addToast("warning", "请先上传 mock_tx.json 文件");
      return;
    }
    
    try {
      const result = await debugger_.runAllScripts({
        mockTx: mockTxFile.content,
        maxCycles: mockTxParams.maxCycles,
        binaryReplacement: replacementFile
          ? { content: replacementFile.content, name: replacementFile.name }
          : undefined,
      });
      
      if (result.allSuccess) {
        toast.addToast("success", `验证成功，总 Cycles: ${result.totalCycles.toLocaleString()}`);
      } else {
        toast.addToast("error", "部分脚本执行失败");
      }
    } catch (error) {
      toast.addToast("error", `执行出错: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [debugger_, mockTxFile, replacementFile, mockTxParams.maxCycles, toast]);

  // 监听初始化状态
  useEffect(() => {
    if (debugger_.isInitialized && debugger_.wasmAvailable) {
      toast.addToast("success", "调试器已就绪");
    }
  }, [debugger_.isInitialized, debugger_.wasmAvailable]);

  // 检查是否可以运行
  const canRun = debugger_.isInitialized && !debugger_.isRunning && mockTxFile !== null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 头部 */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">CKB Debugger Online</h1>
              <p className="text-sm text-gray-500 mt-1">在浏览器中运行 CKB 合约调试器</p>
            </div>
            <a
              href="https://github.com/nervosnetwork/ckb-standalone-debugger"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              GitHub
            </a>
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {/* 错误提示 */}
        {debugger_.initError && (
          <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start space-x-3">
            <ExclamationTriangleIcon className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-medium text-yellow-800">初始化警告</h3>
              <p className="text-sm text-yellow-700 mt-1">{debugger_.initError}</p>
              {!debugger_.wasmAvailable && (
                <p className="text-sm text-yellow-700 mt-2">
                  请运行 <code className="bg-yellow-100 px-1 rounded">./scripts/build-wasm.sh</code> 编译 WASM 模块
                </p>
              )}
              <button
                onClick={debugger_.reinitialize}
                className="mt-2 text-sm text-yellow-800 hover:text-yellow-900 flex items-center space-x-1"
              >
                <ArrowPathIcon className="h-4 w-4" />
                <span>重试</span>
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 左侧：配置面板 */}
          <div className="space-y-6">
            {/* 文件上传 */}
            <div className="bg-white rounded-lg shadow p-6 space-y-4">
              <h2 className="text-lg font-medium text-gray-900">文件上传</h2>
              
              {/* 从链上获取交易 */}
              <TxFetcher
                onMockTxReady={(file) => {
                  setMockTxFile(file);
                  toast.addToast("success", "MockTx 已生成");
                }}
                disabled={debugger_.isRunning}
              />
              
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white px-2 text-gray-400">或手动上传文件</span>
                </div>
              </div>
              
              <FileUploader
                label="Mock TX JSON"
                accept=".json"
                helpText="上传 mock_tx.json 交易文件"
                file={mockTxFile}
                onFileChange={setMockTxFile}
                disabled={debugger_.isRunning}
              />
              <FileUploader
                label="二进制替换文件 (可选)"
                helpText="用于替换脚本中引用的二进制文件"
                file={replacementFile}
                onFileChange={setReplacementFile}
                disabled={debugger_.isRunning}
              />
            </div>

            {/* 参数配置 */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">参数配置</h2>
              <MockTxParamsEditor
                params={mockTxParams}
                onChange={setMockTxParams}
                disabled={debugger_.isRunning}
              />
            </div>

            {/* 运行按钮 */}
            <div className="flex space-x-3">
              <button
                onClick={handleRun}
                disabled={!canRun}
                className={`
                  flex-1 py-3 px-4 rounded-lg font-medium text-white
                  flex items-center justify-center space-x-2
                  transition-colors
                  ${canRun
                    ? "bg-blue-600 hover:bg-blue-700"
                    : "bg-gray-400 cursor-not-allowed"
                  }
                `}
              >
                {debugger_.isRunning ? (
                  <>
                    <ArrowPathIcon className="h-5 w-5 animate-spin" />
                    <span>运行中...</span>
                  </>
                ) : (
                  <>
                    <PlayIcon className="h-5 w-5" />
                    <span>运行单个脚本</span>
                  </>
                )}
              </button>
              
              <button
                onClick={handleRunAll}
                disabled={!canRun}
                className={`
                  flex-1 py-3 px-4 rounded-lg font-medium text-white
                  flex items-center justify-center space-x-2
                  transition-colors
                  ${canRun
                    ? "bg-green-600 hover:bg-green-700"
                    : "bg-gray-400 cursor-not-allowed"
                  }
                `}
              >
                {debugger_.isRunning ? (
                  <>
                    <ArrowPathIcon className="h-5 w-5 animate-spin" />
                    <span>运行中...</span>
                  </>
                ) : (
                  <>
                    <PlayIcon className="h-5 w-5" />
                    <span>一键执行全部</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 右侧：输出面板 */}
          <div className="lg:h-[calc(100vh-12rem)]">
            <OutputConsole
              result={debugger_.result}
              isRunning={debugger_.isRunning}
            />
          </div>
        </div>
      </main>

      {/* 页脚 */}
      <footer className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        <p className="text-center text-sm text-gray-500">
          Powered by{" "}
          <a href="https://rustwasm.github.io/wasm-pack/" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
            wasm-pack
          </a>
          {" "}| Based on{" "}
          <a href="https://github.com/nervosnetwork/ckb-standalone-debugger" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
            ckb-standalone-debugger
          </a>
        </p>
      </footer>
    </div>
  );
}

export default App;
