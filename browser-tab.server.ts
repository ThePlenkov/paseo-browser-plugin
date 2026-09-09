import { spawn, type ChildProcess, execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { output as ZodOutput } from "zod";
import { browserGetUrl } from "./browser-tab.shared";

const _require = eval("require");
const _fs = _require("node:fs");

let xvfbProcess: ChildProcess | null = null;
let chromiumProcess: ChildProcess | null = null;
let x11vncProcess: ChildProcess | null = null;
let websockifyProcess: ChildProcess | null = null;
let fluxboxProcess: ChildProcess | null = null;
let httpServer: any = null;
let bridgeWs: any = null;

const DISPLAY = ":99";
const VNC_PORT = 5999;
const WS_INTERNAL = 9224;
const WEB_PORT = 9223;

// --- Fluxbox configs (embedded, not external files) ---
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

// --- noVNC embed page (embedded, not external file) ---
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

// --- Binary path resolution ---
function findBin(name: string): string {
  // Try PATH first
  try {
    const path = execSync(`which ${name} 2>/dev/null`, { encoding: "utf-8" }).trim();
    if (path) return path;
  } catch {}
  // Try Nix profile
  const nixBin = `/home/pepl/.nix-profile/bin/${name}`;
  if (existsSync(nixBin)) return nixBin;
  // Try common locations
  for (const p of [`/usr/bin/${name}`, `/usr/local/bin/${name}`, `/nix/var/nix/profiles/default/bin/${name}`]) {
    if (existsSync(p)) return p;
  }
  throw new Error(`Binary not found: ${name}. Install it or add to PATH.`);
}

function findNovncPath(): string {
  // Try Nix store
  try {
    const result = execSync("ls -d /nix/store/*/share/webapps/novnc 2>/dev/null | head -1", { encoding: "utf-8" }).trim();
    if (result) return result;
  } catch {}
  // Try common locations
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

async function startVncStack(): Promise<void> {
  if (xvfbProcess && !xvfbProcess.killed) return;

  try { _fs.unlinkSync("/tmp/browser-tab-chrome-profile/SingletonLock"); } catch {}

  const x11Env: Record<string, string> = { ...process.env as Record<string, string>, DISPLAY, XDG_SESSION_TYPE: "x11" };
  delete x11Env.WAYLAND_DISPLAY;

  // 1. Xvfb
  log("Xvfb", `starting on ${DISPLAY}`);
  xvfbProcess = spawn(findBin("Xvfb"), [
    DISPLAY, "-screen", "0", "1280x800x24", "-ac", "+extension", "RANDR",
  ], { stdio: ["ignore", "pipe", "pipe"], env: x11Env });
  xvfbProcess.stderr?.on("data", (d: Buffer) => console.log("[xvfb]", d.toString().trim()));
  await sleep(500);

  // 2. Fluxbox (with embedded configs — no toolbar, no close)
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

  // 3. Chromium (auto-restarts on close)
  const chromiumPath = getChromiumPath();
  log("Chromium", `launching: ${chromiumPath}`);

  function launchChromium() {
    try { _fs.unlinkSync("/tmp/browser-tab-chrome-profile/SingletonLock"); } catch {}
    const proc = spawn(chromiumPath, [
      "--no-sandbox", "--disable-setuid-sandbox",
      "--disable-gpu", "--disable-dev-shm-usage",
      "--user-data-dir=/tmp/browser-tab-chrome-profile",
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

  // 4. x11vnc
  log("x11vnc", `starting on port ${VNC_PORT}`);
  x11vncProcess = spawn(findBin("x11vnc"), [
    "-display", DISPLAY,
    "-rfbport", String(VNC_PORT),
    "-nopw", "-forever", "-shared", "-noxdamage",
  ], { stdio: ["ignore", "pipe", "pipe"], env: x11Env });
  x11vncProcess.stderr?.on("data", (d: Buffer) => console.log("[x11vnc]", d.toString().trim()));
  x11vncProcess.stdout?.on("data", (d: Buffer) => console.log("[x11vnc]", d.toString().trim()));
  await sleep(500);

  // 5. websockify (internal)
  log("websockify", `proxying on internal port ${WS_INTERNAL}`);
  websockifyProcess = spawn(findBin("websockify"), [
    String(WS_INTERNAL),
    `127.0.0.1:${VNC_PORT}`,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  websockifyProcess.stderr?.on("data", (d: Buffer) => console.log("[websockify]", d.toString().trim()));
  websockifyProcess.stdout?.on("data", (d: Buffer) => console.log("[websockify]", d.toString().trim()));
  await sleep(500);

  // 6. HTTP server — serves embedded noVNC page + proxies WebSocket
  const novncPath = findNovncPath();
  const WebSocket = _require("ws");

  httpServer = createServer((req, res) => {
    const urlPath = (req.url || "/").split("?")[0];
    if (urlPath === "/" || urlPath === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(NOVNC_EMBED_HTML);
      return;
    }
    const filePath = join(novncPath, urlPath);
    if (existsSync(filePath) && !filePath.includes("..")) {
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

  await new Promise((resolve) => httpServer.listen(WEB_PORT, "127.0.0.1", resolve));
  log("http", `serving on http://127.0.0.1:${WEB_PORT}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
  if (bridgeWs) { try { bridgeWs.close(); } catch {} bridgeWs = null; }
  if (httpServer) { try { httpServer.close(); } catch {} httpServer = null; }
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
