import { useState } from "react";
import {
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  ClipboardIcon,
  ClipboardDocumentCheckIcon,
} from "@heroicons/react/24/outline";
import type { DebuggerResult } from "../lib/wasmer";

interface OutputConsoleProps {
  result: DebuggerResult | null;
  isRunning: boolean;
}

type OutputTab = "stdout" | "stderr" | "all";

export function OutputConsole({ result, isRunning }: OutputConsoleProps) {
  const [activeTab, setActiveTab] = useState<OutputTab>("all");
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!result) return;
    
    let text = "";
    if (activeTab === "stdout") {
      text = result.stdout;
    } else if (activeTab === "stderr") {
      text = result.stderr;
    } else {
      text = `=== STDOUT ===\n${result.stdout}\n\n=== STDERR ===\n${result.stderr}`;
    }
    
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const getOutput = (): string => {
    if (!result) return "";
    
    switch (activeTab) {
      case "stdout":
        return result.stdout || "(无输出)";
      case "stderr":
        return result.stderr || "(无输出)";
      case "all":
        return [
          result.stdout && `[STDOUT]\n${result.stdout}`,
          result.stderr && `[STDERR]\n${result.stderr}`,
        ]
          .filter(Boolean)
          .join("\n\n") || "(无输出)";
    }
  };

  return (
    <div className="bg-gray-900 rounded-lg overflow-hidden flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center space-x-4">
          <h3 className="text-sm font-medium text-gray-200">输出</h3>
          
          {/* 状态指示 */}
          {isRunning && (
            <div className="flex items-center space-x-1 text-yellow-400">
              <ClockIcon className="h-4 w-4 animate-spin" />
              <span className="text-xs">运行中...</span>
            </div>
          )}
          
          {result && !isRunning && (
            <div className={`flex items-center space-x-1 ${result.success ? "text-green-400" : "text-red-400"}`}>
              {result.success ? (
                <CheckCircleIcon className="h-4 w-4" />
              ) : (
                <XCircleIcon className="h-4 w-4" />
              )}
              <span className="text-xs">
                Exit: {result.exitCode} | {formatDuration(result.duration)}
              </span>
            </div>
          )}
        </div>

        {/* Tab 切换和复制按钮 */}
        <div className="flex items-center space-x-2">
          <div className="flex bg-gray-700 rounded p-0.5">
            {(["all", "stdout", "stderr"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  activeTab === tab
                    ? "bg-gray-600 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {tab.toUpperCase()}
              </button>
            ))}
          </div>
          
          <button
            onClick={handleCopy}
            disabled={!result}
            className="p-1.5 text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="复制输出"
          >
            {copied ? (
              <ClipboardDocumentCheckIcon className="h-4 w-4 text-green-400" />
            ) : (
              <ClipboardIcon className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* 输出内容 */}
      <div className="flex-1 overflow-auto p-4">
        {isRunning ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-400">
              <div className="animate-pulse mb-2">
                <div className="w-8 h-8 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin mx-auto"></div>
              </div>
              <p className="text-sm">正在执行合约...</p>
            </div>
          </div>
        ) : result ? (
          <pre className="output-console text-gray-300 whitespace-pre-wrap break-words">
            {getOutput()}
          </pre>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <p className="text-sm">运行调试器后输出将显示在这里</p>
          </div>
        )}
      </div>
    </div>
  );
}
