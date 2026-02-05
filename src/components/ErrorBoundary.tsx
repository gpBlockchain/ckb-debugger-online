// Disable react-refresh warning because ErrorFallback is a private helper component
// that's only used within the ErrorBoundary and doesn't need to be in a separate file
/* eslint-disable react-refresh/only-export-components */
import { Component, type ReactNode } from "react";
import { ExclamationTriangleIcon, ArrowPathIcon } from "@heroicons/react/24/outline";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

// Error fallback component that uses translations
// Note: We use both English and Chinese text since ErrorBoundary catches errors
// that might occur before i18n is initialized
function ErrorFallback({ error, onReload }: { error: Error | null; onReload: () => void }) {
  // Check if browser language is Chinese
  const isChinese = typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh");
  
  const texts = {
    title: isChinese ? "出错了" : "Something went wrong",
    description: isChinese 
      ? "应用程序遇到了一个错误。这可能是由于浏览器不支持某些功能或 WASM 模块加载失败。"
      : "The application encountered an error. This may be due to browser incompatibility or WASM module loading failure.",
    reload: isChinese ? "重新加载" : "Reload",
    browserSupport: isChinese
      ? "如果问题持续存在，请检查浏览器是否支持 WebAssembly 和 SharedArrayBuffer"
      : "If the problem persists, please check if your browser supports WebAssembly and SharedArrayBuffer",
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6 text-center">
        <ExclamationTriangleIcon className="h-16 w-16 text-red-500 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-gray-900 mb-2">{texts.title}</h1>
        <p className="text-gray-600 mb-4">
          {texts.description}
        </p>
        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-3 mb-4 text-left">
            <p className="text-sm text-red-700 font-mono break-all">
              {error.message}
            </p>
          </div>
        )}
        <button
          onClick={onReload}
          className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <ArrowPathIcon className="h-5 w-5" />
          <span>{texts.reload}</span>
        </button>
        <p className="text-xs text-gray-500 mt-4">
          {texts.browserSupport}
        </p>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} onReload={this.handleReload} />;
    }

    return this.props.children;
  }
}
