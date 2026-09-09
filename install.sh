#!/usr/bin/env bash
set -euo pipefail

echo "=== Paseo Browser Tab Plugin — Installing system dependencies ==="

# Detect package manager
if command -v nix &>/dev/null; then
  echo "Detected Nix — installing via nix profile..."
  nix profile install nixpkgs#xorg.xvfb nixpkgs#x11vnc nixpkgs#fluxbox nixpkgs#python3Packages.websockify nixpkgs#novnc
  echo "Nix packages installed."

elif command -v apt-get &>/dev/null; then
  echo "Detected apt — installing via apt-get..."
  sudo apt-get update
  sudo apt-get install -y xvfb x11vnc fluxbox websockify novnc
  echo "apt packages installed."

elif command -v dnf &>/dev/null; then
  echo "Detected dnf — installing via dnf..."
  sudo dnf install -y xorg-x11-server-Xvfb x11vnc fluxbox websockify novnc
  echo "dnf packages installed."

elif command -v pacman &>/dev/null; then
  echo "Detected pacman — installing via pacman..."
  sudo pacman -S --noconfirm xorg-server-xvfb x11vnc fluxbox python-websockify novnc
  echo "pacman packages installed."

else
  echo "ERROR: No supported package manager found (nix, apt, dnf, pacman)"
  echo "Please install manually: Xvfb, x11vnc, fluxbox, websockify, noVNC"
  exit 1
fi

# Verify tools are available
echo ""
echo "=== Verifying installations ==="
for tool in Xvfb x11vnc fluxbox websockify; do
  if command -v "$tool" &>/dev/null; then
    echo "  ✓ $tool"
  else
    echo "  ✗ $tool NOT FOUND"
  fi
done

# Check for noVNC web files
NOVNC_PATH=""
for p in \
  "/nix/store/*/share/webapps/novnc/vnc.html" \
  "/usr/share/novnc/vnc.html" \
  "/usr/share/webapps/novnc/vnc.html"; do
  if ls $p &>/dev/null 2>&1; then
    NOVNC_PATH=$(dirname $(ls $p 2>/dev/null | head -1))
    echo "  ✓ noVNC found at $NOVNC_PATH"
    break
  fi
done

if [ -z "$NOVNC_PATH" ]; then
  echo "  ✗ noVNC web files NOT FOUND"
  echo "  The plugin will need the noVNC path in browser-tab.server.ts"
fi

# Install Node.js dependencies
echo ""
echo "=== Installing Node.js dependencies ==="
npm install

echo ""
echo "=== Done! ==="
echo "Now install the plugin in Paseo:"
echo "  paseo plugin install $(pwd)"
