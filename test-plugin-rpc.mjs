// Call the browser-tab plugin RPC through the Paseo daemon's WebSocket
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WebSocket = require("ws");

function log(msg) { console.log(`[rpc-test] ${msg}`); }

async function main() {
  log("Connecting to ws://127.0.0.1:6767/ws...");
  const ws = new WebSocket("ws://127.0.0.1:6767/ws");
  const requestId = "req-" + Date.now();
  let helloDone = false;

  ws.on("open", () => {
    log("WebSocket connected, sending hello...");
    const hello = {
      type: "hello",
      clientId: "test-client-" + Date.now(),
      clientType: "cli",
      protocolVersion: 1,
    };
    ws.send(JSON.stringify(hello));
  });

  ws.on("message", (data) => {
    const str = data.toString();
    let msg;
    try { msg = JSON.parse(str); } catch { log("Non-JSON: " + str.substring(0, 200)); return; }

    // Log all messages (truncated)
    log("Recv: " + str.substring(0, 300));

    // Wait for hello acknowledgment (server sends "hello" back or just starts accepting session messages)
    if (!helloDone) {
      helloDone = true;
      log("Hello acknowledged, sending RPC...");
      const rpcMessage = {
        type: "session",
        message: {
          type: "plugin.rpc.invoke.request",
          requestId,
          pluginId: "browser-tab",
          method: "browser-tab.get-url",
          input: {},
        },
      };
      ws.send(JSON.stringify(rpcMessage));
      log("Sent RPC request");
      return;
    }

    if (msg.type === "session" && msg.message) {
      const m = msg.message;
      if (m.type === "plugin.rpc.invoke.response" && m.payload?.requestId === requestId) {
        log("RPC OUTPUT: " + JSON.stringify(m.payload.output));
        ws.close();
        process.exit(0);
      }
      if (m.type === "rpc_error" && m.payload?.requestId === requestId) {
        log("RPC ERROR: " + JSON.stringify(m.payload));
        ws.close();
        process.exitCode = 1;
        process.exit(1);
      }
    }
  });

  ws.on("error", (err) => { log("WS error: " + err.message); });
  ws.on("close", (code, reason) => { log("WS closed: " + code + " " + reason.toString()); });

  setTimeout(() => { log("TIMEOUT"); ws.close(); process.exit(1); }, 30000);
}

main();
