FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    fluxbox \
    websockify \
    novnc \
    fonts-liberation \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# Install Playwright dependencies (for Chromium)
RUN npx playwright install --with-deps chromium

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install Node dependencies
RUN npm install

# Copy plugin source
COPY . .

# Environment
ENV DISPLAY=:99
ENV XDG_SESSION_TYPE=x11
ENV CHROME_PROFILE=/tmp/browser-tab-chrome-profile

# Expose the HTTP/noVNC port
EXPOSE 9223

# Shared memory for Chromium
# --shm-size=512m recommended when running

# Start the VNC stack
CMD ["node", "-e", "
const { spawn } = require('child_process');
const { execSync } = require('child_process');

// Clean up
try { require('fs').unlinkSync('/tmp/browser-tab-chrome-profile/SingletonLock'); } catch {}

// Xvfb
const xvfb = spawn('Xvfb', [':99', '-screen', '0', '1280x800x24', '-ac', '+extension', 'RANDR']);
setTimeout(() => {

// Fluxbox
const fb = spawn('fluxbox', ['-d', ':99'], { env: { ...process.env, DISPLAY: ':99', HOME: '/tmp' } });
setTimeout(() => {

// Chromium
const chrome = spawn(require('playwright').chromium.executablePath(), [
  '--no-sandbox', '--disable-setuid-sandbox',
  '--disable-gpu', '--disable-dev-shm-usage',
  '--user-data-dir=/tmp/browser-tab-chrome-profile',
  '--start-maximized',
  '--no-first-run', '--no-default-browser-check',
  '--disable-infobars',
], { env: { ...process.env, DISPLAY: ':99' } });
chrome.on('exit', () => process.exit(0));
setTimeout(() => {

// x11vnc
const vnc = spawn('x11vnc', ['-display', ':99', '-rfbport', '5999', '-nopw', '-forever', '-shared', '-noxdamage']);
setTimeout(() => {

// websockify with noVNC
const novncPath = '/usr/share/novnc';
const ws = spawn('websockify', ['--web', novncPath, '9223', '127.0.0.1:5999']);
ws.stderr.on('data', d => console.log(d.toString()));
console.log('Browser tab ready on http://0.0.0.0:9223/');

}, 500);
}, 1000);
}, 300);
}, 500);
"]
