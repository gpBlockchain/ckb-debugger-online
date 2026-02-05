export interface Example {
  id: string;
  name: string;
  description: string;
  mode: "binary" | "mockTx";
  /** Binary 模式的二进制文件路径 */
  binaryPath?: string;
  /** Mock TX 模式的 JSON 内容 */
  mockTxContent?: string;
  /** 源代码（用于展示） */
  sourceCode?: string;
  /** 默认参数 */
  defaultParams?: {
    maxCycles?: number;
    programArgs?: string;
    cellIndex?: number;
    cellType?: "input" | "output";
    scriptGroupType?: "lock" | "type";
  };
}

export const examples: Example[] = [
  {
    id: "fib",
    name: "Fibonacci (fib)",
    description: "计算 Fibonacci 数列，验证 fib(5) = 5",
    mode: "binary",
    binaryPath: "/examples/fib",
    sourceCode: `#include "entry.h"

int fib(int n) {
    if (n == 0 || n == 1) {
        return n;
    } else {
        return fib(n-1) + fib(n-2);
    }
}

int main() {
    if (fib(5) != 5) {
        return 1;
    }
    return 0;
}`,
    defaultParams: {
      maxCycles: 3500000000,
    },
  },
  {
    id: "always_failure",
    name: "Always Failure",
    description: "总是返回失败（exit code 1）的简单合约",
    mode: "binary",
    binaryPath: "/examples/always_failure",
    sourceCode: `#include "entry.h"

int main() {
    return 1;
}`,
    defaultParams: {
      maxCycles: 3500000000,
    },
  },
];

/**
 * 加载示例的二进制文件
 */
export async function loadExampleBinary(example: Example): Promise<Uint8Array | null> {
  if (!example.binaryPath) return null;
  
  try {
    const response = await fetch(example.binaryPath);
    if (!response.ok) {
      throw new Error(`Failed to load example: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch (error) {
    console.error("Failed to load example binary:", error);
    return null;
  }
}

/**
 * 获取示例的默认文件名
 */
export function getExampleFileName(example: Example): string {
  if (example.binaryPath) {
    return example.binaryPath.split("/").pop() || "contract";
  }
  return "contract";
}
