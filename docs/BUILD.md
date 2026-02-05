# CKB Debugger WASM 编译指南

本文档介绍如何编译 ckb-debugger 的 WebAssembly 版本。

## 前置要求

1. **Rust 工具链**: 需要安装 Rust 和 Cargo
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **WASM 目标**: 需要添加 `wasm32-wasip1` 编译目标
   ```bash
   rustup target add wasm32-wasip1
   ```

## 自动编译

运行项目根目录下的编译脚本：

```bash
chmod +x scripts/build-wasm.sh
./scripts/build-wasm.sh
```

脚本会自动：
1. 检查并安装必要的编译目标
2. 克隆 ckb-standalone-debugger 源码（如果不存在）
3. 编译 WASM 版本
4. 复制到 `public/` 目录

## 手动编译

如果你想手动编译，请按以下步骤操作：

```bash
# 1. 克隆源码
git clone https://github.com/nervosnetwork/ckb-standalone-debugger
cd ckb-standalone-debugger

# 2. 添加 WASM 目标
rustup target add wasm32-wasip1

# 3. 编译
cargo build --release --target wasm32-wasip1 -p ckb-debugger

# 4. 复制 WASM 文件
cp target/wasm32-wasip1/release/ckb-debugger.wasm ../public/
```

## 输出文件

编译完成后，WASM 文件位于：
- `public/ckb-debugger.wasm`

## 注意事项

1. **编译时间**: 首次编译可能需要几分钟，因为需要下载和编译所有依赖
2. **文件大小**: Release 版本的 WASM 文件通常在 10-20MB 左右
3. **WASI 支持**: 编译的 WASM 使用 WASI (WebAssembly System Interface) 接口

## 常见问题

### Q: 编译失败，提示找不到 wasm32-wasip1 目标

A: 运行 `rustup target add wasm32-wasip1` 添加目标

### Q: 编译失败，提示内存不足

A: 尝试在编译时增加可用内存，或使用 `--jobs 1` 限制并行任务数

### Q: 如何验证 WASM 文件是否正确

A: 可以使用 `file` 命令检查：
```bash
file public/ckb-debugger.wasm
# 应该显示: WebAssembly (wasm) binary module version 0x1 (MVP)
```
