use wasm_bindgen::prelude::*;

use ckb_vm::cost_model::estimate_cycles;
use ckb_vm::registers::{A0, A7};
use ckb_vm::{Bytes, Memory, Register, SupportMachine, Syscalls};

use std::sync::{Arc, Mutex};

pub mod ipc_vlq;
pub mod ipc_packet;
pub mod ipc_syscall;

use ipc_packet::{RequestPacket, ResponsePacket};
use ipc_syscall::{IpcBufferState, IpcClose, IpcInheritedFd, IpcRead, IpcWrite};

// ---------------------------------------------------------------------------
// Wire-protocol constants
// ---------------------------------------------------------------------------

// Syscall numbers
const DEBUG_PRINT_SYSCALL_NUMBER: i32 = 2177;

// Unsupported syscall numbers (return error if called)
const SPAWN: i32 = 2601;
const WAIT: i32 = 2602;
const PROCESS_ID: i32 = 2603;
const PIPE: i32 = 2604;

// ---------------------------------------------------------------------------
// Debug log collector
// ---------------------------------------------------------------------------

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
// Debug print syscall
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
    // Build the request packet using ipc_packet module
    let req_packet = RequestPacket::new(0, 0, json_request.trim().as_bytes().to_vec());
    let request_data = req_packet.serialize();

    // Set up shared IPC state
    let ipc_state = Arc::new(Mutex::new(IpcBufferState::new(request_data)));

    // Set up debug log
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
        .syscall(Box::new(IpcRead::new(ipc_state.clone())))
        .syscall(Box::new(IpcWrite::new(ipc_state.clone())))
        .syscall(Box::new(IpcInheritedFd::new(ipc_state.clone())))
        .syscall(Box::new(IpcClose::new(ipc_state.clone())))
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

    // Extract response from shared IPC state
    let state = ipc_state.lock().unwrap();
    let output = &state.response_data;
    let debug_messages = debug_log.into_messages();

    if output.is_empty() {
        return Err(JsValue::from_str(
            "No response received from the script. Check that the binary is a valid CKB IPC server and the arguments are correct.",
        ));
    }

    // Parse the response packet using ipc_packet module
    let mut cursor = std::io::Cursor::new(output);
    let resp = ResponsePacket::read_from(&mut cursor)
        .map_err(|e| JsValue::from_str(&e))?;

    if resp.error_code() != 0 {
        let json_response = String::from_utf8_lossy(resp.payload()).into_owned();
        return Err(JsValue::from_str(&format!(
            "Server returned error code: {}. Response: {}",
            resp.error_code(),
            json_response
        )));
    }

    let json_response = String::from_utf8_lossy(resp.payload()).into_owned();

    Ok(ExecuteResult {
        json_response,
        debug_messages,
        cycles,
    })
}
