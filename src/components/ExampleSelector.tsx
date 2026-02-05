import { useState } from "react";
import { Listbox, Transition } from "@headlessui/react";
import { ChevronUpDownIcon, CheckIcon, CodeBracketIcon } from "@heroicons/react/24/outline";
import { examples, loadExampleBinary, getExampleFileName, type Example } from "../lib/examples";
import type { UploadedFile } from "./FileUploader";
import type { DebuggerMode } from "../hooks/useDebugger";

interface ExampleSelectorProps {
  mode: DebuggerMode;
  onLoadExample: (file: UploadedFile, example: Example) => void;
  disabled?: boolean;
}

export function ExampleSelector({ mode, onLoadExample, disabled }: ExampleSelectorProps) {
  const [selectedExample, setSelectedExample] = useState<Example | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showCode, setShowCode] = useState(false);

  // 过滤当前模式的示例
  const filteredExamples = examples.filter((e) => e.mode === mode);

  const handleSelectExample = async (example: Example | null) => {
    setSelectedExample(example);
    setShowCode(false);
    
    if (!example) return;
    
    setIsLoading(true);
    try {
      if (example.mode === "binary" && example.binaryPath) {
        const binary = await loadExampleBinary(example);
        if (binary) {
          const fileName = getExampleFileName(example);
          onLoadExample(
            {
              name: fileName,
              content: binary,
              size: binary.length,
            },
            example
          );
        }
      }
      // Mock TX 模式的示例加载可以在这里添加
    } finally {
      setIsLoading(false);
    }
  };

  if (filteredExamples.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700">
          快速加载示例
        </label>
        {selectedExample?.sourceCode && (
          <button
            onClick={() => setShowCode(!showCode)}
            className="text-xs text-blue-600 hover:text-blue-800 flex items-center space-x-1"
          >
            <CodeBracketIcon className="h-3 w-3" />
            <span>{showCode ? "隐藏代码" : "查看源码"}</span>
          </button>
        )}
      </div>

      <Listbox value={selectedExample} onChange={handleSelectExample} disabled={disabled || isLoading}>
        <div className="relative">
          <Listbox.Button className="relative w-full cursor-pointer rounded-lg bg-white py-2 pl-3 pr-10 text-left border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed">
            <span className={`block truncate ${selectedExample ? "text-gray-900" : "text-gray-500"}`}>
              {isLoading ? "加载中..." : selectedExample?.name || "选择一个示例..."}
            </span>
            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
              <ChevronUpDownIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
            </span>
          </Listbox.Button>

          <Transition
            leave="transition ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <Listbox.Options className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
              {filteredExamples.map((example) => (
                <Listbox.Option
                  key={example.id}
                  value={example}
                  className={({ active }) =>
                    `relative cursor-pointer select-none py-2 pl-10 pr-4 ${
                      active ? "bg-blue-50 text-blue-900" : "text-gray-900"
                    }`
                  }
                >
                  {({ selected }) => (
                    <>
                      <div>
                        <span className={`block truncate ${selected ? "font-medium" : "font-normal"}`}>
                          {example.name}
                        </span>
                        <span className="block text-xs text-gray-500 truncate">
                          {example.description}
                        </span>
                      </div>
                      {selected && (
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-blue-600">
                          <CheckIcon className="h-5 w-5" aria-hidden="true" />
                        </span>
                      )}
                    </>
                  )}
                </Listbox.Option>
              ))}
            </Listbox.Options>
          </Transition>
        </div>
      </Listbox>

      {/* 源码展示 */}
      {showCode && selectedExample?.sourceCode && (
        <div className="mt-3 rounded-lg bg-gray-900 p-4 overflow-auto max-h-48">
          <pre className="text-sm text-gray-300 font-mono">
            {selectedExample.sourceCode}
          </pre>
        </div>
      )}
    </div>
  );
}
