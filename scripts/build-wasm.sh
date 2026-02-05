#!/bin/bash

# CKB Debugger WASM 编译脚本
# 此脚本用于从 ckb-standalone-debugger 源码编译 WASM 版本

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEBUGGER_DIR="$PROJECT_ROOT/ckb-standalone-debugger"
OUTPUT_DIR="$PROJECT_ROOT/src/lib/ckb-debugger-wasm"

echo "=== CKB Debugger WASM 编译脚本 ==="
echo ""

# 检查 Rust 是否安装
if ! command -v rustup &> /dev/null; then
    echo "错误: 未找到 rustup，请先安装 Rust"
    echo "访问 https://rustup.rs/ 安装 Rust"
    exit 1
fi

# 检查 wasm-pack 是否安装
if ! command -v wasm-pack &> /dev/null; then
    echo "1. 安装 wasm-pack..."
    cargo install wasm-pack
else
    echo "1. wasm-pack 已安装"
fi

# 检查源码目录
if [ ! -d "$DEBUGGER_DIR" ]; then
    echo "2. 克隆 ckb-standalone-debugger 源码..."
    git clone https://github.com/nervosnetwork/ckb-standalone-debugger "$DEBUGGER_DIR"
else
    echo "2. 源码目录已存在: $DEBUGGER_DIR"
fi

# 临时修改 Cargo.toml 禁用 wasm-opt（解决版本兼容问题）
CARGO_TOML="$DEBUGGER_DIR/ckb-debugger/Cargo.toml"
echo "3. 配置 Cargo.toml..."

# 检查是否已经有 wasm-opt = false 配置
if ! grep -q 'wasm-opt = false' "$CARGO_TOML"; then
    # 添加 package.metadata.wasm-pack.profile.release 配置
    if grep -q '\[package.metadata.wasm-pack.profile.release\]' "$CARGO_TOML"; then
        # 如果已有配置段，添加 wasm-opt = false
        sed -i.bak '/\[package.metadata.wasm-pack.profile.release\]/a wasm-opt = false' "$CARGO_TOML"
    else
        # 添加新的配置段
        echo "" >> "$CARGO_TOML"
        echo "[package.metadata.wasm-pack.profile.release]" >> "$CARGO_TOML"
        echo "wasm-opt = false" >> "$CARGO_TOML"
    fi
    echo "   已禁用 wasm-opt（解决版本兼容问题）"
fi

# 使用 wasm-pack 编译
echo "4. 使用 wasm-pack 编译 ckb-debugger..."
cd "$DEBUGGER_DIR/ckb-debugger"
wasm-pack build --target web --out-dir "$OUTPUT_DIR" --release

# 清理不需要的文件
echo "5. 清理临时文件..."
rm -f "$OUTPUT_DIR/.gitignore"
rm -f "$OUTPUT_DIR/package.json"
rm -f "$OUTPUT_DIR/README.md"

echo ""
echo "=== 编译完成 ==="
echo "输出目录: $OUTPUT_DIR"
echo ""
echo "生成的文件:"
ls -la "$OUTPUT_DIR"
echo ""
echo "现在可以运行 'npm run dev' 启动开发服务器了"
