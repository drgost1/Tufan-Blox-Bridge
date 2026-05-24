// Logging — MUST go to stderr. stdout is reserved for MCP JSON-RPC over stdio;
// writing anything else there corrupts the protocol.

export function log(msg: string) {
  process.stderr.write(`[tufan-blox-bridge] ${msg}\n`);
}
