/**
 * CKB 交易转换为 MockTx 格式
 * 使用 CCC SDK 从链上获取交易并补充必要数据
 */

import { ccc } from "@ckb-ccc/ccc";

// 网络类型
export type NetworkType = "mainnet" | "testnet" | "custom";

// 网络配置
export const NETWORK_CONFIGS = {
  mainnet: {
    name: "主网",
    rpc: "https://mainnet.ckbapp.dev/rpc",
  },
  testnet: {
    name: "测试网",
    rpc: "https://testnet.ckbapp.dev/rpc",
  },
} as const;

// MockTx 格式类型定义
export interface MockInput {
  input: {
    previous_output: {
      tx_hash: string;
      index: string;
    };
    since: string;
  };
  output: {
    capacity: string;
    lock: {
      code_hash: string;
      hash_type: string;
      args: string;
    };
    type?: {
      code_hash: string;
      hash_type: string;
      args: string;
    } | null;
  };
  data: string;
}

export interface MockCellDep {
  cell_dep: {
    out_point: {
      tx_hash: string;
      index: string;
    };
    dep_type: string;
  };
  output: {
    capacity: string;
    lock: {
      code_hash: string;
      hash_type: string;
      args: string;
    };
    type?: {
      code_hash: string;
      hash_type: string;
      args: string;
    } | null;
  };
  data: string;
}

export interface MockHeaderDep {
  compact_target: string;
  dao: string;
  epoch: string;
  extra_hash: string;
  hash: string;
  nonce: string;
  number: string;
  parent_hash: string;
  proposals_hash: string;
  timestamp: string;
  transactions_root: string;
  version: string;
}

export interface MockTx {
  mock_info: {
    inputs: MockInput[];
    cell_deps: MockCellDep[];
    header_deps: MockHeaderDep[];
  };
  tx: {
    version: string;
    cell_deps: Array<{
      out_point: {
        tx_hash: string;
        index: string;
      };
      dep_type: string;
    }>;
    header_deps: string[];
    inputs: Array<{
      previous_output: {
        tx_hash: string;
        index: string;
      };
      since: string;
    }>;
    outputs: Array<{
      capacity: string;
      lock: {
        code_hash: string;
        hash_type: string;
        args: string;
      };
      type?: {
        code_hash: string;
        hash_type: string;
        args: string;
      } | null;
    }>;
    outputs_data: string[];
    witnesses: string[];
  };
}

// 转换进度回调
export interface ConversionProgress {
  stage: "fetching_tx" | "fetching_inputs" | "fetching_cell_deps" | "fetching_headers" | "done";
  current: number;
  total: number;
  message: string;
}

/**
 * 创建 CCC 客户端
 */
export function createClient(network: NetworkType, customRpc?: string): ccc.Client {
  if (network === "mainnet") {
    return new ccc.ClientPublicMainnet();
  } else if (network === "testnet") {
    return new ccc.ClientPublicTestnet();
  } else if (customRpc) {
    // 自定义 RPC - 根据 URL 判断网络类型
    // 默认使用测试网配置
    return new ccc.ClientPublicTestnet({ url: customRpc });
  }
  throw new Error("请提供有效的 RPC 地址");
}

/**
 * 通过交易哈希获取交易
 */
export async function fetchTransaction(
  client: ccc.Client,
  txHash: string
): Promise<ccc.Transaction> {
  const result = await client.getTransaction(txHash);
  if (!result) {
    throw new Error(`交易不存在: ${txHash}`);
  }
  return result.transaction;
}

/**
 * 获取 Cell 信息（包括已消费的 Cell）
 * 通过获取创建该 Cell 的交易来获取 Cell 数据
 */
async function getCellByOutPoint(
  client: ccc.Client,
  outPoint: { txHash: string; index: number }
): Promise<{ output: ccc.CellOutput; data: string }> {
  // 获取创建该 Cell 的交易
  const txResult = await client.getTransaction(outPoint.txHash);
  if (!txResult) {
    throw new Error(`无法获取交易: ${outPoint.txHash}`);
  }
  
  const tx = txResult.transaction;
  const index = outPoint.index;
  
  if (index >= tx.outputs.length) {
    throw new Error(`Cell 索引越界: ${index} >= ${tx.outputs.length}`);
  }
  
  return {
    output: tx.outputs[index],
    data: tx.outputsData[index] || "0x",
  };
}

/**
 * 将 Script 转换为 JSON 格式
 */
function scriptToJson(script: ccc.Script | undefined): {
  code_hash: string;
  hash_type: string;
  args: string;
} | null {
  if (!script) return null;
  return {
    code_hash: script.codeHash,
    hash_type: script.hashType,
    args: script.args,
  };
}

/**
 * 将 depType 转换为 snake_case 格式
 * CCC SDK 可能返回 "depGroup"，但 ckb-debugger 需要 "dep_group"
 */
function normalizeDepType(depType: string): string {
  if (depType === "depGroup" || depType === "DepGroup") {
    return "dep_group";
  }
  // "code" 保持不变
  return depType.toLowerCase();
}

/**
 * 解析 dep_group cell 的 data，提取其中的 OutPoint 列表
 * dep_group data 格式: OutPointVec (molecule)
 * - 4 bytes: total_size (little-endian u32)
 * - N * 36 bytes: OutPoint[] 每个 OutPoint = 32 bytes tx_hash + 4 bytes index
 */
function parseDepGroupData(data: string): Array<{ txHash: string; index: number }> {
  const bytes = hexToBytes(data);
  if (bytes.length < 4) {
    return [];
  }
  
  const view = new DataView(bytes.buffer);
  const totalSize = view.getUint32(0, true);
  
  if (totalSize !== bytes.length) {
    console.warn(`dep_group data size mismatch: expected ${totalSize}, got ${bytes.length}`);
  }
  
  const outPoints: Array<{ txHash: string; index: number }> = [];
  const outPointSize = 36; // 32 bytes tx_hash + 4 bytes index
  
  // 从 offset 4 开始解析 OutPoints
  let offset = 4;
  while (offset + outPointSize <= bytes.length) {
    const txHashBytes = bytes.slice(offset, offset + 32);
    const txHash = "0x" + bytesToHex(txHashBytes);
    const index = view.getUint32(offset + 32, true);
    
    outPoints.push({ txHash, index });
    offset += outPointSize;
  }
  
  return outPoints;
}

/**
 * 将 hex 字符串转换为 Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (cleanHex.length === 0) return new Uint8Array(0);
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * 将 Uint8Array 转换为 hex 字符串
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 将 CellOutput 转换为 JSON 格式
 */
function cellOutputToJson(output: ccc.CellOutput): MockInput["output"] {
  // capacity 需要转换为 0x 前缀的十六进制格式
  const capacityHex = `0x${BigInt(output.capacity).toString(16)}`;
  return {
    capacity: capacityHex,
    lock: scriptToJson(output.lock)!,
    type: scriptToJson(output.type),
  };
}

/**
 * 将交易转换为 MockTx 格式
 */
export async function convertToMockTx(
  client: ccc.Client,
  tx: ccc.Transaction,
  onProgress?: (progress: ConversionProgress) => void
): Promise<MockTx> {
  const reportProgress = (progress: ConversionProgress) => {
    if (onProgress) {
      onProgress(progress);
    }
  };

  // 1. 获取所有 input cells 的详细信息
  reportProgress({
    stage: "fetching_inputs",
    current: 0,
    total: tx.inputs.length,
    message: `正在获取输入 Cells (0/${tx.inputs.length})`,
  });

  const mockInputs: MockInput[] = [];
  for (let i = 0; i < tx.inputs.length; i++) {
    const input = tx.inputs[i];
    const prevOut = input.previousOutput;
    
    const cell = await getCellByOutPoint(client, {
      txHash: prevOut.txHash,
      index: Number(prevOut.index),
    });
    
    mockInputs.push({
      input: {
        previous_output: {
          tx_hash: prevOut.txHash,
          index: `0x${prevOut.index.toString(16)}`,
        },
        since: `0x${input.since.toString(16)}`,
      },
      output: cellOutputToJson(cell.output),
      data: cell.data,
    });

    reportProgress({
      stage: "fetching_inputs",
      current: i + 1,
      total: tx.inputs.length,
      message: `正在获取输入 Cells (${i + 1}/${tx.inputs.length})`,
    });
  }

  // 2. 获取所有 cell_deps 的详细信息
  // 需要处理 dep_group 类型，展开其中引用的所有 cells
  reportProgress({
    stage: "fetching_cell_deps",
    current: 0,
    total: tx.cellDeps.length,
    message: `正在获取依赖 Cells (0/${tx.cellDeps.length})`,
  });

  const mockCellDeps: MockCellDep[] = [];
  for (let i = 0; i < tx.cellDeps.length; i++) {
    const cellDep = tx.cellDeps[i];
    const outPoint = cellDep.outPoint;
    const depType = normalizeDepType(cellDep.depType);
    
    const cell = await getCellByOutPoint(client, {
      txHash: outPoint.txHash,
      index: Number(outPoint.index),
    });
    
    mockCellDeps.push({
      cell_dep: {
        out_point: {
          tx_hash: outPoint.txHash,
          index: `0x${outPoint.index.toString(16)}`,
        },
        dep_type: depType,
      },
      output: cellOutputToJson(cell.output),
      data: cell.data,
    });

    // 如果是 dep_group 类型，需要展开获取组内的所有 cells
    if (depType === "dep_group") {
      const groupOutPoints = parseDepGroupData(cell.data);
      
      for (const groupOutPoint of groupOutPoints) {
        const groupCell = await getCellByOutPoint(client, groupOutPoint);
        
        // 将组内的 cell 作为 "code" 类型添加到 cell_deps
        mockCellDeps.push({
          cell_dep: {
            out_point: {
              tx_hash: groupOutPoint.txHash,
              index: `0x${groupOutPoint.index.toString(16)}`,
            },
            dep_type: "code",
          },
          output: cellOutputToJson(groupCell.output),
          data: groupCell.data,
        });
      }
    }

    reportProgress({
      stage: "fetching_cell_deps",
      current: i + 1,
      total: tx.cellDeps.length,
      message: `正在获取依赖 Cells (${i + 1}/${tx.cellDeps.length})`,
    });
  }

  // 3. 获取 header_deps（如果有）
  const mockHeaderDeps: MockHeaderDep[] = [];
  if (tx.headerDeps.length > 0) {
    reportProgress({
      stage: "fetching_headers",
      current: 0,
      total: tx.headerDeps.length,
      message: `正在获取区块头 (0/${tx.headerDeps.length})`,
    });

    for (let i = 0; i < tx.headerDeps.length; i++) {
      const headerHash = tx.headerDeps[i];
      const header = await client.getHeaderByHash(headerHash);
      
      if (header) {
        mockHeaderDeps.push({
          compact_target: `0x${header.compactTarget.toString(16)}`,
          dao: header.dao,
          epoch: `0x${header.epoch.toString(16)}`,
          extra_hash: header.extraHash,
          hash: header.hash,
          nonce: `0x${header.nonce.toString(16)}`,
          number: `0x${header.number.toString(16)}`,
          parent_hash: header.parentHash,
          proposals_hash: header.proposalsHash,
          timestamp: `0x${header.timestamp.toString(16)}`,
          transactions_root: header.transactionsRoot,
          version: `0x${header.version.toString(16)}`,
        });
      }

      reportProgress({
        stage: "fetching_headers",
        current: i + 1,
        total: tx.headerDeps.length,
        message: `正在获取区块头 (${i + 1}/${tx.headerDeps.length})`,
      });
    }
  }

  reportProgress({
    stage: "done",
    current: 1,
    total: 1,
    message: "转换完成",
  });

  // 构建 MockTx
  return {
    mock_info: {
      inputs: mockInputs,
      cell_deps: mockCellDeps,
      header_deps: mockHeaderDeps,
    },
    tx: {
      version: `0x${tx.version.toString(16)}`,
      cell_deps: tx.cellDeps.map((dep) => ({
        out_point: {
          tx_hash: dep.outPoint.txHash,
          index: `0x${dep.outPoint.index.toString(16)}`,
        },
        dep_type: normalizeDepType(dep.depType),
      })),
      header_deps: tx.headerDeps,
      inputs: tx.inputs.map((input) => ({
        previous_output: {
          tx_hash: input.previousOutput.txHash,
          index: `0x${input.previousOutput.index.toString(16)}`,
        },
        since: `0x${input.since.toString(16)}`,
      })),
      outputs: tx.outputs.map((output) => cellOutputToJson(output)),
      outputs_data: tx.outputsData,
      witnesses: tx.witnesses,
    },
  };
}

/**
 * 将数字或字符串转换为 0x 前缀的十六进制格式
 * 支持：十进制数字、十进制字符串、已有 0x 前缀的十六进制
 */
function toHexString(value: string | number): string {
  if (typeof value === "number") {
    return `0x${value.toString(16)}`;
  }
  
  const str = value.trim();
  
  // 已经是 0x 前缀的十六进制
  if (str.startsWith("0x") || str.startsWith("0X")) {
    return str.toLowerCase();
  }
  
  // 十进制字符串，转换为十六进制
  try {
    const num = BigInt(str);
    return `0x${num.toString(16)}`;
  } catch {
    // 如果转换失败，原样返回
    return str;
  }
}

/**
 * 从 Raw TX JSON 解析交易
 * 支持 CKB RPC 返回的格式，自动处理十进制/十六进制转换
 */
export function parseRawTxJson(jsonStr: string): ccc.Transaction {
  const json = JSON.parse(jsonStr);
  
  // 支持两种格式：
  // 1. 直接的交易 JSON
  // 2. RPC get_transaction 返回的格式 (包含 transaction 字段)
  const txJson = json.transaction || json;
  
  return ccc.Transaction.from({
    version: toHexString(txJson.version),
    cellDeps: txJson.cell_deps.map((dep: { out_point: { tx_hash: string; index: string | number }; dep_type: string }) => ({
      outPoint: {
        txHash: dep.out_point.tx_hash,
        index: toHexString(dep.out_point.index),
      },
      depType: dep.dep_type,
    })),
    headerDeps: txJson.header_deps,
    inputs: txJson.inputs.map((input: { previous_output: { tx_hash: string; index: string | number }; since: string | number }) => ({
      previousOutput: {
        txHash: input.previous_output.tx_hash,
        index: toHexString(input.previous_output.index),
      },
      since: toHexString(input.since),
    })),
    outputs: txJson.outputs.map((output: { capacity: string | number; lock: { code_hash: string; hash_type: string; args: string }; type?: { code_hash: string; hash_type: string; args: string } | null }) => ({
      capacity: toHexString(output.capacity),
      lock: {
        codeHash: output.lock.code_hash,
        hashType: output.lock.hash_type,
        args: output.lock.args,
      },
      type: output.type ? {
        codeHash: output.type.code_hash,
        hashType: output.type.hash_type,
        args: output.type.args,
      } : undefined,
    })),
    outputsData: txJson.outputs_data,
    witnesses: txJson.witnesses,
  });
}

/**
 * 将 MockTx 转换为 Uint8Array（用于调试器）
 */
export function mockTxToBytes(mockTx: MockTx): Uint8Array {
  const jsonStr = JSON.stringify(mockTx, null, 2);
  const encoder = new TextEncoder();
  return encoder.encode(jsonStr);
}
