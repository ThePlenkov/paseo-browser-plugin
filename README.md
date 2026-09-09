# Paseo Browser Tab Plugin

A custom [Paseo](https://paseo.sh) plugin that adds a **Browser** workspace tab — a full Chromium browser running on the Paseo daemon host, streamed to the client via VNC/noVNC.

![Browser tab in Paseo](https://img.shields.io/badge/Paseo-Plugin-blue)

## What it does

- Adds a **Browser** tab next to Agent and Terminal in the Paseo workspace
- Runs a real Chromium browser on the daemon host (not the client)
- Streams the browser via VNC → noVNC → WebSocket to the Paseo web/mobile client
- Full browser controls: address bar, navigation, tabs, bookmarks
- Native input — clicks, keyboard, scroll, all work through VNC
- Auto-restarts Chromium if closed (can't kill the browser)
- No noVNC UI chrome — just the browser
- Access daemon-local services (`localhost:3000`, `localhost:6767`, etc.) from remote/mobile clients

## Architecture

```
Paseo Client (web/mobile)
  └─ iframe → http://daemon:9223/
       └─ noVNC (custom embed, no controls)
            └─ WebSocket → websockify (internal :9224)
                 └─ VNC → x11vnc (:5999)
                      └─ Xvfb (:99) — virtual display 1280x800
                           └─ Chromium (full UI, auto-restart)
                                └─ Fluxbox (no toolbar, no close bindings)
```

## Requirements

### System dependencies

The plugin needs these installed on the daemon host:

| Tool | Purpose |
|------|---------|
| **Xvfb** | Virtual framebuffer X server |
| **x11vnc** | VNC server for the virtual display |
| **Fluxbox** | Minimal window manager (configured to hide toolbar, block close) |
| **websockify** | WebSocket-to-VNC proxy |
| **noVNC** | HTML5 VNC client (served by the plugin) |
| **Chromium** | The browser itself (resolved via Playwright) |

### Install system dependencies

**Option A: Nix (recommended, no sudo needed)**

```bash
nix profile install nixpkgs#xorg.xvfb nixpkgs#x11vnc nixpkgs#fluxbox nixpkgs#python3Packages.websockify nixpkgs#novnc
```

**Option B: apt (Debian/Ubuntu)**

```bash
sudo apt-get install -y xvfb x11vnc fluxbox websockify novnc
```

**Option C: Automated script**

```bash
./install.sh
```

### Node.js dependencies

```bash
npm install
```

This installs `playwright` (used to resolve the Chromium binary path) and `ws` (WebSocket library for the bridge).

## Install the plugin

### From local directory

```bash
paseo plugin install /absolute/path/to/paseo-browser-plugin
```

### From Git (Paseo v0.7+)

```bash
paseo plugin add https://github.com/ThePlenkov/paseo-browser-plugin
```

## Usage

1. Open Paseo (web UI at `http://127.0.0.1:6767/` or mobile app)
2. Click the **Browser** tab in the workspace
3. The first launch takes ~3 seconds (starts Xvfb, Chromium, VNC, websockify)
4. You get a full Chromium browser — type URLs, click, scroll, navigate

## Docker

Run the entire stack in a container:

```bash
docker build -t paseo-browser-plugin .
docker run -d -p 9223:9223 --shm-size=512m paseo-browser-plugin
```

Then point the plugin at `http://127.0.0.1:9223/` or access directly.

## Configuration

The plugin uses fixed ports by default:

| Port | Service |
|------|---------|
| 9223 | HTTP server (noVNC client + WebSocket proxy) |
| 9224 | websockify internal (not exposed) |
| 5999 | x11vnc VNC server (not exposed) |

To change ports, edit `browser-tab.server.ts`.

## How it works

1. When the Browser tab is opened, the client calls `browser-tab.get-url` RPC
2. The server starts the VNC stack: Xvfb → Fluxbox → Chromium → x11vnc → websockify → HTTP server
3. The server returns `http://127.0.0.1:9223/`
4. The client embeds this URL in an iframe
5. noVNC connects via WebSocket to websockify, which proxies to x11vnc
6. The user sees and interacts with Chromium through VNC

## Security

- The bridge binds to `127.0.0.1` only — not exposed externally
- VNC has no password (local only)
- If you expose the bridge beyond loopback, add authentication and origin restrictions
- The plugin accepts arbitrary URL navigation in the remote browser

## License

MIT
