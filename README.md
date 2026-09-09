# Paseo Browser Tab Plugin

A [Paseo](https://paseo.sh) plugin that adds a **Browser** workspace tab — a full Chromium browser running on the daemon host, streamed to the client via VNC/noVNC.

## What it does

- Adds a **Browser** tab next to Agent and Terminal
- Runs real Chromium on the daemon host (not the client)
- Streams via VNC → noVNC → WebSocket
- Full browser controls: address bar, navigation, tabs
- Native input — clicks, keyboard, scroll all work through VNC
- Auto-restarts Chromium if closed
- No noVNC UI chrome — just the browser
- Access daemon-local services (`localhost:3000`, etc.) from remote clients using the Paseo web client

## Requirements

System dependencies (on the daemon host):

| Tool | Purpose |
|------|---------|
| Xvfb | Virtual framebuffer |
| x11vnc | VNC server |
| Fluxbox | Window manager (configured: no toolbar, no close) |
| websockify | WebSocket-to-VNC proxy |
| noVNC | HTML5 VNC client |
| Chromium | The browser (resolved via Playwright) |

**Nix:**
```bash
nix profile install nixpkgs#xorg.xvfb nixpkgs#x11vnc nixpkgs#fluxbox nixpkgs#python3Packages.websockify nixpkgs#novnc
```

**apt:**
```bash
sudo apt-get install -y xvfb x11vnc fluxbox websockify novnc
```

## Install

```bash
npm install
npx playwright install chromium
paseo plugin install /absolute/path/to/paseo-browser-plugin
```

Or from Git (Paseo v0.7+):
```bash
paseo plugin add https://github.com/ThePlenkov/paseo-browser-plugin
```

## License

MIT
