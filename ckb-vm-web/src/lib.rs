use wasm_bindgen::prelude::*;

use ckb_vm::cost_model::estimate_cycles;
use ckb_vm::registers::{A0, A1, A2, A3, A4, A5, A7};
use ckb_vm::{Bytes, Memory, Register, SupportMachine, Syscalls};

use std::sync::{Arc, Mutex};

// ---------------------------------------------------------------------------
// Wire-protocol constants (mirrored from ckb-script-ipc-common)
// ---------------------------------------------------------------------------

const FIRST_FD_SLOT: u64 = 2;

// IPC Syscall numbers
const WRITE: i32 = 2605;
const READ: i32 = 2606;
const INHERITED_FD: i32 = 2607;
const CLOSE: i32 = 2608;
const DEBUG_PRINT_SYSCALL_NUMBER: i32 = 2177;

// Unsupported syscall numbers (return error if called)
const SPAWN: i32 = 2601;
const WAIT: i32 = 2602;
const PROCESS_ID: i32 = 2603;
const PIPE: i32 = 2604;

const SPAWN_YIELD_CYCLES_BASE: u64 = 800;

// ---------------------------------------------------------------------------
// CKB Syscall numbers (for mock_tx support)
// ---------------------------------------------------------------------------

const SYS_LOAD_SCRIPT: i32 = 2052;
const SYS_LOAD_TX_HASH: i32 = 2061;
const SYS_LOAD_SCRIPT_HASH: i32 = 2062;
const SYS_LOAD_CELL: i32 = 2071;
const SYS_LOAD_INPUT: i32 = 2073;
const SYS_LOAD_WITNESS: i32 = 2074;
const SYS_LOAD_CELL_BY_FIELD: i32 = 2081;
const SYS_LOAD_INPUT_BY_FIELD: i32 = 2083;
const SYS_LOAD_CELL_DATA: i32 = 2092;

// CKB Source types
const SOURCE_INPUT: u64 = 1;
const SOURCE_OUTPUT: u64 = 2;
const SOURCE_CELL_DEP: u64 = 3;
const SOURCE_GROUP_INPUT: u64 = 0x0100000000000001;
const SOURCE_GROUP_OUTPUT: u64 = 0x0100000000000002;

// CKB Cell field types
const CELL_FIELD_CAPACITY: u64 = 0;
const CELL_FIELD_DATA_HASH: u64 = 1;
const CELL_FIELD_LOCK: u64 = 2;
const CELL_FIELD_LOCK_HASH: u64 = 3;
const CELL_FIELD_TYPE: u64 = 4;
const CELL_FIELD_TYPE_HASH: u64 = 5;
const CELL_FIELD_OCCUPIED_CAPACITY: u64 = 6;

// CKB Input field types
const INPUT_FIELD_OUT_POINT: u64 = 0;
const INPUT_FIELD_SINCE: u64 = 1;

// CKB error codes
const CKB_SUCCESS: u64 = 0;
const CKB_INDEX_OUT_OF_BOUND: u64 = 1;
const CKB_ITEM_MISSING: u64 = 2;

// ---------------------------------------------------------------------------
// VLQ encoding (Variable-Length Quantity)
// ---------------------------------------------------------------------------

fn vlq_encode(mut value: u64) -> Vec<u8> {
    let mut buffer = Vec::new();
    loop {
        let mut byte = (value & 0x7F) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        buffer.push(byte);
        if value == 0 {
            break;
        }
    }
    buffer
}

fn vlq_decode(bytes: &[u8]) -> Option<(u64, usize)> {
    let mut value = 0u64;
    let mut shift = 0;
    for (i, &byte) in bytes.iter().enumerate() {
        value |= ((byte & 0x7F) as u64) << shift;
        if byte & 0x80 == 0 {
            return Some((value, i + 1));
        }
        shift += 7;
        if shift >= 64 {
            return None;
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Packet helpers (RequestPacket / ResponsePacket wire format)
// ---------------------------------------------------------------------------

/// Build a request packet: version(VLQ) + method_id(VLQ) + length(VLQ) + payload
fn build_request_packet(json: &str) -> Vec<u8> {
    let payload = json.as_bytes();
    let mut buf = Vec::new();
    buf.extend_from_slice(&vlq_encode(0)); // version
    buf.extend_from_slice(&vlq_encode(0)); // method_id
    buf.extend_from_slice(&vlq_encode(payload.len() as u64));
    buf.extend_from_slice(payload);
    buf
}

/// Parse a response packet: version(VLQ) + error_code(VLQ) + length(VLQ) + payload
fn parse_response_packet(data: &[u8]) -> Result<(u64, String), String> {
    let mut offset = 0;

    // version
    let (_version, n) =
        vlq_decode(&data[offset..]).ok_or_else(|| "failed to decode version".to_string())?;
    offset += n;

    // error_code
    let (error_code, n) =
        vlq_decode(&data[offset..]).ok_or_else(|| "failed to decode error_code".to_string())?;
    offset += n;

    // payload length
    let (length, n) = vlq_decode(&data[offset..])
        .ok_or_else(|| "failed to decode payload length".to_string())?;
    offset += n;

    let end = offset + length as usize;
    if end > data.len() {
        return Err(format!(
            "payload length {} exceeds available data {}",
            length,
            data.len() - offset
        ));
    }

    let payload = String::from_utf8_lossy(&data[offset..end]).into_owned();
    Ok((error_code, payload))
}

// ---------------------------------------------------------------------------
// In-memory pipe (single-threaded, for WASM)
// ---------------------------------------------------------------------------

/// Shared buffer that the VM reads from (pre-filled with request data).
#[derive(Clone)]
struct ReadBuffer {
    inner: Arc<Mutex<ReadBufferInner>>,
}

struct ReadBufferInner {
    data: Vec<u8>,
    pos: usize,
}

impl ReadBuffer {
    fn new(data: Vec<u8>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(ReadBufferInner { data, pos: 0 })),
        }
    }

    fn read(&self, buf: &mut [u8]) -> usize {
        let mut inner = self.inner.lock().unwrap();
        let remaining = inner.data.len() - inner.pos;
        if remaining == 0 {
            return 0; // EOF
        }
        let to_read = buf.len().min(remaining);
        buf[..to_read].copy_from_slice(&inner.data[inner.pos..inner.pos + to_read]);
        inner.pos += to_read;
        to_read
    }
}

/// Shared buffer that the VM writes to (collects response data).
#[derive(Clone)]
struct WriteBuffer {
    inner: Arc<Mutex<Vec<u8>>>,
}

impl WriteBuffer {
    fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn write(&self, data: &[u8]) {
        self.inner.lock().unwrap().extend_from_slice(data);
    }

    fn into_data(self) -> Vec<u8> {
        Arc::try_unwrap(self.inner)
            .map(|m| m.into_inner().unwrap())
            .unwrap_or_else(|arc| arc.lock().unwrap().clone())
    }
}

/// Collects debug print output from the VM.
#[derive(Clone)]
struct DebugLog {
    inner: Arc<Mutex<Vec<String>>>,
}

impl DebugLog {
    fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn push(&self, msg: String) {
        self.inner.lock().unwrap().push(msg);
    }

    fn into_messages(self) -> Vec<String> {
        Arc::try_unwrap(self.inner)
            .map(|m| m.into_inner().unwrap())
            .unwrap_or_else(|arc| arc.lock().unwrap().clone())
    }
}

// ---------------------------------------------------------------------------
// CKB VM Syscall implementations for WASM
// ---------------------------------------------------------------------------

struct DebugSyscall {
    log: DebugLog,
}

impl<Mac: SupportMachine> Syscalls<Mac> for DebugSyscall {
    fn initialize(&mut self, _machine: &mut Mac) -> Result<(), ckb_vm::error::Error> {
        Ok(())
    }

    fn ecall(&mut self, machine: &mut Mac) -> Result<bool, ckb_vm::error::Error> {
        let code = machine.registers()[A7].to_i32();

        // Unsupported syscalls
        if code == SPAWN || code == WAIT || code == PROCESS_ID || code == PIPE {
            return Err(ckb_vm::error::Error::IO {
                kind: std::io::ErrorKind::Other,
                data: "unsupported syscalls: spawn, wait, process_id and pipe".into(),
            });
        }

        if code != DEBUG_PRINT_SYSCALL_NUMBER {
            return Ok(false);
        }

        let mut addr = machine.registers()[A0].to_u64();
        let mut buffer = Vec::new();
        loop {
            let byte = machine
                .memory_mut()
                .load8(&Mac::REG::from_u64(addr))?
                .to_u8();
            if byte == 0 {
                break;
            }
            buffer.push(byte);
            addr += 1;
        }

        let s = String::from_utf8_lossy(&buffer).into_owned();
        self.log.push(s);
        machine.set_register(A0, Mac::REG::from_u8(0));
        Ok(true)
    }
}

struct ReadSyscall {
    buf: ReadBuffer,
}

impl<Mac: SupportMachine> Syscalls<Mac> for ReadSyscall {
    fn initialize(&mut self, _machine: &mut Mac) -> Result<(), ckb_vm::error::Error> {
        Ok(())
    }

    fn ecall(&mut self, machine: &mut Mac) -> Result<bool, ckb_vm::error::Error> {
        if machine.registers()[A7].to_i32() != READ {
            return Ok(false);
        }
        let fd = machine.registers()[A0].to_u64();
        if fd != FIRST_FD_SLOT {
            return Err(ckb_vm::error::Error::IO {
                kind: std::io::ErrorKind::Other,
                data: "can only read on pipe 2".into(),
            });
        }
        let buffer_addr = machine.registers()[A1].clone();
        let length_addr = machine.registers()[A2].clone();
        let length = machine.memory_mut().load64(&length_addr)?.to_u64() as usize;
        let mut tmp = vec![0u8; length];
        let real_len = self.buf.read(&mut tmp);
        machine
            .memory_mut()
            .store_bytes(buffer_addr.to_u64(), &tmp[..real_len])?;
        machine
            .memory_mut()
            .store64(&length_addr, &Mac::REG::from_u64(real_len as u64))?;
        machine.add_cycles_no_checking(SPAWN_YIELD_CYCLES_BASE)?;
        machine.set_register(A0, Mac::REG::from_u8(0));
        Ok(true)
    }
}

struct WriteSyscall {
    buf: WriteBuffer,
}

impl<Mac: SupportMachine> Syscalls<Mac> for WriteSyscall {
    fn initialize(&mut self, _machine: &mut Mac) -> Result<(), ckb_vm::error::Error> {
        Ok(())
    }

    fn ecall(&mut self, machine: &mut Mac) -> Result<bool, ckb_vm::error::Error> {
        if machine.registers()[A7].to_i32() != WRITE {
            return Ok(false);
        }
        let fd = machine.registers()[A0].to_u64();
        if fd != (FIRST_FD_SLOT + 1) {
            return Err(ckb_vm::error::Error::IO {
                kind: std::io::ErrorKind::Other,
                data: "can only write on pipe 3".into(),
            });
        }
        let buffer_addr = machine.registers()[A1].clone();
        let length_addr = machine.registers()[A2].clone();
        let length = machine.memory_mut().load64(&length_addr)?.to_u64();
        if length == 0 {
            machine.set_register(A0, Mac::REG::from_u8(0));
            return Ok(true);
        }
        let bytes = machine
            .memory_mut()
            .load_bytes(buffer_addr.to_u64(), length)?;
        self.buf.write(&bytes);
        machine
            .memory_mut()
            .store64(&length_addr, &Mac::REG::from_u64(bytes.len() as u64))?;
        machine.add_cycles_no_checking(SPAWN_YIELD_CYCLES_BASE)?;
        machine.set_register(A0, Mac::REG::from_u8(0));
        Ok(true)
    }
}

struct InheritedFdSyscall;

impl<Mac: SupportMachine> Syscalls<Mac> for InheritedFdSyscall {
    fn initialize(&mut self, _machine: &mut Mac) -> Result<(), ckb_vm::error::Error> {
        Ok(())
    }

    fn ecall(&mut self, machine: &mut Mac) -> Result<bool, ckb_vm::error::Error> {
        if machine.registers()[A7].to_i32() != INHERITED_FD {
            return Ok(false);
        }
        let buffer_addr = machine.registers()[A0].clone();
        let length_addr = machine.registers()[A1].clone();
        let length = machine.memory_mut().load64(&length_addr)?;
        if length.to_u64() < 2 {
            return Err(ckb_vm::error::Error::IO {
                kind: std::io::ErrorKind::Other,
                data: "length of inherited fd is less than 2".into(),
            });
        }
        let mut inherited_fd = [0u8; 16];
        inherited_fd[0..8].copy_from_slice(&FIRST_FD_SLOT.to_le_bytes());
        inherited_fd[8..16].copy_from_slice(&(FIRST_FD_SLOT + 1).to_le_bytes());
        machine
            .memory_mut()
            .store_bytes(buffer_addr.to_u64(), &inherited_fd)?;
        machine
            .memory_mut()
            .store64(&length_addr, &Mac::REG::from_u64(2))?;
        machine.set_register(A0, Mac::REG::from_u8(0));
        machine.add_cycles_no_checking(SPAWN_YIELD_CYCLES_BASE)?;
        Ok(true)
    }
}

struct CloseSyscall;

impl<Mac: SupportMachine> Syscalls<Mac> for CloseSyscall {
    fn initialize(&mut self, _machine: &mut Mac) -> Result<(), ckb_vm::error::Error> {
        Ok(())
    }

    fn ecall(&mut self, machine: &mut Mac) -> Result<bool, ckb_vm::error::Error> {
        if machine.registers()[A7].to_i32() != CLOSE {
            return Ok(false);
        }
        machine.set_register(A0, Mac::REG::from_u8(0));
        Ok(true)
    }
}

// ---------------------------------------------------------------------------
// Blake2b-256 hash (CKB default hash)
// ---------------------------------------------------------------------------

fn ckb_blake2b_256(data: &[u8]) -> [u8; 32] {
    let mut hasher = blake2b_ref::Blake2bBuilder::new(32)
        .personal(b"ckb-default-hash")
        .build();
    hasher.update(data);
    let mut hash = [0u8; 32];
    hasher.finalize(&mut hash);
    hash
}

// ---------------------------------------------------------------------------
// Hex helpers
// ---------------------------------------------------------------------------

fn hex_to_bytes(hex: &str) -> Result<Vec<u8>, String> {
    let hex = hex.strip_prefix("0x").unwrap_or(hex);
    if hex.is_empty() {
        return Ok(Vec::new());
    }
    if hex.len() % 2 != 0 {
        return Err("odd hex length".into());
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&hex[i..i + 2], 16)
                .map_err(|e| format!("hex parse error at {}: {}", i, e))
        })
        .collect()
}

fn parse_hex_u64(s: &str) -> Result<u64, String> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    u64::from_str_radix(s, 16).map_err(|e| format!("hex u64 parse error: {}", e))
}

fn parse_hex_u32(s: &str) -> Result<u32, String> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    u32::from_str_radix(s, 16).map_err(|e| format!("hex u32 parse error: {}", e))
}

// ---------------------------------------------------------------------------
// Molecule serialization helpers
// ---------------------------------------------------------------------------

/// Serialize a Script in molecule format
fn mol_serialize_script(code_hash: &[u8; 32], hash_type: u8, args: &[u8]) -> Vec<u8> {
    let header_size: u32 = 4 + 4 * 3; // full_size + 3 offsets
    let total_size = header_size as usize + 32 + 1 + 4 + args.len();
    let mut buf = Vec::with_capacity(total_size);
    buf.extend_from_slice(&(total_size as u32).to_le_bytes());
    buf.extend_from_slice(&header_size.to_le_bytes()); // offset: code_hash
    buf.extend_from_slice(&(header_size + 32).to_le_bytes()); // offset: hash_type
    buf.extend_from_slice(&(header_size + 33).to_le_bytes()); // offset: args
    buf.extend_from_slice(code_hash);
    buf.push(hash_type);
    buf.extend_from_slice(&(args.len() as u32).to_le_bytes()); // fixvec length
    buf.extend_from_slice(args);
    buf
}

/// Serialize a CellOutput in molecule format
fn mol_serialize_cell_output(
    capacity: u64,
    lock_script: &[u8],
    type_script: Option<&[u8]>,
) -> Vec<u8> {
    let num_fields = 3u32;
    let header_size = 4 + 4 * num_fields; // full_size + 3 offsets
    let capacity_size = 8u32;

    let type_opt = match type_script {
        Some(ts) => ts.to_vec(),
        None => Vec::new(), // empty = None in molecule option
    };

    let total_size =
        header_size as usize + capacity_size as usize + lock_script.len() + type_opt.len();

    let mut buf = Vec::with_capacity(total_size);
    buf.extend_from_slice(&(total_size as u32).to_le_bytes());
    let off0 = header_size;
    let off1 = off0 + capacity_size;
    let off2 = off1 + lock_script.len() as u32;
    buf.extend_from_slice(&off0.to_le_bytes());
    buf.extend_from_slice(&off1.to_le_bytes());
    buf.extend_from_slice(&off2.to_le_bytes());
    buf.extend_from_slice(&capacity.to_le_bytes());
    buf.extend_from_slice(lock_script);
    buf.extend_from_slice(&type_opt);
    buf
}

/// Serialize a CellInput in molecule format (struct, fixed size = 44 bytes)
fn mol_serialize_cell_input(since: u64, tx_hash: &[u8; 32], index: u32) -> Vec<u8> {
    let mut buf = Vec::with_capacity(44);
    buf.extend_from_slice(&since.to_le_bytes()); // 8 bytes
    buf.extend_from_slice(tx_hash); // 32 bytes
    buf.extend_from_slice(&index.to_le_bytes()); // 4 bytes
    buf
}

/// Serialize an OutPoint in molecule format (struct, fixed size = 36 bytes)
fn mol_serialize_out_point(tx_hash: &[u8; 32], index: u32) -> Vec<u8> {
    let mut buf = Vec::with_capacity(36);
    buf.extend_from_slice(tx_hash); // 32 bytes
    buf.extend_from_slice(&index.to_le_bytes()); // 4 bytes
    buf
}

// ---------------------------------------------------------------------------
// Mock TX data structures
// ---------------------------------------------------------------------------

/// Parsed cell information from mock_tx
#[derive(Clone)]
struct MockCell {
    capacity: u64,
    data: Vec<u8>,
    lock_script_serialized: Vec<u8>,
    lock_hash: [u8; 32],
    type_script_serialized: Option<Vec<u8>>,
    type_hash: Option<[u8; 32]>,
    cell_output_serialized: Vec<u8>,
}

/// Parsed input information from mock_tx
#[derive(Clone)]
struct MockInput {
    since: u64,
    prev_tx_hash: [u8; 32],
    prev_index: u32,
    cell: MockCell,
}

/// All parsed mock_tx data needed for syscalls
struct MockTxData {
    inputs: Vec<MockInput>,
    outputs: Vec<MockCell>,
    cell_deps: Vec<MockCell>,
    witnesses: Vec<Vec<u8>>,
    tx_hash: [u8; 32],
    current_script_serialized: Vec<u8>,
    current_script_hash: [u8; 32],
    group_input_indices: Vec<usize>,
    group_output_indices: Vec<usize>,
}

// ---------------------------------------------------------------------------
// Mock TX JSON parsing
// ---------------------------------------------------------------------------

fn hash_type_to_byte(hash_type: &str) -> u8 {
    match hash_type {
        "data" => 0,
        "type" => 1,
        "data1" => 2,
        "data2" => 4,
        _ => 0,
    }
}

fn parse_script_from_json(
    v: &serde_json::Value,
) -> Result<(Vec<u8>, [u8; 32], [u8; 32], u8, Vec<u8>), String> {
    let code_hash_hex = v["code_hash"]
        .as_str()
        .ok_or("missing code_hash")?;
    let hash_type_str = v["hash_type"]
        .as_str()
        .ok_or("missing hash_type")?;
    let args_hex = v["args"].as_str().ok_or("missing args")?;

    let code_hash_bytes = hex_to_bytes(code_hash_hex)?;
    if code_hash_bytes.len() != 32 {
        return Err("code_hash must be 32 bytes".into());
    }
    let mut code_hash = [0u8; 32];
    code_hash.copy_from_slice(&code_hash_bytes);

    let hash_type_byte = hash_type_to_byte(hash_type_str);
    let args = hex_to_bytes(args_hex)?;

    let serialized = mol_serialize_script(&code_hash, hash_type_byte, &args);
    let hash = ckb_blake2b_256(&serialized);

    Ok((serialized, hash, code_hash, hash_type_byte, args))
}

fn parse_mock_cell(output_json: &serde_json::Value, data_hex: &str) -> Result<MockCell, String> {
    let capacity = parse_hex_u64(
        output_json["capacity"]
            .as_str()
            .ok_or("missing capacity")?,
    )?;
    let data = hex_to_bytes(data_hex)?;

    let (lock_serialized, lock_hash, _, _, _) =
        parse_script_from_json(&output_json["lock"])?;

    let (type_serialized, type_hash) = if output_json["type"].is_null() {
        (None, None)
    } else {
        let (ts, th, _, _, _) = parse_script_from_json(&output_json["type"])?;
        (Some(ts), Some(th))
    };

    let cell_output = mol_serialize_cell_output(
        capacity,
        &lock_serialized,
        type_serialized.as_deref(),
    );

    Ok(MockCell {
        capacity,
        data,
        lock_script_serialized: lock_serialized,
        lock_hash,
        type_script_serialized: type_serialized,
        type_hash,
        cell_output_serialized: cell_output,
    })
}

fn parse_mock_tx(
    json_str: &str,
    script_group_type: &str,
    script_hash_hex: &str,
) -> Result<MockTxData, String> {
    let v: serde_json::Value =
        serde_json::from_str(json_str).map_err(|e| format!("JSON parse error: {}", e))?;

    let script_hash_bytes = hex_to_bytes(script_hash_hex)?;
    if script_hash_bytes.len() != 32 {
        return Err("script_hash must be 32 bytes".into());
    }
    let mut current_script_hash = [0u8; 32];
    current_script_hash.copy_from_slice(&script_hash_bytes);

    // Parse inputs from mock_info.inputs
    let mut inputs = Vec::new();
    if let Some(mock_inputs) = v["mock_info"]["inputs"].as_array() {
        for mi in mock_inputs {
            let output_json = &mi["output"];
            let data_hex = mi["data"].as_str().unwrap_or("0x");
            let cell = parse_mock_cell(output_json, data_hex)?;

            let input_json = &mi["input"];
            let since = parse_hex_u64(
                input_json["since"].as_str().unwrap_or("0x0"),
            )?;
            let prev_out = &input_json["previous_output"];
            let prev_tx_hash_hex = prev_out["tx_hash"]
                .as_str()
                .unwrap_or("0x0000000000000000000000000000000000000000000000000000000000000000");
            let prev_tx_hash_bytes = hex_to_bytes(prev_tx_hash_hex)?;
            let mut prev_tx_hash = [0u8; 32];
            if prev_tx_hash_bytes.len() == 32 {
                prev_tx_hash.copy_from_slice(&prev_tx_hash_bytes);
            }
            let prev_index = parse_hex_u32(
                prev_out["index"].as_str().unwrap_or("0x0"),
            )?;

            inputs.push(MockInput {
                since,
                prev_tx_hash,
                prev_index,
                cell,
            });
        }
    }

    // Parse outputs from tx.outputs + tx.outputs_data
    let mut outputs = Vec::new();
    if let Some(tx_outputs) = v["tx"]["outputs"].as_array() {
        let outputs_data = v["tx"]["outputs_data"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        for (i, output_json) in tx_outputs.iter().enumerate() {
            let data_hex = outputs_data
                .get(i)
                .and_then(|d| d.as_str())
                .unwrap_or("0x");
            let cell = parse_mock_cell(output_json, data_hex)?;
            outputs.push(cell);
        }
    }

    // Parse cell_deps from mock_info.cell_deps
    let mut cell_deps = Vec::new();
    if let Some(mock_cell_deps) = v["mock_info"]["cell_deps"].as_array() {
        for cd in mock_cell_deps {
            let output_json = &cd["output"];
            let data_hex = cd["data"].as_str().unwrap_or("0x");
            let cell = parse_mock_cell(output_json, data_hex)?;
            cell_deps.push(cell);
        }
    }

    // Parse witnesses
    let mut witnesses = Vec::new();
    if let Some(tx_witnesses) = v["tx"]["witnesses"].as_array() {
        for w in tx_witnesses {
            let hex = w.as_str().unwrap_or("0x");
            witnesses.push(hex_to_bytes(hex)?);
        }
    }

    // Compute tx_hash from the transaction.
    // NOTE: This is a simplified hash for mock purposes only. Real CKB computes
    // tx_hash from molecule-serialized RawTransaction. Scripts that depend on
    // exact tx_hash matching may not work correctly with this approximation.
    let tx_json_str = v["tx"].to_string();
    let tx_hash = ckb_blake2b_256(tx_json_str.as_bytes());

    // Find the current script by matching script_hash
    let mut current_script_serialized = Vec::new();
    let is_lock = script_group_type == "lock";

    // Search inputs for the script
    for input in &inputs {
        let (script_ser, hash) = if is_lock {
            (&input.cell.lock_script_serialized, &input.cell.lock_hash)
        } else {
            match (&input.cell.type_script_serialized, &input.cell.type_hash) {
                (Some(ts), Some(th)) => (ts, th),
                _ => continue,
            }
        };
        if hash == &current_script_hash {
            current_script_serialized = script_ser.clone();
            break;
        }
    }

    // If not found in inputs, search outputs
    if current_script_serialized.is_empty() {
        for output in &outputs {
            let (script_ser, hash) = if is_lock {
                (&output.lock_script_serialized, &output.lock_hash)
            } else {
                match (&output.type_script_serialized, &output.type_hash) {
                    (Some(ts), Some(th)) => (ts, th),
                    _ => continue,
                }
            };
            if hash == &current_script_hash {
                current_script_serialized = script_ser.clone();
                break;
            }
        }
    }

    // Compute group input/output indices
    let mut group_input_indices = Vec::new();
    for (i, input) in inputs.iter().enumerate() {
        let hash = if is_lock {
            &input.cell.lock_hash
        } else {
            match &input.cell.type_hash {
                Some(th) => th,
                None => continue,
            }
        };
        if hash == &current_script_hash {
            group_input_indices.push(i);
        }
    }

    let mut group_output_indices = Vec::new();
    for (i, output) in outputs.iter().enumerate() {
        let hash = if is_lock {
            &output.lock_hash
        } else {
            match &output.type_hash {
                Some(th) => th,
                None => continue,
            }
        };
        if hash == &current_script_hash {
            group_output_indices.push(i);
        }
    }

    Ok(MockTxData {
        inputs,
        outputs,
        cell_deps,
        witnesses,
        tx_hash,
        current_script_serialized,
        current_script_hash,
        group_input_indices,
        group_output_indices,
    })
}

// ---------------------------------------------------------------------------
// CKB Mock TX Syscall implementation
// ---------------------------------------------------------------------------

struct MockTxSyscall {
    data: Arc<MockTxData>,
}

impl MockTxSyscall {
    fn new(data: MockTxData) -> Self {
        Self {
            data: Arc::new(data),
        }
    }

    /// Helper: load data into VM memory with offset/length semantics
    fn load_data<Mac: SupportMachine>(
        machine: &mut Mac,
        data: &[u8],
    ) -> Result<u64, ckb_vm::error::Error> {
        let buf_addr = machine.registers()[A0].to_u64();
        let len_addr = machine.registers()[A1].clone();
        let offset = machine.registers()[A2].to_u64() as usize;

        let max_len = machine.memory_mut().load64(&len_addr)?.to_u64() as usize;

        if offset >= data.len() {
            machine
                .memory_mut()
                .store64(&len_addr, &Mac::REG::from_u64(0))?;
            return Ok(CKB_SUCCESS);
        }

        let remaining = &data[offset..];
        let copy_len = remaining.len().min(max_len);

        machine
            .memory_mut()
            .store_bytes(buf_addr, &remaining[..copy_len])?;
        machine
            .memory_mut()
            .store64(&len_addr, &Mac::REG::from_u64(remaining.len() as u64))?;

        Ok(CKB_SUCCESS)
    }

    fn get_cell_by_source_index(&self, source: u64, index: u64) -> Option<&MockCell> {
        let idx = index as usize;
        match source {
            SOURCE_INPUT => self.data.inputs.get(idx).map(|i| &i.cell),
            SOURCE_OUTPUT => self.data.outputs.get(idx),
            SOURCE_CELL_DEP => self.data.cell_deps.get(idx),
            SOURCE_GROUP_INPUT => {
                let real_idx = self.data.group_input_indices.get(idx)?;
                Some(&self.data.inputs[*real_idx].cell)
            }
            SOURCE_GROUP_OUTPUT => {
                let real_idx = self.data.group_output_indices.get(idx)?;
                Some(&self.data.outputs[*real_idx])
            }
            _ => None,
        }
    }

    fn get_input_by_source_index(&self, source: u64, index: u64) -> Option<&MockInput> {
        let idx = index as usize;
        match source {
            SOURCE_INPUT => self.data.inputs.get(idx),
            SOURCE_GROUP_INPUT => {
                let real_idx = self.data.group_input_indices.get(idx)?;
                Some(&self.data.inputs[*real_idx])
            }
            _ => None,
        }
    }
}

impl<Mac: SupportMachine> Syscalls<Mac> for MockTxSyscall {
    fn initialize(&mut self, _machine: &mut Mac) -> Result<(), ckb_vm::error::Error> {
        Ok(())
    }

    fn ecall(&mut self, machine: &mut Mac) -> Result<bool, ckb_vm::error::Error> {
        let code = machine.registers()[A7].to_i32();

        match code {
            SYS_LOAD_SCRIPT => {
                let ret = Self::load_data(machine, &self.data.current_script_serialized)?;
                machine.set_register(A0, Mac::REG::from_u64(ret));
                Ok(true)
            }

            SYS_LOAD_SCRIPT_HASH => {
                let ret = Self::load_data(machine, &self.data.current_script_hash)?;
                machine.set_register(A0, Mac::REG::from_u64(ret));
                Ok(true)
            }

            SYS_LOAD_TX_HASH => {
                let ret = Self::load_data(machine, &self.data.tx_hash)?;
                machine.set_register(A0, Mac::REG::from_u64(ret));
                Ok(true)
            }

            SYS_LOAD_CELL => {
                let index = machine.registers()[A3].to_u64();
                let source = machine.registers()[A4].to_u64();

                match self.get_cell_by_source_index(source, index) {
                    Some(cell) => {
                        let ret = Self::load_data(machine, &cell.cell_output_serialized)?;
                        machine.set_register(A0, Mac::REG::from_u64(ret));
                    }
                    None => {
                        machine.set_register(A0, Mac::REG::from_u64(CKB_INDEX_OUT_OF_BOUND));
                    }
                }
                Ok(true)
            }

            SYS_LOAD_CELL_DATA => {
                let index = machine.registers()[A3].to_u64();
                let source = machine.registers()[A4].to_u64();

                match self.get_cell_by_source_index(source, index) {
                    Some(cell) => {
                        let ret = Self::load_data(machine, &cell.data)?;
                        machine.set_register(A0, Mac::REG::from_u64(ret));
                    }
                    None => {
                        machine.set_register(A0, Mac::REG::from_u64(CKB_INDEX_OUT_OF_BOUND));
                    }
                }
                Ok(true)
            }

            SYS_LOAD_CELL_BY_FIELD => {
                let index = machine.registers()[A3].to_u64();
                let source = machine.registers()[A4].to_u64();
                let field = machine.registers()[A5].to_u64();

                match self.get_cell_by_source_index(source, index) {
                    Some(cell) => {
                        let data: Option<Vec<u8>> = match field {
                            CELL_FIELD_CAPACITY => Some(cell.capacity.to_le_bytes().to_vec()),
                            CELL_FIELD_DATA_HASH => {
                                let hash = ckb_blake2b_256(&cell.data);
                                Some(hash.to_vec())
                            }
                            CELL_FIELD_LOCK => Some(cell.lock_script_serialized.clone()),
                            CELL_FIELD_LOCK_HASH => Some(cell.lock_hash.to_vec()),
                            CELL_FIELD_TYPE => cell.type_script_serialized.clone(),
                            CELL_FIELD_TYPE_HASH => cell.type_hash.map(|h| h.to_vec()),
                            CELL_FIELD_OCCUPIED_CAPACITY => {
                                // Simplified: capacity of the cell
                                Some(cell.capacity.to_le_bytes().to_vec())
                            }
                            _ => None,
                        };

                        match data {
                            Some(d) => {
                                let ret = Self::load_data(machine, &d)?;
                                machine.set_register(A0, Mac::REG::from_u64(ret));
                            }
                            None => {
                                machine
                                    .set_register(A0, Mac::REG::from_u64(CKB_ITEM_MISSING));
                            }
                        }
                    }
                    None => {
                        machine.set_register(A0, Mac::REG::from_u64(CKB_INDEX_OUT_OF_BOUND));
                    }
                }
                Ok(true)
            }

            SYS_LOAD_INPUT => {
                let index = machine.registers()[A3].to_u64();
                let source = machine.registers()[A4].to_u64();

                match self.get_input_by_source_index(source, index) {
                    Some(input) => {
                        let serialized = mol_serialize_cell_input(
                            input.since,
                            &input.prev_tx_hash,
                            input.prev_index,
                        );
                        let ret = Self::load_data(machine, &serialized)?;
                        machine.set_register(A0, Mac::REG::from_u64(ret));
                    }
                    None => {
                        machine.set_register(A0, Mac::REG::from_u64(CKB_INDEX_OUT_OF_BOUND));
                    }
                }
                Ok(true)
            }

            SYS_LOAD_INPUT_BY_FIELD => {
                let index = machine.registers()[A3].to_u64();
                let source = machine.registers()[A4].to_u64();
                let field = machine.registers()[A5].to_u64();

                match self.get_input_by_source_index(source, index) {
                    Some(input) => {
                        let data = match field {
                            INPUT_FIELD_OUT_POINT => {
                                mol_serialize_out_point(&input.prev_tx_hash, input.prev_index)
                            }
                            INPUT_FIELD_SINCE => input.since.to_le_bytes().to_vec(),
                            _ => {
                                machine
                                    .set_register(A0, Mac::REG::from_u64(CKB_ITEM_MISSING));
                                return Ok(true);
                            }
                        };
                        let ret = Self::load_data(machine, &data)?;
                        machine.set_register(A0, Mac::REG::from_u64(ret));
                    }
                    None => {
                        machine.set_register(A0, Mac::REG::from_u64(CKB_INDEX_OUT_OF_BOUND));
                    }
                }
                Ok(true)
            }

            SYS_LOAD_WITNESS => {
                let index = machine.registers()[A3].to_u64() as usize;
                let source = machine.registers()[A4].to_u64();

                // Witnesses are indexed by input index (for Input/GroupInput source)
                // or output index (for Output/GroupOutput source)
                let real_index = match source {
                    SOURCE_INPUT | SOURCE_OUTPUT | SOURCE_CELL_DEP => index,
                    SOURCE_GROUP_INPUT => {
                        match self.data.group_input_indices.get(index) {
                            Some(&ri) => ri,
                            None => {
                                machine.set_register(
                                    A0,
                                    Mac::REG::from_u64(CKB_INDEX_OUT_OF_BOUND),
                                );
                                return Ok(true);
                            }
                        }
                    }
                    SOURCE_GROUP_OUTPUT => {
                        match self.data.group_output_indices.get(index) {
                            Some(&ri) => ri,
                            None => {
                                machine.set_register(
                                    A0,
                                    Mac::REG::from_u64(CKB_INDEX_OUT_OF_BOUND),
                                );
                                return Ok(true);
                            }
                        }
                    }
                    _ => {
                        machine.set_register(A0, Mac::REG::from_u64(CKB_INDEX_OUT_OF_BOUND));
                        return Ok(true);
                    }
                };

                match self.data.witnesses.get(real_index) {
                    Some(witness) => {
                        let ret = Self::load_data(machine, witness)?;
                        machine.set_register(A0, Mac::REG::from_u64(ret));
                    }
                    None => {
                        machine.set_register(A0, Mac::REG::from_u64(CKB_INDEX_OUT_OF_BOUND));
                    }
                }
                Ok(true)
            }

            _ => Ok(false), // Not a CKB syscall we handle
        }
    }
}

// ---------------------------------------------------------------------------
// Result type exposed to JavaScript
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub struct ExecuteResult {
    json_response: String,
    debug_messages: Vec<String>,
    cycles: u64,
}

#[wasm_bindgen]
impl ExecuteResult {
    #[wasm_bindgen(getter)]
    pub fn json_response(&self) -> String {
        self.json_response.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn cycles(&self) -> u64 {
        self.cycles
    }

    #[wasm_bindgen(getter)]
    pub fn debug_messages(&self) -> js_sys::Array {
        self.debug_messages
            .iter()
            .map(|s| JsValue::from_str(s))
            .collect()
    }
}

// ---------------------------------------------------------------------------
// Main entry point for JavaScript
// ---------------------------------------------------------------------------

/// Execute a CKB script binary with the given arguments and JSON request.
///
/// # Arguments
/// * `binary` - The RISC-V binary (CKB script) as a byte array
/// * `args` - Comma-separated command-line arguments for the script (e.g. "server_entry")
/// * `json_request` - The JSON request string to send to the server
///
/// # Returns
/// An `ExecuteResult` containing the JSON response, debug messages, and cycle count.
#[wasm_bindgen]
pub fn execute_script(
    binary: &[u8],
    args: &str,
    json_request: &str,
) -> Result<ExecuteResult, JsValue> {
    // Build the request packet
    let request_data = build_request_packet(json_request.trim());

    // Set up in-memory I/O
    let read_buf = ReadBuffer::new(request_data);
    let write_buf = WriteBuffer::new();
    let debug_log = DebugLog::new();

    // Build argument list
    let code = Bytes::copy_from_slice(binary);
    let vm_args: Vec<Bytes> = args
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| Bytes::copy_from_slice(s.as_bytes()))
        .collect();

    // Create the CKB VM interpreter
    let core_machine = ckb_vm::DefaultCoreMachine::<u64, ckb_vm::SparseMemory<u64>>::new(
        ckb_vm::ISA_IMC | ckb_vm::ISA_B | ckb_vm::ISA_MOP,
        ckb_vm::machine::VERSION2,
        u64::MAX,
    );
    let mut machine = ckb_vm::DefaultMachineBuilder::new(core_machine)
        .instruction_cycle_func(Box::new(estimate_cycles))
        .syscall(Box::new(DebugSyscall {
            log: debug_log.clone(),
        }))
        .syscall(Box::new(ReadSyscall {
            buf: read_buf,
        }))
        .syscall(Box::new(WriteSyscall {
            buf: write_buf.clone(),
        }))
        .syscall(Box::new(InheritedFdSyscall))
        .syscall(Box::new(CloseSyscall))
        .build();

    // Load and run the program
    let args_iter = vm_args.into_iter().map(Ok);
    machine
        .load_program(&code, args_iter)
        .map_err(|e| JsValue::from_str(&format!("Failed to load program: {:?}", e)))?;

    // The VM will process one request, write the response, then fail on the
    // next read (EOF) which is expected. We ignore the exit code.
    let _exit = machine.run();
    let cycles = machine.cycles();

    // Extract response from write buffer
    let output = write_buf.into_data();
    let debug_messages = debug_log.into_messages();

    if output.is_empty() {
        return Err(JsValue::from_str(
            "No response received from the script. Check that the binary is a valid CKB IPC server and the arguments are correct.",
        ));
    }

    // Parse the response packet
    let (error_code, json_response) =
        parse_response_packet(&output).map_err(|e| JsValue::from_str(&e))?;

    if error_code != 0 {
        return Err(JsValue::from_str(&format!(
            "Server returned error code: {}. Response: {}",
            error_code, json_response
        )));
    }

    Ok(ExecuteResult {
        json_response,
        debug_messages,
        cycles,
    })
}

// ---------------------------------------------------------------------------
// Entry point with mock_tx support (for server scripts that use CKB syscalls)
// ---------------------------------------------------------------------------

/// Execute a CKB script binary with IPC and mock transaction context.
///
/// This extends `execute_script` by also providing CKB syscall support so that
/// server scripts that read transaction information (e.g. ckb_load_script,
/// ckb_load_cell_data) can work correctly.
///
/// # Arguments
/// * `binary` - The RISC-V binary (CKB script) as a byte array
/// * `args` - Comma-separated command-line arguments for the script
/// * `json_request` - The JSON request string to send to the server
/// * `mock_tx_json` - The mock_tx.json content providing transaction context
/// * `script_group_type` - "lock" or "type"
/// * `script_hash` - Hex-encoded hash of the script being executed
///
/// # Returns
/// An `ExecuteResult` containing the JSON response, debug messages, and cycle count.
#[wasm_bindgen]
pub fn execute_script_with_mock_tx(
    binary: &[u8],
    args: &str,
    json_request: &str,
    mock_tx_json: &str,
    script_group_type: &str,
    script_hash: &str,
) -> Result<ExecuteResult, JsValue> {
    // Parse the mock_tx
    let mock_tx_data = parse_mock_tx(mock_tx_json, script_group_type, script_hash)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse mock_tx: {}", e)))?;

    // Build the request packet
    let request_data = build_request_packet(json_request.trim());

    // Set up in-memory I/O
    let read_buf = ReadBuffer::new(request_data);
    let write_buf = WriteBuffer::new();
    let debug_log = DebugLog::new();

    // Build argument list
    let code = Bytes::copy_from_slice(binary);
    let vm_args: Vec<Bytes> = args
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| Bytes::copy_from_slice(s.as_bytes()))
        .collect();

    // Create the CKB VM interpreter
    let core_machine = ckb_vm::DefaultCoreMachine::<u64, ckb_vm::SparseMemory<u64>>::new(
        ckb_vm::ISA_IMC | ckb_vm::ISA_B | ckb_vm::ISA_MOP,
        ckb_vm::machine::VERSION2,
        u64::MAX,
    );
    let mut machine = ckb_vm::DefaultMachineBuilder::new(core_machine)
        .instruction_cycle_func(Box::new(estimate_cycles))
        .syscall(Box::new(DebugSyscall {
            log: debug_log.clone(),
        }))
        .syscall(Box::new(ReadSyscall {
            buf: read_buf,
        }))
        .syscall(Box::new(WriteSyscall {
            buf: write_buf.clone(),
        }))
        .syscall(Box::new(InheritedFdSyscall))
        .syscall(Box::new(CloseSyscall))
        .syscall(Box::new(MockTxSyscall::new(mock_tx_data)))
        .build();

    // Load and run the program
    let args_iter = vm_args.into_iter().map(Ok);
    machine
        .load_program(&code, args_iter)
        .map_err(|e| JsValue::from_str(&format!("Failed to load program: {:?}", e)))?;

    let _exit = machine.run();
    let cycles = machine.cycles();

    // Extract response from write buffer
    let output = write_buf.into_data();
    let debug_messages = debug_log.into_messages();

    if output.is_empty() {
        return Err(JsValue::from_str(
            "No response received from the script. Check that the binary is a valid CKB IPC server and the arguments are correct.",
        ));
    }

    // Parse the response packet
    let (error_code, json_response) =
        parse_response_packet(&output).map_err(|e| JsValue::from_str(&e))?;

    if error_code != 0 {
        return Err(JsValue::from_str(&format!(
            "Server returned error code: {}. Response: {}",
            error_code, json_response
        )));
    }

    Ok(ExecuteResult {
        json_response,
        debug_messages,
        cycles,
    })
}
