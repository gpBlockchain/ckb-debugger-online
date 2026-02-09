#!/bin/bash
# Build the ckb-vm WebAssembly module for the Script IPC Playground
# Prerequisites: Rust toolchain and wasm-pack installed
#   cargo install wasm-pack

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
VM_CRATE_DIR="$ROOT_DIR/ckb-vm-web"
OUTPUT_DIR="$ROOT_DIR/src/lib/ckb-vm-ipc-wasm"

echo "Building ckb-vm WASM module..."
echo "  Source: $VM_CRATE_DIR"
echo "  Output: $OUTPUT_DIR"

cd "$VM_CRATE_DIR"

wasm-pack build --target web --out-dir "$OUTPUT_DIR"

# Remove the generated .gitignore (otherwise files may be ignored)
rm -f "$OUTPUT_DIR/.gitignore"

echo ""
echo "Build complete! WASM module output at: $OUTPUT_DIR"
echo "You can now run 'npm run dev' to start the development server."
