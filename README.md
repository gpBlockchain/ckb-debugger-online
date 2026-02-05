# CKB Debugger Online

在浏览器中运行 CKB 合约调试器，无需安装本地环境。

## 功能特性

- **Binary 模式**: 直接运行 RISC-V 二进制文件
- **Mock TX 模式**: 使用 mock_tx.json 模拟交易执行
- **示例加载**: 内置多个示例合约，快速体验
- **参数配置**: 支持 max-cycles、cell-index、script-group-type 等参数
- **实时输出**: 显示 stdout/stderr 输出，支持复制

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 编译 WASM 模块

```bash
./scripts/build-wasm.sh
```

> 需要安装 Rust 工具链。详见 [docs/BUILD.md](./docs/BUILD.md)

### 3. 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:5173

## 技术栈

- **前端框架**: React 18 + TypeScript
- **构建工具**: Vite
- **UI 组件**: Tailwind CSS + Headless UI
- **WASM 运行时**: @wasmer/sdk

## 项目结构

```
ckb-debugger-online/
├── public/
│   ├── ckb-debugger.wasm    # 编译后的 WASM 模块
│   └── examples/            # 示例二进制文件
├── src/
│   ├── components/          # React 组件
│   ├── hooks/               # React Hooks
│   ├── lib/                 # 工具库
│   ├── App.tsx              # 主应用
│   └── main.tsx             # 入口文件
├── scripts/
│   └── build-wasm.sh        # WASM 编译脚本
└── docs/
    └── BUILD.md             # 编译文档
```

## 使用方式

### Binary 模式

1. 上传编译好的 RISC-V 二进制文件（CKB 合约）
2. 配置参数（如 max-cycles）
3. 点击"运行调试器"

### Mock TX 模式

1. 上传 mock_tx.json 文件
2. 配置 cell-index、cell-type、script-group-type 等参数
3. 可选：上传二进制替换文件
4. 点击"运行调试器"

## 浏览器要求

- 需要支持 WebAssembly 和 SharedArrayBuffer
- 推荐使用最新版 Chrome、Firefox 或 Edge

## 相关链接

- [ckb-standalone-debugger](https://github.com/nervosnetwork/ckb-standalone-debugger)
- [PR #168: Getting wasm working again](https://github.com/nervosnetwork/ckb-standalone-debugger/pull/168)
- [Wasmer SDK](https://docs.wasmer.io/sdk/wasmer-js)

## 许可证

MIT
