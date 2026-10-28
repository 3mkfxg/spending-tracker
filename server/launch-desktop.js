/**
 * Launches the 1Money Shared Database Server (if not already running on port 3456)
 * and opens the specified edition ('desktop', 'iphone', or 'ipad') in a standalone app window.
 */

const http = require('http');
const path = require('path');
const { spawn, exec } = require('child_process');
const { PORT } = require('./server');

const edition = process.argv[2] || 'desktop';
const targetUrl = `http://localhost:${PORT}/${edition}`;

function isServerRunning() {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${PORT}/api/state`, res => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1200, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function openStandaloneAppWindow(url) {
  if (process.platform === 'win32') {
    // Try Microsoft Edge App Mode first (installed on all modern Windows systems) for a clean native app window without browser address bar
    const edgeCmd = `start msedge --app="${url}" --window-size=1380,880`;
    exec(edgeCmd, err => {
      if (err) {
        exec(`start "" "${url}"`);
      }
    });
  } else if (process.platform === 'darwin') {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

async function main() {
  const running = await isServerRunning();
  if (!running) {
    console.log('[1Money Launcher] Starting Shared Database Server...');
    const serverChild = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    serverChild.unref();

    // Wait up to 4 seconds for server to bind
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (await isServerRunning()) break;
    }
  } else {
    console.log('[1Money Launcher] Shared Database Server is already running.');
  }

  console.log(`[1Money Launcher] Opening ${edition} edition: ${targetUrl}`);
  openStandaloneAppWindow(targetUrl);
}

main();
