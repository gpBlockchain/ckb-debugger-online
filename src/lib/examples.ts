export interface Example {
  id: string;
  name: string;
  description: string;
  /** Mock TX 模式的 JSON 内容 */
  mockTxContent?: string;
  /** 源代码（用于展示） */
  sourceCode?: string;
  /** 默认参数 */
  defaultParams?: {
    maxCycles?: number;
    cellIndex?: number;
    cellType?: "input" | "output";
    scriptGroupType?: "lock" | "type";
  };
}

export const examples: Example[] = [];

/**
 * 获取示例的默认文件名
 */
export function getExampleFileName(example: Example): string {
  return example.id || "contract";
}
