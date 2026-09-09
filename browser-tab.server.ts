import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, mkdtempSync } from "node:fs";
import { join, resolve, normalize, delimiter } from "node:path";
import { tmpdir } from "node:os";
import type { output as ZodOutput } from "zod";
import { browserGetUrl } from "./browser-tab.shared";

const _require = eval("require");

let xvfbProcess: ChildProcess | null = null;
let chromiumProcess: ChildProcess | null = null;
let x11vncProcess: ChildProcess | null = null;
let websockifyProcess: ChildProcess | null = null;
let fluxboxProcess: ChildProcess | null = null;
let httpServer: any = null;
let bridgeWs: any = null;
let startupPromise: Promise<void> | null = null;
let cancelled = false;

const DISPLAY = ":99";
const VNC_PORT = 5999;
const WS_INTERNAL = 9224;
const WEB_PORT = 9223;

// Chrome profile in a secure temp directory (not world-writable /tmp)
const CHROME_PROFILE = mkdtempSync(join(tmpdir(), "browser-tab-chrome-"));

// --- Fluxbox configs (embedded) ---
const FLUXBOX_KEYS = `# No close, no kill, no window menu, no exit
OnDesktop Mouse1 :HideMenus
OnDesktop Mouse2 :HideMenus
OnDesktop Mouse3 :HideMenus
OnWindow Mod1 Mouse1 :MacroCmd {Raise} {Focus} {StartMoving}
OnWindowBorder Move1 :StartMoving
OnWindow Mod1 Mouse3 :MacroCmd {Raise} {Focus} {StartResizing NearestCorner}
OnLeftGrip Move1 :StartResizing bottomleft
OnRightGrip Move1 :StartResizing bottomright
OnWindow Mod1 Mouse2 :Lower
OnTitlebar Control Mouse1 :StartTabbing
OnTitlebar Double Mouse1 :Shade
OnTitlebar Mouse1 :MacroCmd {Raise} {Focus} {ActivateTab}
OnTitlebar Move1 :StartMoving
OnTitlebar Mouse2 :Lower
OnTitlebar Mouse3 :Lower
Mod1 Tab :NextWindow {groups} (workspace=[current])
Mod1 Shift Tab :PrevWindow {groups} (workspace=[current])
Mod4 Tab :NextTab
Mod4 Shift Tab :PrevTab
Mod1 F9 :Minimize
Mod1 F10 :Maximize
Mod1 F11 :Fullscreen
`;

const FLUXBOX_INIT = `session.screen0.toolbar.visible:\tfalse
session.screen0.toolbar.autoHide:\ttrue
session.screen0.toolbar.widthPercent:\t0
session.screen0.toolbar.tools:\t
session.screen0.slit.autoHide:\ttrue
session.screen0.workspaces:\t1
session.screen0.fullMaximization:\ttrue
session.screen0.focusModel:\tClickFocus
session.screen0.focusNewWindows:\ttrue
session.screen0.defaultDeco:\tNONE
session.screen0.windowMenu:\t
session.titlebar.left:\t
session.titlebar.right:\t
`;

const FLUXBOX_MENU = `[begin] (Browser)\n[end]\n`;

// --- noVNC embed page (embedded) ---
const NOVNC_EMBED_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<title>Browser</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
  #screen { width: 100%; height: 100%; display: block; }
  #status { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);
    color: #888; font-family: sans-serif; font-size: 14px; text-align: center; z-index: 10; }
</style>
<script type="module" crossorigin="anonymous">
  import RFB from './core/rfb.js';
  let rfb, statusEl = document.getElementById('status'), screenEl = document.getElementById('screen');
  function status(t) { statusEl.textContent = t; statusEl.style.display = t ? 'block' : 'none'; }
  function connect() {
    status('Connecting...');
    let url = (window.location.protocol === 'https:' ? 'wss' : 'ws') + '://' + window.location.host + '/websockify';
    rfb = new RFB(screenEl, url, {});
    rfb.addEventListener('connect', () => status(''));
    rfb.addEventListener('disconnect', (e) => { status(e.detail.clean ? 'Disconnected. Reconnecting...' : 'Connection lost. Reconnecting...'); setTimeout(connect, 1000); });
    rfb.scaleViewport = true;
    rfb.resizeSession = true;
  }
  connect();
</script>
</head>
<body>
<div id="status">Connecting...</div>
<div id="screen"></div>
</body>
</html>`;

// --- Binary path resolution (no execSync, no hardcoded paths) ---
function findBin(name: string): string {
  const candidates: string[] = [];
  // Search PATH directories
  for (const dir of (process.env.PATH || "").split(delimiter)) {
    if (dir) candidates.push(join(dir, name));
  }
  // Nix profile (via HOME, not hardcoded)
  const home = process.env.HOME || "";
  if (home) candidates.push(join(home, ".nix-profile/bin", name));
  // Common system locations
  candidates.push(`/usr/bin/${name}`, `/usr/local/bin/${name}`, `/nix/var/nix/profiles/default/bin/${name}`);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(`Binary not found: ${name}. Install it or add to PATH.`);
}

function findNovncPath(): string {
  // Search Nix store via readdirSync (no shell, no glob)
  const nixStore = "/nix/store";
  if (existsSync(nixStore)) {
    try {
      for (const entry of readdirSync(nixStore)) {
        if (entry.includes("novnc")) {
          const candidate = join(nixStore, entry, "share/webapps/novnc");
          if (existsSync(candidate)) return candidate;
        }
      }
    } catch {}
  }
  // Common system locations
  for (const p of ["/usr/share/novnc", "/usr/share/webapps/novnc", "/var/www/novnc"]) {
    if (existsSync(p)) return p;
  }
  throw new Error("noVNC not found. Install it or set the path.");
}

function getChromiumPath(): string {
  try {
    return _require("playwright").chromium.executablePath();
  } catch {
    return _require(process.cwd() + "/node_modules/playwright").chromium.executablePath();
  }
}

function log(tag: string, msg: string) {
  console.log(`[browser-tab] ${tag}: ${msg}`);
}

// --- Readiness check: wait for a TCP port to be connectable ---
function waitForPort(port: number, host: string, timeoutMs: number): Promise<boolean> {
  const net = _require("node:net");
  return new Promise((resolve) => {
    const start = Date.now();
    function tryConnect() {
      if (Date.now() - start > timeoutMs) return resolve(false);
      const sock = new net.Socket();
      sock.setTimeout(500);
      sock.on("connect", () => { sock.destroy(); resolve(true); });
      sock.on("error", () => { sock.destroy(); setTimeout(tryConnect, 100); });
      sock.on("timeout", () => { sock.destroy(); setTimeout(tryConnect, 100); });
      sock.connect(port, host);
    }
    tryConnect();
  });
}

// --- Kill all spawned processes (used on failure and cleanup) ---
function killAll(): void {
  for (const [name, proc] of [
    ["websockify", websockifyProcess],
    ["x11vnc", x11vncProcess],
    ["chromium", chromiumProcess],
    ["fluxbox", fluxboxProcess],
    ["xvfb", xvfbProcess],
  ] as Array<[string, ChildProcess | null]>) {
    if (proc) {
      try { proc.kill("SIGKILL"); } catch {}
      log(name, "killed");
    }
  }
  websockifyProcess = null;
  x11vncProcess = null;
  chromiumProcess = null;
  fluxboxProcess = null;
  xvfbProcess = null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function startVncStack(): Promise<void> {
  if (xvfbProcess && !xvfbProcess.killed) return;
  if (startupPromise) return startupPromise;

  cancelled = false;
  startupPromise = (async () => {
    try {
      try { _require("node:fs").unlinkSync(join(CHROME_PROFILE, "SingletonLock")); } catch {}

      const x11Env: Record<string, string> = { ...process.env as Record<string, string>, DISPLAY, XDG_SESSION_TYPE: "x11" };
      delete x11Env.WAYLAND_DISPLAY;

      // 1. Xvfb
      log("Xvfb", `starting on ${DISPLAY}`);
      xvfbProcess = spawn(findBin("Xvfb"), [
        DISPLAY, "-screen", "0", "1280x800x24", "-ac", "+extension", "RANDR",
      ], { stdio: ["ignore", "pipe", "pipe"], env: x11Env });
      xvfbProcess.stderr?.on("data", (d: Buffer) => console.log("[xvfb]", d.toString().trim()));
      await sleep(500);
      if (cancelled) throw new Error("startup cancelled");

      // 2. Fluxbox (embedded configs — no toolbar, no close)
      log("Fluxbox", "starting");
      const fluxboxHome = join(process.cwd(), ".fluxbox-plugin");
      const fluxboxConf = join(fluxboxHome, ".fluxbox");
      mkdirSync(fluxboxConf, { recursive: true });
      writeFileSync(join(fluxboxConf, "keys"), FLUXBOX_KEYS);
      writeFileSync(join(fluxboxConf, "init"), FLUXBOX_INIT);
      writeFileSync(join(fluxboxConf, "menu"), FLUXBOX_MENU);
      fluxboxProcess = spawn(findBin("fluxbox"), ["-d", DISPLAY], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...x11Env, HOME: fluxboxHome },
      });
      fluxboxProcess.stderr?.on("data", () => {});
      await sleep(300);
      if (cancelled) throw new Error("startup cancelled");

      // 3. Chromium (auto-restarts on close)
      const chromiumPath = getChromiumPath();
      log("Chromium", `launching: ${chromiumPath}`);

      function launchChromium() {
        try { _require("node:fs").unlinkSync(join(CHROME_PROFILE, "SingletonLock")); } catch {}
        const proc = spawn(chromiumPath, [
          "--no-sandbox", "--disable-setuid-sandbox",
          "--disable-gpu", "--disable-dev-shm-usage",
          `--user-data-dir=${CHROME_PROFILE}`,
          "--password-store=basic", "--use-mock-keychain",
          "--disable-keychain", "--disable-features=PasswordStore",
          "--start-maximized",
          "--no-first-run", "--no-default-browser-check",
          "--disable-infobars",
        ], { stdio: ["ignore", "pipe", "pipe"], env: x11Env });
        proc.stderr?.on("data", () => {});
        proc.stdout?.on("data", () => {});
        proc.on("exit", (code) => {
          log("Chromium", `exited with code ${code} — restarting in 1s`);
          chromiumProcess = null;
          setTimeout(() => {
            if (xvfbProcess && !xvfbProcess.killed) {
              log("Chromium", "restarting");
              chromiumProcess = launchChromium();
            }
          }, 1000);
        });
        return proc;
      }

      chromiumProcess = launchChromium();
      await sleep(1000);
      if (cancelled) throw new Error("startup cancelled");

      // 4. x11vnc (localhost only — not exposed externally)
      log("x11vnc", `starting on port ${VNC_PORT}`);
      x11vncProcess = spawn(findBin("x11vnc"), [
        "-display", DISPLAY,
        "-rfbport", String(VNC_PORT),
        "-localhost",
        "-nopw", "-forever", "-shared", "-noxdamage",
      ], { stdio: ["ignore", "pipe", "pipe"], env: x11Env });
      x11vncProcess.stderr?.on("data", (d: Buffer) => console.log("[x11vnc]", d.toString().trim()));
      x11vncProcess.stdout?.on("data", (d: Buffer) => console.log("[x11vnc]", d.toString().trim()));
      // Wait for VNC port readiness instead of fixed sleep
      if (!await waitForPort(VNC_PORT, "127.0.0.1", 5000)) {
        throw new Error("x11vnc did not become ready");
      }
      if (cancelled) throw new Error("startup cancelled");

      // 5. websockify (internal)
      log("websockify", `proxying on internal port ${WS_INTERNAL}`);
      websockifyProcess = spawn(findBin("websockify"), [
        String(WS_INTERNAL),
        `127.0.0.1:${VNC_PORT}`,
      ], { stdio: ["ignore", "pipe", "pipe"] });
      websockifyProcess.stderr?.on("data", (d: Buffer) => console.log("[websockify]", d.toString().trim()));
      websockifyProcess.stdout?.on("data", (d: Buffer) => console.log("[websockify]", d.toString().trim()));
      if (!await waitForPort(WS_INTERNAL, "127.0.0.1", 5000)) {
        throw new Error("websockify did not become ready");
      }
      if (cancelled) throw new Error("startup cancelled");

      // 6. HTTP server — serves embedded noVNC page + proxies WebSocket
      const novncPath = findNovncPath();
      const novncPathResolved = resolve(novncPath);
      const WebSocket = _require("ws");

      httpServer = createServer((req, res) => {
        const urlPath = (req.url || "/").split("?")[0];
        if (urlPath === "/" || urlPath === "/index.html") {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(NOVNC_EMBED_HTML);
          return;
        }
        // Serve noVNC files — prevent path traversal
        const filePath = normalize(resolve(join(novncPathResolved, urlPath)));
        if (filePath.startsWith(novncPathResolved) && existsSync(filePath)) {
          const ext = filePath.endsWith(".js") ? "application/javascript"
            : filePath.endsWith(".css") ? "text/css"
            : filePath.endsWith(".json") ? "application/json"
            : filePath.endsWith(".wasm") ? "application/wasm"
            : "text/html";
          res.writeHead(200, { "Content-Type": ext });
          res.end(readFileSync(filePath));
          return;
        }
        res.writeHead(404);
        res.end("Not found");
      });

      bridgeWs = new WebSocket.Server({ server: httpServer, path: "/websockify" });
      bridgeWs.on("connection", (clientWs: any) => {
        const targetWs = new WebSocket(`ws://127.0.0.1:${WS_INTERNAL}`);
        targetWs.on("error", (err: Error) => {
          console.error("[websockify bridge] target error:", err.message);
          try { clientWs.close(); } catch {}
        });
        clientWs.on("error", (err: Error) => {
          console.error("[websockify bridge] client error:", err.message);
          try { targetWs.close(); } catch {}
        });
        targetWs.on("open", () => {
          clientWs.on("message", (data: Buffer) => {
            if (targetWs.readyState === WebSocket.OPEN) targetWs.send(data);
          });
          targetWs.on("message", (data: Buffer) => {
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
          });
        });
        clientWs.on("close", () => { try { targetWs.close(); } catch {} });
        targetWs.on("close", () => { try { clientWs.close(); } catch {} });
      });

      // Listen — reject on error (e.g. port occupied)
      await new Promise<void>((resolveListen, rejectListen) => {
        httpServer.once("error", (err: Error) => rejectListen(err));
        httpServer.listen(WEB_PORT, "127.0.0.1", () => {
          httpServer.removeListener("error", rejectListen);
          resolveListen();
        });
      });
      log("http", `serving on http://127.0.0.1:${WEB_PORT}`);
    } catch (err) {
      // Clean up partial startup
      killAll();
      if (bridgeWs) { try { bridgeWs.close(); } catch {} bridgeWs = null; }
      if (httpServer) { try { httpServer.close(); } catch {} httpServer = null; }
      throw err;
    }
  })();

  try {
    await startupPromise;
  } finally {
    startupPromise = null;
  }
}

export async function handleGetUrl(
  _input: ZodOutput<typeof browserGetUrl.input>,
): Promise<ZodOutput<typeof browserGetUrl.output>> {
  try {
    await startVncStack();
    return { url: `http://127.0.0.1:${WEB_PORT}/`, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[browser-tab] GetUrl error:", msg);
    return { url: "", error: msg };
  }
}

export async function cleanupSessions(): Promise<void> {
  cancelled = true; // signal in-progress startup to abort
  if (startupPromise) {
    try { await startupPromise.catch(() => {}); } catch {}
  }
  if (bridgeWs) { try { bridgeWs.close(); } catch {} bridgeWs = null; }
  if (httpServer) { try { httpServer.close(); } catch {} httpServer = null; }
  killAll();
}
