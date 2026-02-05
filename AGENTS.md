# CKB Debugger Online - 维护指南

## 项目概述

CKB Debugger Online 是一个基于浏览器的 CKB 合约调试器，使用 WebAssembly 技术在浏览器中运行 ckb-debugger。

**在线地址**: https://gpblockchain.github.io/ckb-debugger-online/

## 技术栈

- **前端框架**: React 18 + TypeScript
- **构建工具**: Vite
- **样式**: Tailwind CSS
- **WASM**: ckb-debugger 编译为 WebAssembly (via wasm-pack)
- **哈希算法**: blakejs (blake2b-256)
- **CKB SDK**: @ckb-ccc/ccc (用于 RPC 交互和交易解析)

## 项目结构

```
ckb-debugger-online/
├── .github/workflows/     # GitHub Actions 部署配置
├── public/                # 静态资源
│   └── examples/          # 示例二进制文件
├── src/
│   ├── components/        # React 组件
│   │   ├── ErrorBoundary.tsx
│   │   ├── ExampleSelector.tsx
│   │   ├── FileUploader.tsx
│   │   ├── ModeSelector.tsx
│   │   ├── OutputConsole.tsx
│   │   ├── ParamsEditor.tsx
│   │   ├── Toast.tsx
│   │   └── TxFetcher.tsx      # 在线获取交易组件
│   ├── hooks/
│   │   └── useDebugger.ts     # 调试器状态管理
│   ├── lib/
│   │   ├── ckb-debugger-wasm/ # WASM 模块 (预编译)
│   │   ├── examples.ts        # 示例配置
│   │   ├── txConverter.ts     # 交易转换逻辑 (CCC SDK)
│   │   └── wasmer.ts          # WASM 封装层 (核心)
│   ├── App.tsx            # 主应用组件
│   ├── main.tsx           # 入口文件
│   └── index.css          # 全局样式
├── docs/
│   └── BUILD.md           # WASM 编译说明
└── scripts/
    └── build-wasm.sh      # WASM 编译脚本
```

## 主要功能

### 1. Mock TX 调试
上传或生成 mock_tx.json 文件，选择要调试的脚本组执行。

### 2. 在线获取交易
从 CKB 主网/测试网获取真实交易并自动转换为 MockTx 格式：
- **交易哈希**: 输入 tx hash，从链上获取交易
- **Raw TX JSON**: 粘贴 RPC 返回的交易 JSON
- **TransactionView**: 粘贴 molecule 序列化的十六进制数据

### 3. 一键执行全部脚本
自动识别并执行交易中的所有脚本组（Lock 和 Type），输出格式：
```
Total cycles: 1,703,041
Lock with inputs: [0], outputs: []
  Script hash: ea3c3c2c5dadcc00c96e9791eb077fca89885acab957946d05984a079191e970
  Cycles: 1,693,105
Type with inputs: [], outputs: [0]
  Script hash: cc77c4deac05d68ab5b26828f0bf4565a8d73113d7bb7e92b8362b8a74e58e58
  Cycles: 9,936
```

### 4. 二进制替换
上传新的合约二进制文件，替换 MockTx 中对应脚本的代码进行调试。

## 核心文件说明

### `src/lib/wasmer.ts`

WASM 模块封装层，主要函数：

- `initializeWasmer()`: 初始化 WASM 模块
- `runMockTxMode()`: 执行单个脚本组调试
- `runAllScriptGroups()`: 一键执行所有脚本组
- `computeScriptHash()`: 计算脚本的 blake2b-256 哈希
- `serializeScript()`: Molecule 格式序列化脚本
- `extractScript()`: 从 mock_tx.json 提取脚本
- `extractAllScriptGroups()`: 提取所有脚本组
- `replaceBinaryInMockTx()`: 二进制替换逻辑

**Script Hash 计算流程**:
1. 从 mock_tx.json 根据 cell-index, cell-type, script-group-type 提取脚本
2. 将脚本序列化为 Molecule 格式
3. 使用 blake2b-256 (personalization: "ckb-default-hash") 计算哈希

### `src/lib/txConverter.ts`

交易转换模块，使用 CCC SDK：

- `createClient()`: 创建 CKB RPC 客户端
- `fetchTransaction()`: 从链上获取交易
- `convertToMockTx()`: 将交易转换为 MockTx 格式
- `parseRawTxJson()`: 解析 Raw TX JSON
- `parseTransactionView()`: 解析 TransactionView (molecule hex)
- `parseDepGroupData()`: 解析 dep_group 类型的 cell data

**MockTx 转换流程**:
1. 获取交易的所有 input cells 详情
2. 获取所有 cell_deps 详情（包括展开 dep_group）
3. 获取 header_deps（如果有）
4. 组装为 MockTx 格式

### `src/components/TxFetcher.tsx`

在线获取交易的 UI 组件：
- 网络选择（主网/测试网/自定义 RPC）
- 三种输入模式：交易哈希、Raw TX JSON、TransactionView
- 转换进度显示

### `src/lib/ckb-debugger-wasm/`

预编译的 WASM 模块，由 wasm-pack 从 ckb-standalone-debugger 编译生成。

主要导出:
- `init()`: 初始化 WASM
- `run_json(mock_tx, script_group_type, script_hash, max_cycles)`: 执行调试

## 开发指南

### 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

### 重新编译 WASM 模块

如果需要更新 ckb-debugger WASM 模块：

```bash
# 1. 克隆 ckb-standalone-debugger
git clone https://github.com/nervosnetwork/ckb-standalone-debugger.git

# 2. 安装 wasm-pack
cargo install wasm-pack

# 3. 编译 WASM (在 ckb-debugger 目录)
cd ckb-standalone-debugger/ckb-debugger
wasm-pack build --target web --out-dir ../../src/lib/ckb-debugger-wasm

# 4. 删除生成的 .gitignore (否则文件会被忽略)
rm ../../src/lib/ckb-debugger-wasm/.gitignore
```

**注意**: 可能需要在 `Cargo.toml` 中添加以下配置禁用 wasm-opt：

```toml
[package.metadata.wasm-pack.profile.release]
wasm-opt = false

[package.metadata.wasm-pack.profile.dev]
wasm-opt = false
```

## Mock TX JSON 格式

调试器接受标准的 CKB mock_tx.json 格式：

```json
{
  "mock_info": {
    "inputs": [...],
    "cell_deps": [...],
    "header_deps": [...]
  },
  "tx": {
    "version": "0x0",
    "cell_deps": [...],
    "header_deps": [...],
    "inputs": [...],
    "outputs": [...],
    "outputs_data": [...],
    "witnesses": [...]
  }
}
```

## 常见问题

### Q: Script Hash 计算不正确？

检查以下几点：
1. hash_type 映射是否正确 (data=0, type=1, data1=2, data2=4)
2. Molecule 序列化是否正确 (table 格式需要偏移表)
3. blake2b personalization 必须是 "ckb-default-hash"

### Q: WASM 加载失败？

确保：
1. `src/lib/ckb-debugger-wasm/` 目录包含所有 WASM 文件
2. 没有被 .gitignore 忽略

### Q: GitHub Pages 部署失败？

检查：
1. 仓库 Settings > Pages > Source 设置为 "GitHub Actions"
2. vite.config.ts 中 base 路径正确

### Q: 在线获取交易失败？

可能的原因：
1. **CORS 限制**: 自定义 RPC 节点需要配置 CORS，使用 ckbapp.dev 公共节点无此问题
2. **交易不存在**: 检查交易哈希是否正确
3. **Cell 已被消费**: 转换逻辑会通过获取创建 Cell 的交易来获取数据，不依赖 live cell

### Q: 二进制替换没效果？

替换逻辑匹配规则：
- `hash_type=type`: 匹配 cell 的 type script hash
- `hash_type=data/data1/data2`: 匹配 cell data 的 blake2b hash

### Q: dep_group 展开失败？

dep_group 的 data 字段是 OutPointVec (molecule 格式)，解析逻辑在 `parseDepGroupData()` 函数中。

## 部署

项目使用 GitHub Actions 自动部署到 GitHub Pages：

1. 推送代码到 main 分支
2. GitHub Actions 自动构建
3. 部署到 https://gpblockchain.github.io/ckb-debugger-online/

手动触发部署：仓库 Actions 页面 > Deploy to GitHub Pages > Run workflow

## 相关链接

- [ckb-standalone-debugger](https://github.com/nervosnetwork/ckb-standalone-debugger)
- [CKB Documentation](https://docs.nervos.org/)
- [Molecule Encoding](https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0008-serialization/0008-serialization.md)
- [CCC SDK](https://github.com/ckb-devrel/ccc) - CKB JS/TS SDK

## 维护者注意事项

1. **WASM 文件较大** (~800KB)，避免频繁更新
2. **blake2b 库**: 使用 blakejs，不要替换为其他库
3. **Cross-Origin 头**: GitHub Pages 不支持自定义 headers，SharedArrayBuffer 可能受限
4. **保持兼容**: mock_tx.json 格式需要与 ckb-debugger CLI 保持一致
5. **CCC SDK**: 用于 RPC 交互，公共节点使用 `ClientPublicMainnet` / `ClientPublicTestnet`
6. **数字格式**: CKB RPC 使用 `0x` 前缀的十六进制，`txConverter.ts` 中的 `toHexString()` 函数处理格式转换
7. **dep_type 格式**: CCC SDK 返回 `depGroup`，ckb-debugger 需要 `dep_group`，由 `normalizeDepType()` 处理
