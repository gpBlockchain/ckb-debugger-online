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

const SYS_LOAD_TRANSACTION: i32 = 2051;
const SYS_LOAD_SCRIPT: i32 = 2052;
const SYS_LOAD_TX_HASH: i32 = 2061;
const SYS_LOAD_SCRIPT_HASH: i32 = 2062;
const SYS_LOAD_CELL: i32 = 2071;
const SYS_LOAD_CELL_BY_FIELD: i32 = 2081;
const SYS_LOAD_CELL_DATA: i32 = 2091;
const SYS_LOAD_INPUT: i32 = 2073;
const SYS_LOAD_INPUT_BY_FIELD: i32 = 2083;
const SYS_LOAD_HEADER: i32 = 2072;
const SYS_LOAD_HEADER_BY_FIELD: i32 = 2082;
const SYS_LOAD_WITNESS: i32 = 2074;

// CKB Source types
const CKB_SOURCE_INPUT: u64 = 1;
const CKB_SOURCE_OUTPUT: u64 = 2;
const CKB_SOURCE_CELL_DEP: u64 = 3;
const CKB_SOURCE_HEADER_DEP: u64 = 4;

// CKB Cell Fields
const CKB_CELL_FIELD_CAPACITY: u64 = 0;
const CKB_CELL_FIELD_DATA_HASH: u64 = 1;
const CKB_CELL_FIELD_LOCK: u64 = 2;
const CKB_CELL_FIELD_LOCK_HASH: u64 = 3;
const CKB_CELL_FIELD_TYPE: u64 = 4;
const CKB_CELL_FIELD_TYPE_HASH: u64 = 5;
const CKB_CELL_FIELD_OCCUPIED_CAPACITY: u64 = 6;

// CKB Input Fields
const CKB_INPUT_FIELD_OUT_POINT: u64 = 0;
const CKB_INPUT_FIELD_SINCE: u64 = 1;

// CKB Header Fields
const CKB_HEADER_FIELD_EPOCH_NUMBER: u64 = 0;
const CKB_HEADER_FIELD_EPOCH_START_BLOCK_NUMBER: u64 = 1;
const CKB_HEADER_FIELD_EPOCH_LENGTH: u64 = 2;

// CKB return codes
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
// Mock TX support: CKB system call implementations
// ---------------------------------------------------------------------------

/// Convert hex string (with or without 0x prefix) to bytes
fn hex_to_byte_vec(hex: &str) -> Vec<u8> {
    let hex = if hex.starts_with("0x") || hex.starts_with("0X") {
        &hex[2..]
    } else {
        hex
    };
    if hex.is_empty() {
        return Vec::new();
    }
    (0..hex.len())
        .step_by(2)
        .filter_map(|i| {
            if i + 2 <= hex.len() {
                u8::from_str_radix(&hex[i..i + 2], 16).ok()
            } else {
                None
            }
        })
        .collect()
}

/// Parse a hex string as a u64 value
fn hex_to_u64(hex: &str) -> u64 {
    let hex = if hex.starts_with("0x") || hex.starts_with("0X") {
        &hex[2..]
    } else {
        hex
    };
    u64::from_str_radix(hex, 16).unwrap_or(0)
}

/// Compute blake2b-256 hash with CKB personalization ("ckb-default-hash")
fn ckb_blake2b_256(data: &[u8]) -> [u8; 32] {
    use blake2b_ref::Blake2bBuilder;
    let mut hash = [0u8; 32];
    let mut blake2b = Blake2bBuilder::new(32)
        .personal(b"ckb-default-hash")
        .build();
    blake2b.update(data);
    blake2b.finalize(&mut hash);
    hash
}

/// Convert hash_type string to byte value
fn hash_type_to_byte(hash_type: &str) -> u8 {
    match hash_type {
        "data" => 0,
        "type" => 1,
        "data1" => 2,
        "data2" => 4,
        _ => 0,
    }
}

/// Molecule-serialize a CKB Script
fn serialize_script_molecule(code_hash: &[u8; 32], hash_type: u8, args: &[u8]) -> Vec<u8> {
    let header_size: usize = 4 + 3 * 4; // total_size(4) + 3 offsets(4 each)
    let total_size = header_size + 32 + 1 + 4 + args.len();

    let mut buf = Vec::with_capacity(total_size);
    buf.extend_from_slice(&(total_size as u32).to_le_bytes());
    buf.extend_from_slice(&(header_size as u32).to_le_bytes());
    buf.extend_from_slice(&((header_size + 32) as u32).to_le_bytes());
    buf.extend_from_slice(&((header_size + 32 + 1) as u32).to_le_bytes());
    buf.extend_from_slice(code_hash);
    buf.push(hash_type);
    buf.extend_from_slice(&(args.len() as u32).to_le_bytes());
    buf.extend_from_slice(args);
    buf
}

/// Parsed mock transaction data providing CKB syscall context
struct MockTxData {
    json: serde_json::Value,
    current_script_serialized: Vec<u8>,
    current_script_hash: [u8; 32],
}

impl MockTxData {
    fn new(
        json_str: &str,
        cell_index: usize,
        cell_type: &str,
        script_group_type: &str,
    ) -> Result<Self, String> {
        let json: serde_json::Value = serde_json::from_str(json_str)
            .map_err(|e| format!("Failed to parse mock_tx JSON: {}", e))?;

        // Extract the current script
        let output = if cell_type == "input" {
            json["mock_info"]["inputs"]
                .get(cell_index)
                .and_then(|entry| {
                    let o = &entry["output"];
                    if o.is_object() {
                        Some(o)
                    } else {
                        None
                    }
                })
        } else {
            json["tx"]["outputs"].get(cell_index).and_then(|o| {
                if o.is_object() {
                    Some(o)
                } else {
                    None
                }
            })
        };

        let output = output.ok_or_else(|| {
            format!(
                "Cannot find cell at index={}, type={}",
                cell_index, cell_type
            )
        })?;

        let script = &output[script_group_type];
        if !script.is_object() {
            return Err(format!(
                "No {} script found at cell index={}, type={}",
                script_group_type, cell_index, cell_type
            ));
        }

        let code_hash_hex = script["code_hash"]
            .as_str()
            .ok_or("Missing code_hash")?;
        let hash_type_str = script["hash_type"].as_str().ok_or("Missing hash_type")?;
        let args_hex = script["args"].as_str().unwrap_or("0x");

        let code_hash_bytes = hex_to_byte_vec(code_hash_hex);
        if code_hash_bytes.len() != 32 {
            return Err("code_hash must be 32 bytes".to_string());
        }
        let mut code_hash = [0u8; 32];
        code_hash.copy_from_slice(&code_hash_bytes);

        let hash_type_byte = hash_type_to_byte(hash_type_str);
        let args_bytes = hex_to_byte_vec(args_hex);

        let current_script_serialized =
            serialize_script_molecule(&code_hash, hash_type_byte, &args_bytes);
        let current_script_hash = ckb_blake2b_256(&current_script_serialized);

        Ok(Self {
            json,
            current_script_serialized,
            current_script_hash,
        })
    }

    /// Get the cell output JSON for a given source and index
    fn get_cell_output(&self, source: u64, index: usize) -> Option<&serde_json::Value> {
        match source {
            CKB_SOURCE_INPUT => {
                let entry = self.json["mock_info"]["inputs"].get(index)?;
                let output = &entry["output"];
                if output.is_object() {
                    Some(output)
                } else {
                    None
                }
            }
            CKB_SOURCE_OUTPUT => {
                let output = self.json["tx"]["outputs"].get(index)?;
                if output.is_object() {
                    Some(output)
                } else {
                    None
                }
            }
            CKB_SOURCE_CELL_DEP => {
                let entry = self.json["mock_info"]["cell_deps"].get(index)?;
                let output = &entry["output"];
                if output.is_object() {
                    Some(output)
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    /// Get cell data bytes for a given source and index
    fn get_cell_data(&self, source: u64, index: usize) -> Option<Vec<u8>> {
        let hex = match source {
            CKB_SOURCE_INPUT => self.json["mock_info"]["inputs"]
                .get(index)?["data"]
                .as_str()?,
            CKB_SOURCE_OUTPUT => self.json["tx"]["outputs_data"]
                .get(index)?
                .as_str()?,
            CKB_SOURCE_CELL_DEP => self.json["mock_info"]["cell_deps"]
                .get(index)?["data"]
                .as_str()?,
            _ => return None,
        };
        Some(hex_to_byte_vec(hex))
    }

    /// Get witness bytes for a given index
    fn get_witness(&self, index: usize) -> Option<Vec<u8>> {
        let hex = self.json["tx"]["witnesses"].get(index)?.as_str()?;
        Some(hex_to_byte_vec(hex))
    }

    /// Get input entry from mock_info
    fn get_input_entry(&self, index: usize) -> Option<&serde_json::Value> {
        self.json["mock_info"]["inputs"].get(index)
    }

    /// Get the number of items for a given source type
    fn source_count(&self, source: u64) -> usize {
        match source {
            CKB_SOURCE_INPUT => self.json["mock_info"]["inputs"]
                .as_array()
                .map_or(0, |a| a.len()),
            CKB_SOURCE_OUTPUT => self.json["tx"]["outputs"]
                .as_array()
                .map_or(0, |a| a.len()),
            CKB_SOURCE_CELL_DEP => self.json["mock_info"]["cell_deps"]
                .as_array()
                .map_or(0, |a| a.len()),
            CKB_SOURCE_HEADER_DEP => self.json["mock_info"]["header_deps"]
                .as_array()
                .map_or(0, |a| a.len()),
            _ => 0,
        }
    }

    /// Serialize a script from a JSON value
    fn serialize_script_from_json(&self, script: &serde_json::Value) -> Option<Vec<u8>> {
        if !script.is_object() {
            return None;
        }
        let code_hash_hex = script["code_hash"].as_str()?;
        let hash_type_str = script["hash_type"].as_str()?;
        let args_hex = script["args"].as_str().unwrap_or("0x");

        let code_hash_bytes = hex_to_byte_vec(code_hash_hex);
        if code_hash_bytes.len() != 32 {
            return None;
        }
        let mut code_hash = [0u8; 32];
        code_hash.copy_from_slice(&code_hash_bytes);

        Some(serialize_script_molecule(
            &code_hash,
            hash_type_to_byte(hash_type_str),
            &hex_to_byte_vec(args_hex),
        ))
    }
}

/// CKB system call handler using mock_tx data
struct CkbSyscall {
    mock_tx: Arc<MockTxData>,
}

impl CkbSyscall {
    fn new(mock_tx: Arc<MockTxData>) -> Self {
        Self { mock_tx }
    }

    /// Store data to VM memory following the CKB syscall buffer protocol:
    /// - Read buffer size from *size_addr
    /// - Copy min(buffer_size, data_len - offset) bytes to buffer
    /// - Write full data length (minus offset) to *size_addr
    fn store_data<Mac: SupportMachine>(
        machine: &mut Mac,
        data: &[u8],
        addr: u64,
        size_addr: &Mac::REG,
        offset: u64,
    ) -> Result<(), ckb_vm::error::Error> {
        let offset = offset as usize;
        let buffer_size = machine.memory_mut().load64(size_addr)?.to_u64() as usize;

        let data_from_offset = if offset >= data.len() {
            &[] as &[u8]
        } else {
            &data[offset..]
        };

        let actual_size = data_from_offset.len();
        let copy_size = buffer_size.min(actual_size);

        if copy_size > 0 {
            machine
                .memory_mut()
                .store_bytes(addr, &data_from_offset[..copy_size])?;
        }

        machine
            .memory_mut()
            .store64(size_addr, &Mac::REG::from_u64(actual_size as u64))?;

        Ok(())
    }
}

impl<Mac: SupportMachine> Syscalls<Mac> for CkbSyscall {
    fn initialize(&mut self, _machine: &mut Mac) -> Result<(), ckb_vm::error::Error> {
        Ok(())
    }

    fn ecall(&mut self, machine: &mut Mac) -> Result<bool, ckb_vm::error::Error> {
        let code = machine.registers()[A7].to_i32();

        match code {
            SYS_LOAD_TX_HASH => {
                let addr = machine.registers()[A0].to_u64();
                let size_addr = machine.registers()[A1].clone();
                let offset = machine.registers()[A2].to_u64();

                // NOTE: This computes a deterministic hash from the JSON representation
                // of the tx for mock/testing purposes. It does NOT match the real CKB
                // transaction hash (which requires molecule serialization). For contracts
                // that only need a unique identifier, this is sufficient. For contracts
                // that compare the tx hash against an on-chain value, use ckb-debugger.
                let tx_json = self.mock_tx.json["tx"].to_string();
                let tx_hash = ckb_blake2b_256(tx_json.as_bytes());

                Self::store_data(machine, &tx_hash, addr, &size_addr, offset)?;
                machine.set_register(A0, Mac::REG::from_u64(CKB_SUCCESS));
                Ok(true)
            }

            SYS_LOAD_SCRIPT_HASH => {
                let addr = machine.registers()[A0].to_u64();
                let size_addr = machine.registers()[A1].clone();
                let offset = machine.registers()[A2].to_u64();

                Self::store_data(
                    machine,
                    &self.mock_tx.current_script_hash,
                    addr,
                    &size_addr,
                    offset,
                )?;
                machine.set_register(A0, Mac::REG::from_u64(CKB_SUCCESS));
                Ok(true)
            }

            SYS_LOAD_SCRIPT => {
                let addr = machine.registers()[A0].to_u64();
                let size_addr = machine.registers()[A1].clone();
                let offset = machine.registers()[A2].to_u64();

                Self::store_data(
                    machine,
                    &self.mock_tx.current_script_serialized,
                    addr,
                    &size_addr,
                    offset,
                )?;
                machine.set_register(A0, Mac::REG::from_u64(CKB_SUCCESS));
                Ok(true)
            }

            SYS_LOAD_CELL_DATA => {
                let addr = machine.registers()[A0].to_u64();
                let size_addr = machine.registers()[A1].clone();
                let offset = machine.registers()[A2].to_u64();
                let index = machine.registers()[A3].to_u64() as usize;
                let source = machine.registers()[A4].to_u64();

                if index >= self.mock_tx.source_count(source) {
                    machine.set_register(A0, Mac::REG::from_u64(CKB_INDEX_OUT_OF_BOUND));
                    return Ok(true);
                }

                match self.mock_tx.get_cell_data(source, index) {
                    Some(data) => {
                        Self::store_data(machine, &data, addr, &size_addr, offset)?;
                        machine.set_register(A0, Mac::REG::from_u64(CKB_SUCCESS));
                    }
                    None => {
                        machine.set_register(A0, Mac::REG::from_u64(CKB_ITEM_MISSING));
                    }
                }
                Ok(true)
            }

            SYS_LOAD_WITNESS => {
                let addr = machine.registers()[A0].to_u64();
                let size_addr = machine.registers()[A1].clone();
                let offset = machine.registers()[A2].to_u64();
                let index = machine.registers()[A3].to_u64() as usize;
                let _source = machine.registers()[A4].to_u64();

                let witness_count = self.mock_tx.json["tx"]["witnesses"]
                    .as_array()
                    .map_or(0, |a| a.len());
                if index >= witness_count {
                    machine.set_register(A0, Mac::REG::from_u64(CKB_INDEX_OUT_OF_BOUND));
                    return Ok(true);
                }

                match self.mock_tx.get_witness(index) {
                    Some(data) => {
                        Self::store_data(machine, &data, addr, &size_addr, offset)?;
                        machine.set_register(A0, Mac::REG::from_u64(CKB_SUCCESS));
                    }
                    None => {
                        machine.set_register(A0, Mac::REG::from_u64(CKB_ITEM_MISSING));
                    }
                }
                Ok(true)
            }

            SYS_LOAD_CELL_BY_FIELD => {
                let addr = machine.registers()[A0].to_u64();
                let size_addr = machine.registers()[A1].clone();
                let offset = machine.registers()[A2].to_u64();
                let index = machine.registers()[A3].to_u64() as usize;
                let source = machine.registers()[A4].to_u64();
                let field = machine.registers()[A5].to_u64();

                if index >= self.mock_tx.source_count(source) {
                    machine.set_register(A0, Mac::REG::from_u64(CKB_INDEX_OUT_OF_BOUND));
                    return Ok(true);
                }

                let cell_output = match self.mock_tx.get_cell_output(source, index) {
                    Some(o) => o.clone(),
                    None => {
                        machine.set_register(A0, Mac::REG::from_u64(CKB_ITEM_MISSING));
                        return Ok(true);
                    }
                };

                match field {
                    CKB_CELL_FIELD_CAPACITY => {
                        let cap_hex = cell_output["capacity"].as_str().unwrap_or("0x0");
                        let capacity = hex_to_u64(cap_hex);
                        let data = capacity.to_le_bytes();
                        Self::store_data(machine, &data, addr, &size_addr, offset)?;
                        machine.set_register(A0, Mac::REG::from_u64(CKB_SUCCESS));
                    }
                    CKB_CELL_FIELD_DATA_HASH => {
                        match self.mock_tx.get_cell_data(source, index) {
                            Some(data) => {
                                let hash = ckb_blake2b_256(&data);
                                Self::store_data(machine, &hash, addr, &size_addr, offset)?;
                                machine.set_register(A0, Mac::REG::from_u64(CKB_SUCCESS));
                            }
                            None => {
                                let hash = ckb_blake2b_256(&[]);
                                Self::store_data(machine, &hash, addr, &size_addr, offset)?;
                                machine.set_register(A0, Mac::REG::from_u64(CKB_SUCCESS));
                            }
                        }
                    }
                    CKB_CELL_FIELD_LOCK => {
                        let lock_script = &cell_output["lock"];
                        match self.mock_tx.serialize_script_from_json(lock_script) {
                            Some(serialized) => {
                                Self::store_data(
                                    machine,
                                    &serialized,
                                    addr,
                                    &size_addr,
                                    offset,
                                )?;
                                machine.set_register(A0, Mac::REG::from_u64(CKB_SUCCESS));
                            }
                            None => {
                                machine
                                    .set_register(A0, Mac::REG::from_u64(CKB_ITEM_MISSING));
                            }
                        }
                    }
                    CKB_CELL_FIELD_LOCK_HASH => {
                        let lock_script = &cell_output["lock"];
                        match self.mock_tx.serialize_script_from_json(lock_script) {
                            Some(serialized) => {
                                let hash = ckb_blake2b_256(&serialized);
                                Self::store_data(machine, &hash, addr, &size_addr, offset)?;
                                machine.set_register(A0, Mac::REG::from_u64(CKB_SUCCESS));
                            }
                            None => {
                                machine
                                    .set_register(A0, Mac::REG::from_u64(CKB_ITEM_MISSING));
                            }
                        }
                    }
                    CKB_CELL_FIELD_TYPE => {
                        let type_script = &cell_output["type"];
                        if type_script.is_null() {
                            machine.set_register(A0, Mac::REG::from_u64(CKB_ITEM_MISSING));
                        } else {
                            match self.mock_tx.serialize_script_from_json(type_script) {
                                Some(serialized) => {
                                    Self::store_data(
                                        machine,
                                        &serialized,
                                        addr,
                                        &size_addr,
                                        offset,
                                    )?;
                                    machine
                                        .set_register(A0, Mac::REG::from_u64(CKB_SUCCESS));
                                }
                                None => {
                                    machine.set_register(
                                        A0,
                                        Mac::REG::from_u64(CKB_ITEM_MISSING),
                                    );
                                }
                            }
                        }
                    }
                    CKB_CELL_FIELD_TYPE_HASH => {
                        let type_script = &cell_output["type"];
                        if type_script.is_null() {
                            machine.set_register(A0, Mac::REG::from_u64(CKB_ITEM_MISSING));
                        } else {
                            match self.mock_tx.serialize_script_from_json(type_script) {
                                Some(serialized) => {
                                    let hash = ckb_blake2b_256(&serialized);
                                    Self::store_data(
                                        machine,
                                        &hash,
                                        addr,
                                        &size_addr,
                                        offset,
                                    )?;
                                    machine
                                        .set_register(A0, Mac::REG::from_u64(CKB_SUCCESS));
                                }
                                None => {
                                    machine.set_register(
                                        A0,
                                        Mac::REG::from_u64(CKB_ITEM_MISSING),
                                    );
                                }
                            }
                        }
                    }
                    CKB_CELL_FIELD_OCCUPIED_CAPACITY => {
                        // Mock implementation: returns the cell's capacity value.
                        // The real occupied capacity accounts for cell size (capacity +
                        // data + lock script + type script), but for mock/testing
                        // purposes this approximation is usually sufficient.
                        let cap_hex = cell_output["capacity"].as_str().unwrap_or("0x0");
                        let capacity = hex_to_u64(cap_hex);
                        let data = capacity.to_le_bytes();
                        Self::store_data(machine, &data, addr, &size_addr, offset)?;
                        machine.set_register(A0, Mac::REG::from_u64(CKB_SUCCESS));
                    }
                    _ => {
                        machine.set_register(A0, Mac::REG::from_u64(CKB_ITEM_MISSING));
                    }
                }
                Ok(true)
            }

            SYS_LOAD_INPUT_BY_FIELD => {
                let addr = machine.registers()[A0].to_u64();
                let size_addr = machine.registers()[A1].clone();
                let offset = machine.registers()[A2].to_u64();
                let index = machine.registers()[A3].to_u64() as usize;
                let source = machine.registers()[A4].to_u64();
                let field = machine.registers()[A5].to_u64();

                let input_count = self.mock_tx.source_count(CKB_SOURCE_INPUT);
                if source == CKB_SOURCE_INPUT && index >= input_count {
                    machine.set_register(A0, Mac::REG::from_u64(CKB_INDEX_OUT_OF_BOUND));
                    return Ok(true);
                }

                let entry = match self.mock_tx.get_input_entry(index) {
                    Some(e) => e.clone(),
                    None => {
                        machine.set_register(A0, Mac::REG::from_u64(CKB_INDEX_OUT_OF_BOUND));
                        return Ok(true);
                    }
                };

                match field {
                    CKB_INPUT_FIELD_OUT_POINT => {
                        let prev_out = &entry["input"]["previous_output"];
                        let tx_hash_hex =
                            prev_out["tx_hash"].as_str().unwrap_or("0x");
                        let idx_hex =
                            prev_out["index"].as_str().unwrap_or("0x0");

                        let tx_hash_bytes = hex_to_byte_vec(tx_hash_hex);
                        let idx = hex_to_u64(idx_hex) as u32;

                        // OutPoint molecule: tx_hash(32 bytes) + index(4 bytes LE)
                        let mut data = Vec::with_capacity(36);
                        if tx_hash_bytes.len() == 32 {
                            data.extend_from_slice(&tx_hash_bytes);
                        } else {
                            data.extend_from_slice(&[0u8; 32]);
                        }
                        data.extend_from_slice(&idx.to_le_bytes());

                        Self::store_data(machine, &data, addr, &size_addr, offset)?;
                        machine.set_register(A0, Mac::REG::from_u64(CKB_SUCCESS));
                    }
                    CKB_INPUT_FIELD_SINCE => {
                        let since_hex =
                            entry["input"]["since"].as_str().unwrap_or("0x0");
                        let since = hex_to_u64(since_hex);
                        let data = since.to_le_bytes();
                        Self::store_data(machine, &data, addr, &size_addr, offset)?;
                        machine.set_register(A0, Mac::REG::from_u64(CKB_SUCCESS));
                    }
                    _ => {
                        machine.set_register(A0, Mac::REG::from_u64(CKB_ITEM_MISSING));
                    }
                }
                Ok(true)
            }

            SYS_LOAD_HEADER_BY_FIELD => {
                // Simplified: return ITEM_MISSING for header fields
                machine.set_register(A0, Mac::REG::from_u64(CKB_ITEM_MISSING));
                Ok(true)
            }

            SYS_LOAD_HEADER => {
                machine.set_register(A0, Mac::REG::from_u64(CKB_ITEM_MISSING));
                Ok(true)
            }

            SYS_LOAD_CELL | SYS_LOAD_INPUT | SYS_LOAD_TRANSACTION => {
                // These syscalls require full molecule serialization of Cell/Input/
                // Transaction structures, which is complex to implement. They return
                // ITEM_MISSING here. Most contracts use the *_by_field variants
                // (load_cell_by_field, load_input_by_field) which are fully supported.
                // If your contract uses these raw loading syscalls, consider using the
                // Mock TX Debugger mode with ckb-debugger instead.
                machine.set_register(A0, Mac::REG::from_u64(CKB_ITEM_MISSING));
                Ok(true)
            }

            _ => Ok(false), // Not a CKB syscall we handle
        }
    }
}

// ---------------------------------------------------------------------------
// New entry point: execute with mock_tx support
// ---------------------------------------------------------------------------

/// Execute a CKB script binary with IPC and optional mock_tx for CKB syscalls.
///
/// # Arguments
/// * `binary` - The RISC-V binary (CKB script) as a byte array
/// * `args` - Comma-separated command-line arguments for the script
/// * `json_request` - The JSON request string to send to the server
/// * `mock_tx_json` - The mock_tx JSON string providing transaction context
/// * `cell_index` - Cell index in the mock_tx for script context
/// * `cell_type` - Cell type: "input" or "output"
/// * `script_group_type` - Script group type: "lock" or "type"
#[wasm_bindgen]
pub fn execute_script_with_mock_tx(
    binary: &[u8],
    args: &str,
    json_request: &str,
    mock_tx_json: &str,
    cell_index: u32,
    cell_type: &str,
    script_group_type: &str,
) -> Result<ExecuteResult, JsValue> {
    // Parse mock_tx
    let mock_tx_data = MockTxData::new(
        mock_tx_json,
        cell_index as usize,
        cell_type,
        script_group_type,
    )
    .map_err(|e| JsValue::from_str(&e))?;
    let mock_tx = Arc::new(mock_tx_data);

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

    // Create the CKB VM with both IPC and CKB syscalls
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
        .syscall(Box::new(ReadSyscall { buf: read_buf }))
        .syscall(Box::new(WriteSyscall {
            buf: write_buf.clone(),
        }))
        .syscall(Box::new(InheritedFdSyscall))
        .syscall(Box::new(CloseSyscall))
        .syscall(Box::new(CkbSyscall::new(mock_tx)))
        .build();

    // Load and run the program
    let args_iter = vm_args.into_iter().map(Ok);
    machine
        .load_program(&code, args_iter)
        .map_err(|e| JsValue::from_str(&format!("Failed to load program: {:?}", e)))?;

    let _exit = machine.run();
    let cycles = machine.cycles();

    // Extract response
    let output = write_buf.into_data();
    let debug_messages = debug_log.into_messages();

    if output.is_empty() {
        return Err(JsValue::from_str(
            "No response received from the script. Check that the binary is a valid CKB IPC server and the arguments are correct.",
        ));
    }

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
