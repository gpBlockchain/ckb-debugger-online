import { Component, type ReactNode } from "react";
import { ExclamationTriangleIcon, ArrowPathIcon } from "@heroicons/react/24/outline";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
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
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6 text-center">
            <ExclamationTriangleIcon className="h-16 w-16 text-red-500 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-gray-900 mb-2">出错了</h1>
            <p className="text-gray-600 mb-4">
              应用程序遇到了一个错误。这可能是由于浏览器不支持某些功能或 WASM 模块加载失败。
            </p>
            {this.state.error && (
              <div className="bg-red-50 border border-red-200 rounded p-3 mb-4 text-left">
                <p className="text-sm text-red-700 font-mono break-all">
                  {this.state.error.message}
                </p>
              </div>
            )}
            <button
              onClick={this.handleReload}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <ArrowPathIcon className="h-5 w-5" />
              <span>重新加载</span>
            </button>
            <p className="text-xs text-gray-500 mt-4">
              如果问题持续存在，请检查浏览器是否支持 WebAssembly 和 SharedArrayBuffer
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
