// CKB Debugger WASM 封装
// 使用 wasm-pack 生成的模块，提供 run_json 函数

import init, { run_json } from './ckb-debugger-wasm/ckb_debugger';
import { blake2b } from 'blakejs';

// 全局初始化状态
let isInitialized = false;

/**
 * 初始化 WASM 模块
 */
export async function initializeWasmer(): Promise<void> {
  if (isInitialized) return;
  
  try {
    await init();
    isInitialized = true;
    console.log('CKB Debugger WASM 初始化成功');
  } catch (error) {
    console.error('CKB Debugger WASM 初始化失败:', error);
    throw new Error(`WASM 初始化失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 调试器运行结果
 */
export interface DebuggerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
  duration: number;
}

/**
 * Binary 模式参数 (wasm-pack 版本不支持，保留接口兼容性)
 */
export interface BinaryModeParams {
  binary: Uint8Array;
  binaryName: string;
  maxCycles?: number;
  programArgs?: string[];
}

/**
 * Mock TX 模式参数
 */
export interface MockTxModeParams {
  /** mock_tx.json 内容 */
  mockTx: Uint8Array;
  /** Cell 索引 */
  cellIndex: number;
  /** Cell 类型 */
  cellType: "input" | "output";
  /** 脚本组类型 */
  scriptGroupType: "lock" | "type";
  /** 最大 cycles */
  maxCycles?: number;
  /** 可选：替换的二进制文件 (wasm-pack 版本不支持) */
  binaryReplacement?: {
    content: Uint8Array;
    name: string;
  };
}

/**
 * 计算脚本哈希 (blake2b-256)
 * 脚本序列化格式: code_hash (32 bytes) + hash_type (1 byte) + args
 */
function computeScriptHash(script: {
  code_hash: string;
  hash_type: string;
  args: string;
}): string {
  // 将 code_hash 转换为字节数组
  const codeHashBytes = hexToBytes(script.code_hash);
  
  // hash_type: data=0, type=1, data1=2, data2=4
  let hashTypeByte: number;
  switch (script.hash_type) {
    case 'data': hashTypeByte = 0; break;
    case 'type': hashTypeByte = 1; break;
    case 'data1': hashTypeByte = 2; break;
    case 'data2': hashTypeByte = 4; break;
    default: hashTypeByte = 0;
  }
  
  // 将 args 转换为字节数组
  const argsBytes = hexToBytes(script.args);
  
  // 构建序列化的脚本 (molecule 格式)
  // Script: table { code_hash: Byte32, hash_type: byte, args: Bytes }
  const serialized = serializeScript(codeHashBytes, hashTypeByte, argsBytes);
  
  // 计算 blake2b-256 哈希
  const hash = blake2b256(serialized);
  return '0x' + bytesToHex(hash);
}

/**
 * 序列化脚本 (molecule 格式)
 */
function serializeScript(codeHash: Uint8Array, hashType: number, args: Uint8Array): Uint8Array {
  // Script 是一个 table，包含 3 个字段
  // 头部: 4 bytes (全长) + 4 bytes * 4 (偏移表)
  // 字段: code_hash (32 bytes) + hash_type (1 byte) + args (4 bytes 长度 + 数据)
  
  const headerSize = 4 + 4 * 3; // full_size + 3 offsets
  const codeHashSize = 32;
  const hashTypeSize = 1;
  const argsHeaderSize = 4; // args 长度前缀
  
  const totalSize = headerSize + codeHashSize + hashTypeSize + argsHeaderSize + args.length;
  
  const result = new Uint8Array(totalSize);
  const view = new DataView(result.buffer);
  
  // 写入 full_size (小端序)
  view.setUint32(0, totalSize, true);
  
  // 写入偏移表
  view.setUint32(4, headerSize, true); // code_hash offset
  view.setUint32(8, headerSize + codeHashSize, true); // hash_type offset
  view.setUint32(12, headerSize + codeHashSize + hashTypeSize, true); // args offset
  
  // 写入 code_hash
  result.set(codeHash, headerSize);
  
  // 写入 hash_type
  result[headerSize + codeHashSize] = hashType;
  
  // 写入 args (fixvec 格式: 4 bytes 长度 + 数据)
  // 长度字段存储的是元素数量 (对于 Bytes 即字节数)
  view.setUint32(headerSize + codeHashSize + hashTypeSize, args.length, true);
  result.set(args, headerSize + codeHashSize + hashTypeSize + argsHeaderSize);
  
  return result;
}

/**
 * Blake2b-256 哈希 (CKB 使用的个性化参数)
 * CKB 使用 blake2b，output 256 bits，personalization 为 "ckb-default-hash"
 */
function blake2b256(data: Uint8Array): Uint8Array {
  // CKB 的 personalization 必须是 16 bytes
  const CKB_HASH_PERSONALIZATION = new Uint8Array([
    99, 107, 98, 45, 100, 101, 102, 97, 117, 108, 116, 45, 104, 97, 115, 104
  ]); // "ckb-default-hash" in ASCII
  
  // 使用 blakejs 计算 blake2b-256
  // TypeScript 类型定义不完整，但 blakejs 底层支持 salt 和 personalization 参数
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blake2bWithPersonal = blake2b as (
    input: Uint8Array,
    key: Uint8Array | undefined,
    outlen: number,
    salt: Uint8Array | undefined,
    personal: Uint8Array
  ) => Uint8Array;
  
  return blake2bWithPersonal(data, undefined, 32, undefined, CKB_HASH_PERSONALIZATION);
}

/**
 * Hex 字符串转字节数组
 */
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (cleanHex.length === 0) return new Uint8Array(0);
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * 字节数组转 Hex 字符串
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 从 mock_tx JSON 中提取脚本
 */
function extractScript(
  mockTx: Record<string, unknown>,
  cellIndex: number,
  cellType: "input" | "output",
  scriptGroupType: "lock" | "type"
): { code_hash: string; hash_type: string; args: string } | null {
  try {
    const mockInfo = mockTx.mock_info as Record<string, unknown>;
    if (!mockInfo) return null;
    
    let cell: Record<string, unknown> | null = null;
    
    if (cellType === "input") {
      const inputs = mockInfo.inputs as Array<Record<string, unknown>>;
      if (!inputs || cellIndex >= inputs.length) return null;
      cell = inputs[cellIndex].output as Record<string, unknown>;
    } else {
      // output 的情况，从 tx.outputs 获取
      const tx = mockTx.tx as Record<string, unknown>;
      if (!tx) return null;
      const outputs = tx.outputs as Array<Record<string, unknown>>;
      if (!outputs || cellIndex >= outputs.length) return null;
      cell = outputs[cellIndex];
    }
    
    if (!cell) return null;
    
    const script = cell[scriptGroupType] as Record<string, unknown>;
    if (!script) return null;
    
    return {
      code_hash: script.code_hash as string,
      hash_type: script.hash_type as string,
      args: script.args as string,
    };
  } catch (e) {
    console.error('提取脚本失败:', e);
    return null;
  }
}

/**
 * 使用 Binary 模式运行调试器
 * 注意：wasm-pack 版本不支持直接运行二进制文件
 */
export async function runBinaryMode(_params: BinaryModeParams): Promise<DebuggerResult> {
  return {
    stdout: '',
    stderr: '错误：浏览器 WASM 版本不支持直接运行二进制文件。\n\n请使用 Mock TX 模式，或使用命令行版本的 ckb-debugger。\n\n安装命令行版本：\ncargo install --git https://github.com/nervosnetwork/ckb-standalone-debugger ckb-debugger',
    exitCode: -1,
    success: false,
    duration: 0,
  };
}

/**
 * 将 Uint8Array 转换为 hex 字符串
 */
function uint8ArrayToHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 在 mock_tx 中查找并替换与 code_hash 匹配的 cell_dep 的 data
 */
function replaceBinaryInMockTx(
  mockTxObj: Record<string, unknown>,
  codeHash: string,
  hashType: string,
  binaryContent: Uint8Array
): boolean {
  const mockInfo = mockTxObj.mock_info as Record<string, unknown>;
  if (!mockInfo) return false;
  
  const cellDeps = mockInfo.cell_deps as Array<Record<string, unknown>>;
  if (!cellDeps) return false;
  
  // 将二进制转为 hex
  const binaryHex = uint8ArrayToHex(binaryContent);
  
  // 查找匹配 code_hash 的 cell_dep
  // 对于 hash_type=type，需要找 type script 匹配的 cell
  // 对于 hash_type=data/data1/data2，需要找 data hash 匹配的 cell（即 code cell）
  let replaced = false;
  
  for (const cellDep of cellDeps) {
    const output = cellDep.output as Record<string, unknown>;
    if (!output) continue;
    
    if (hashType === 'type') {
      // type 类型：匹配 cell 的 type script hash
      const typeScript = output.type as Record<string, unknown>;
      if (typeScript) {
        const typeScriptHash = computeScriptHash({
          code_hash: typeScript.code_hash as string,
          hash_type: typeScript.hash_type as string,
          args: typeScript.args as string,
        });
        if (typeScriptHash.toLowerCase() === codeHash.toLowerCase()) {
          cellDep.data = binaryHex;
          replaced = true;
          console.log('已替换 type script 匹配的 cell data');
        }
      }
    } else {
      // data/data1/data2 类型：匹配 cell data 的 hash
      // 由于我们要替换的就是 data，需要通过其他方式识别
      // 通常是通过 cell 的 type script 或直接通过 code_hash 在 cell_deps 中查找
      // 这里简化处理：查找 lock script 的 code_hash 与目标匹配的 cell
      const lockScript = output.lock as Record<string, unknown>;
      if (lockScript && (lockScript.code_hash as string)?.toLowerCase() === codeHash.toLowerCase()) {
        cellDep.data = binaryHex;
        replaced = true;
        console.log('已替换 code_hash 匹配的 cell data');
      }
      
      // 也检查 data hash 是否匹配（通过计算当前 data 的 hash）
      const currentData = cellDep.data as string;
      if (currentData && !replaced) {
        const currentDataHash = computeDataHash(currentData);
        if (currentDataHash.toLowerCase() === codeHash.toLowerCase()) {
          cellDep.data = binaryHex;
          replaced = true;
          console.log('已替换 data hash 匹配的 cell data');
        }
      }
    }
  }
  
  return replaced;
}

/**
 * 计算 data 的 blake2b-256 hash
 */
function computeDataHash(dataHex: string): string {
  const cleanHex = dataHex.startsWith('0x') ? dataHex.slice(2) : dataHex;
  if (cleanHex.length === 0) return '0x' + '0'.repeat(64);
  
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  
  const hash = blake2b256(bytes);
  return '0x' + bytesToHex(hash);
}

/**
 * 使用 Mock TX 模式运行调试器
 */
export async function runMockTxMode(params: MockTxModeParams): Promise<DebuggerResult> {
  const {
    mockTx,
    cellIndex,
    cellType,
    scriptGroupType,
    maxCycles = 3500000000,
    binaryReplacement,
  } = params;
  
  const startTime = performance.now();
  
  // 确保已初始化
  await initializeWasmer();
  
  try {
    // 解析 mock_tx JSON
    const decoder = new TextDecoder();
    const mockTxStr = decoder.decode(mockTx);
    const mockTxObj = JSON.parse(mockTxStr);
    
    // 提取脚本
    const script = extractScript(mockTxObj, cellIndex, cellType, scriptGroupType);
    
    if (!script) {
      return {
        stdout: '',
        stderr: `错误：无法从 mock_tx 中提取脚本。\n请检查 cell_index=${cellIndex}, cell_type=${cellType}, script_group_type=${scriptGroupType} 是否正确。`,
        exitCode: -1,
        success: false,
        duration: performance.now() - startTime,
      };
    }
    
    // 如果有二进制替换文件，替换 mock_tx 中对应的 cell data
    let replacementInfo = '';
    if (binaryReplacement) {
      const replaced = replaceBinaryInMockTx(
        mockTxObj,
        script.code_hash,
        script.hash_type,
        binaryReplacement.content
      );
      if (replaced) {
        replacementInfo = `\n[已替换二进制: ${binaryReplacement.name}]\n`;
      } else {
        console.warn('未找到匹配的 cell_dep 进行替换');
        replacementInfo = `\n[警告: 未找到匹配的 cell_dep，二进制未替换]\n`;
      }
    }
    
    // 计算脚本哈希
    const scriptHash = computeScriptHash(script);
    
    // 构建等效命令行
    const cmdEquivalent = `ckb-debugger --tx-file mock_tx.json --cell-index ${cellIndex} --cell-type ${cellType} --script-group-type ${scriptGroupType}`;
    
    console.log('等效命令:', cmdEquivalent);
    console.log('计算的脚本哈希:', scriptHash);
    console.log('脚本详情:', script);
    
    // 将可能修改过的 mockTxObj 转回字符串
    const finalMockTxStr = JSON.stringify(mockTxObj);
    
    // 调用 run_json 函数
    const result = run_json(
      finalMockTxStr,
      scriptGroupType,
      scriptHash,
      String(maxCycles)
    );
    
    const duration = performance.now() - startTime;
    
    // 解析结果
    let parsedResult: { cycle: number | null; error: string | null };
    try {
      parsedResult = JSON.parse(result);
    } catch {
      // 如果不是 JSON，直接返回原始结果
      return {
        stdout: `$ ${cmdEquivalent}\n\n${result}`,
        stderr: '',
        exitCode: 0,
        success: true,
        duration,
      };
    }
    
    const isSuccess = parsedResult.error === null;
    
    // 格式化输出
    let formattedOutput = '';
    formattedOutput += `$ ${cmdEquivalent}\n`;
    formattedOutput += replacementInfo;
    formattedOutput += '\n';
    
    if (isSuccess) {
      formattedOutput += `✓ 执行成功\n\n`;
      formattedOutput += `消耗 Cycles: ${parsedResult.cycle?.toLocaleString() || 'N/A'}\n`;
      formattedOutput += `执行时间: ${(duration / 1000).toFixed(2)}s`;
    } else {
      formattedOutput += `✗ 执行失败\n\n`;
      formattedOutput += `错误信息: ${parsedResult.error}\n\n`;
      formattedOutput += `--- 调试信息 ---\n`;
      formattedOutput += `脚本哈希: ${scriptHash}\n`;
      formattedOutput += `code_hash: ${script.code_hash}\n`;
      formattedOutput += `hash_type: ${script.hash_type}\n`;
      formattedOutput += `args: ${script.args}`;
    }
    
    return {
      stdout: formattedOutput,
      stderr: isSuccess ? '' : (parsedResult.error || ''),
      exitCode: isSuccess ? 0 : 1,
      success: isSuccess,
      duration,
    };
  } catch (error) {
    const duration = performance.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    console.error('ckb-debugger 执行错误:', error);
    
    return {
      stdout: '',
      stderr: `执行错误: ${errorMessage}`,
      exitCode: -1,
      success: false,
      duration,
    };
  }
}

/**
 * 检查 WASM 模块是否可用
 */
export async function checkWasmAvailability(): Promise<{ available: boolean; error?: string }> {
  try {
    // 尝试初始化来检查是否可用
    await initializeWasmer();
    return { available: true };
  } catch (error) {
    return {
      available: false,
      error: `WASM 模块加载失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 脚本组信息
 */
interface ScriptGroup {
  scriptHash: string;
  scriptGroupType: "lock" | "type";
  inputIndices: number[];
  outputIndices: number[];
  script: { code_hash: string; hash_type: string; args: string };
}

/**
 * 一键执行结果
 */
export interface RunAllResult {
  totalCycles: number;
  groups: Array<{
    scriptGroupType: "lock" | "type";
    scriptHash: string;
    inputIndices: number[];
    outputIndices: number[];
    cycles: number;
    success: boolean;
    error?: string;
  }>;
  allSuccess: boolean;
  duration: number;
  formattedOutput: string;
}

/**
 * 从 MockTx 中提取所有脚本组
 */
function extractAllScriptGroups(mockTxObj: Record<string, unknown>): ScriptGroup[] {
  const groups: Map<string, ScriptGroup> = new Map();
  
  const mockInfo = mockTxObj.mock_info as Record<string, unknown>;
  const tx = mockTxObj.tx as Record<string, unknown>;
  
  if (!mockInfo || !tx) return [];
  
  // 提取 inputs 的 lock 和 type 脚本
  const inputs = mockInfo.inputs as Array<Record<string, unknown>>;
  if (inputs) {
    inputs.forEach((input, index) => {
      const output = input.output as Record<string, unknown>;
      if (!output) return;
      
      // Lock 脚本
      const lockScript = output.lock as Record<string, unknown>;
      if (lockScript) {
        const script = {
          code_hash: lockScript.code_hash as string,
          hash_type: lockScript.hash_type as string,
          args: lockScript.args as string,
        };
        const hash = computeScriptHash(script);
        const key = `lock:${hash}`;
        
        if (groups.has(key)) {
          groups.get(key)!.inputIndices.push(index);
        } else {
          groups.set(key, {
            scriptHash: hash,
            scriptGroupType: "lock",
            inputIndices: [index],
            outputIndices: [],
            script,
          });
        }
      }
      
      // Type 脚本 (input)
      const typeScript = output.type as Record<string, unknown>;
      if (typeScript) {
        const script = {
          code_hash: typeScript.code_hash as string,
          hash_type: typeScript.hash_type as string,
          args: typeScript.args as string,
        };
        const hash = computeScriptHash(script);
        const key = `type:${hash}`;
        
        if (groups.has(key)) {
          groups.get(key)!.inputIndices.push(index);
        } else {
          groups.set(key, {
            scriptHash: hash,
            scriptGroupType: "type",
            inputIndices: [index],
            outputIndices: [],
            script,
          });
        }
      }
    });
  }
  
  // 提取 outputs 的 type 脚本
  const outputs = tx.outputs as Array<Record<string, unknown>>;
  if (outputs) {
    outputs.forEach((output, index) => {
      const typeScript = output.type as Record<string, unknown>;
      if (typeScript) {
        const script = {
          code_hash: typeScript.code_hash as string,
          hash_type: typeScript.hash_type as string,
          args: typeScript.args as string,
        };
        const hash = computeScriptHash(script);
        const key = `type:${hash}`;
        
        if (groups.has(key)) {
          groups.get(key)!.outputIndices.push(index);
        } else {
          groups.set(key, {
            scriptHash: hash,
            scriptGroupType: "type",
            inputIndices: [],
            outputIndices: [index],
            script,
          });
        }
      }
    });
  }
  
  return Array.from(groups.values());
}

/**
 * 一键执行 MockTx 中的所有脚本组
 */
export async function runAllScriptGroups(params: {
  mockTx: Uint8Array;
  maxCycles?: number;
  binaryReplacement?: {
    content: Uint8Array;
    name: string;
  };
}): Promise<RunAllResult> {
  const { mockTx, maxCycles = 3500000000, binaryReplacement } = params;
  const startTime = performance.now();
  
  // 确保已初始化
  await initializeWasmer();
  
  // 解析 mock_tx JSON
  const decoder = new TextDecoder();
  const mockTxStr = decoder.decode(mockTx);
  const mockTxObj = JSON.parse(mockTxStr);
  
  // 如果有二进制替换，应用替换
  if (binaryReplacement) {
    // 获取第一个脚本来确定 code_hash
    const groups = extractAllScriptGroups(mockTxObj);
    if (groups.length > 0) {
      replaceBinaryInMockTx(
        mockTxObj,
        groups[0].script.code_hash,
        groups[0].script.hash_type,
        binaryReplacement.content
      );
    }
  }
  
  // 提取所有脚本组
  const scriptGroups = extractAllScriptGroups(mockTxObj);
  
  if (scriptGroups.length === 0) {
    return {
      totalCycles: 0,
      groups: [],
      allSuccess: false,
      duration: performance.now() - startTime,
      formattedOutput: "错误：未找到任何脚本组",
    };
  }
  
  // 将修改后的 mockTxObj 转回字符串
  const finalMockTxStr = JSON.stringify(mockTxObj);
  
  // 执行每个脚本组
  const results: RunAllResult["groups"] = [];
  let totalCycles = 0;
  let allSuccess = true;
  
  for (const group of scriptGroups) {
    try {
      const result = run_json(
        finalMockTxStr,
        group.scriptGroupType,
        group.scriptHash,
        String(maxCycles)
      );
      
      const parsedResult = JSON.parse(result) as { cycle: number | null; error: string | null };
      const success = parsedResult.error === null;
      const cycles = parsedResult.cycle || 0;
      
      if (success) {
        totalCycles += cycles;
      } else {
        allSuccess = false;
      }
      
      results.push({
        scriptGroupType: group.scriptGroupType,
        scriptHash: group.scriptHash,
        inputIndices: group.inputIndices,
        outputIndices: group.outputIndices,
        cycles,
        success,
        error: parsedResult.error || undefined,
      });
    } catch (error) {
      allSuccess = false;
      results.push({
        scriptGroupType: group.scriptGroupType,
        scriptHash: group.scriptHash,
        inputIndices: group.inputIndices,
        outputIndices: group.outputIndices,
        cycles: 0,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  
  const duration = performance.now() - startTime;
  
  // 格式化输出
  let formattedOutput = "";
  
  if (allSuccess) {
    formattedOutput += `✓ 交易验证成功\n\n`;
  } else {
    formattedOutput += `✗ 交易验证失败\n\n`;
  }
  
  formattedOutput += `Total cycles: ${totalCycles.toLocaleString()}\n`;
  
  // 先输出 Lock 脚本组
  const lockGroups = results.filter(r => r.scriptGroupType === "lock");
  for (const group of lockGroups) {
    formattedOutput += `Lock with inputs: [${group.inputIndices.join(", ")}], outputs: []\n`;
    formattedOutput += `  Script hash: ${group.scriptHash.slice(2)}\n`;
    if (group.success) {
      formattedOutput += `  Cycles: ${group.cycles.toLocaleString()}\n`;
    } else {
      formattedOutput += `  Error: ${group.error}\n`;
    }
  }
  
  // 再输出 Type 脚本组
  const typeGroups = results.filter(r => r.scriptGroupType === "type");
  for (const group of typeGroups) {
    formattedOutput += `Type with inputs: [${group.inputIndices.join(", ")}], outputs: [${group.outputIndices.join(", ")}]\n`;
    formattedOutput += `  Script hash: ${group.scriptHash.slice(2)}\n`;
    if (group.success) {
      formattedOutput += `  Cycles: ${group.cycles.toLocaleString()}\n`;
    } else {
      formattedOutput += `  Error: ${group.error}\n`;
    }
  }
  
  formattedOutput += `\n执行时间: ${(duration / 1000).toFixed(2)}s`;
  
  return {
    totalCycles,
    groups: results,
    allSuccess,
    duration,
    formattedOutput,
  };
}
