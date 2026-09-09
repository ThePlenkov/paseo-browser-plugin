import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
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

const DISPLAY = ":99";
const VNC_PORT = 5999;
const WS_INTERNAL = 9224; // websockify internal (not exposed)
const WEB_PORT = 9223;    // our HTTP server (exposed to client)

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

  const nixBin = "/home/pepl/.nix-profile/bin";
  const novncPath = "/nix/store/n1cz5wf8wkpfhmb03w66r6hsj81slyp9-novnc-1.7.0/share/webapps/novnc";

  // Clean up stale SingletonLock from previous run
  try { _require("node:fs").unlinkSync("/tmp/browser-tab-chrome-profile/SingletonLock"); } catch {}

  // Force X11 mode — unset Wayland env vars
  const x11Env: Record<string, string> = { ...process.env as Record<string, string>, DISPLAY, XDG_SESSION_TYPE: "x11" };
  delete x11Env.WAYLAND_DISPLAY;

  // 1. Xvfb — virtual display
  log("Xvfb", `starting on ${DISPLAY}`);
  xvfbProcess = spawn(`${nixBin}/Xvfb`, [
    DISPLAY, "-screen", "0", "1280x800x24", "-ac", "+extension", "RANDR",
  ], { stdio: ["ignore", "pipe", "pipe"], env: x11Env });
  xvfbProcess.stderr?.on("data", (d: Buffer) => console.log("[xvfb]", d.toString().trim()));
  await sleep(500);

  // 2. Fluxbox — window manager (no toolbar, no slit, no close keybindings)
  log("Fluxbox", "starting");
  const fluxboxHome = join(process.cwd(), ".fluxbox-plugin");
  const fluxboxConf = join(fluxboxHome, ".fluxbox");
  try {
    _require("node:fs").mkdirSync(fluxboxConf, { recursive: true });
    _require("node:fs").writeFileSync(join(fluxboxConf, "keys"), readFileSync(join(process.cwd(), "fluxbox-keys"), "utf-8"));
    _require("node:fs").writeFileSync(join(fluxboxConf, "init"), readFileSync(join(process.cwd(), "fluxbox-init"), "utf-8"));
    _require("node:fs").writeFileSync(join(fluxboxConf, "menu"), readFileSync(join(process.cwd(), "fluxbox-menu"), "utf-8"));
  } catch {}
  fluxboxProcess = spawn(`${nixBin}/fluxbox`, ["-d", DISPLAY], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...x11Env, HOME: fluxboxHome },
  });
  fluxboxProcess.stderr?.on("data", () => {});
  await sleep(300);

  // 3. Chromium — real browser on the virtual display (auto-restarts on close)
  const chromiumPath = getChromiumPath();
  log("Chromium", `launching: ${chromiumPath}`);

  function launchChromium() {
    try { _require("node:fs").unlinkSync("/tmp/browser-tab-chrome-profile/SingletonLock"); } catch {}
    const proc = spawn(chromiumPath, [
      "--no-sandbox", "--disable-setuid-sandbox",
      "--disable-gpu", "--disable-dev-shm-usage",
      "--user-data-dir=/tmp/browser-tab-chrome-profile",
      "--password-store=basic", "--use-mock-keychain",
      "--disable-keychain", "--disable-features=PasswordStore",
      "--start-maximized",
      "--no-first-run", "--no-default-browser-check",
      "--disable-infobars",
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      env: x11Env,
    });
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

  // 4. x11vnc — VNC server on the display
  log("x11vnc", `starting on port ${VNC_PORT}`);
  x11vncProcess = spawn(`${nixBin}/x11vnc`, [
    "-display", DISPLAY,
    "-rfbport", String(VNC_PORT),
    "-nopw", "-forever", "-shared", "-noxdamage",
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    env: x11Env,
  });
  x11vncProcess.stderr?.on("data", (d: Buffer) => console.log("[x11vnc]", d.toString().trim()));
  x11vncProcess.stdout?.on("data", (d: Buffer) => console.log("[x11vnc]", d.toString().trim()));
  await sleep(500);

  // 5. websockify — internal, only WebSocket proxy (no web)
  log("websockify", `proxying on internal port ${WS_INTERNAL}`);
  websockifyProcess = spawn(`${nixBin}/websockify`, [
    String(WS_INTERNAL),
    `127.0.0.1:${VNC_PORT}`,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  websockifyProcess.stderr?.on("data", (d: Buffer) => console.log("[websockify]", d.toString().trim()));
  websockifyProcess.stdout?.on("data", (d: Buffer) => console.log("[websockify]", d.toString().trim()));
  await sleep(500);

  // 6. Our HTTP server — serves custom noVNC page + proxies WebSocket to websockify
  const embedPath = join(process.cwd(), "novnc-embed.html");
  const embedHtml = readFileSync(embedPath, "utf-8");
  const WebSocket = _require("ws");

  httpServer = createServer((req, res) => {
    const urlPath = (req.url || "/").split("?")[0];
    if (urlPath === "/" || urlPath === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(embedHtml);
      return;
    }
    // Serve noVNC files (core/rfb.js, core/*.js, vendor/*, etc.)
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
