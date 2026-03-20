use wasm_bindgen::prelude::*;

use ckb_vm::cost_model::estimate_cycles;
use ckb_vm::registers::{A0, A1, A2, A7};
use ckb_vm::{Bytes, Memory, Register, SupportMachine, Syscalls};

use std::sync::{Arc, Mutex};

// ---------------------------------------------------------------------------
// Wire-protocol constants (mirrored from ckb-script-ipc-common)
// ---------------------------------------------------------------------------

const FIRST_FD_SLOT: u64 = 2;

// Syscall numbers
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
    // next read (EOF) which is expected – so a non-zero exit or an error after
    // the response has been written is fine.  We only use the exit info when no
    // response was captured to help the user diagnose problems.
    let exit_result = machine.run();
    let cycles = machine.cycles();

    // Extract response from write buffer
    let output = write_buf.into_data();
    let debug_messages = debug_log.into_messages();

    if output.is_empty() {
        let mut error_msg =
            String::from("No response received from the script.");

        // Include VM exit status so the user can see WHY the script stopped.
        match &exit_result {
            Ok(code) => {
                error_msg.push_str(&format!("\nVM exited with code: {}", code));
            }
            Err(e) => {
                error_msg.push_str(&format!("\nVM error: {:?}", e));
            }
        }

        error_msg.push_str(&format!("\nCycles used: {}", cycles));

        if !debug_messages.is_empty() {
            error_msg.push_str("\nDebug output:");
            for msg in &debug_messages {
                error_msg.push_str(&format!("\n  {}", msg));
            }
        }

        error_msg.push_str(
            "\n\nCheck that the binary is a valid CKB IPC server and the arguments are correct.",
        );

        return Err(JsValue::from_str(&error_msg));
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
