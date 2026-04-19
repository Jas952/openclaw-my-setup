const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, session, shell } = require("electron");
const { execFile } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const APP_NAME = "OpenClaw Beta UI";
const preloadPath = path.join(__dirname, "preload.cjs");
const distDir = path.join(__dirname, "..", "dist");
const repoRootPath = path.join(__dirname, "..", "..");
const iconPngPath = path.join(__dirname, "..", "public", "assets", "agent-mask-integrated.png");

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

let mainWindow = null;
let rendererServer = null;
let tray = null;
let isQuitting = false;

app.commandLine.appendSwitch("enable-experimental-web-platform-features");

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}
app.setName(APP_NAME);
app.on("second-instance", () => {
  void showMainWindow();
});

function installSessionPermissionHandlers() {
  const defaultSession = session.defaultSession;
  if (!defaultSession) return;

  defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === "media" || permission === "audioCapture") {
      callback(true);
      return;
    }
    callback(false);
  });

  if (typeof defaultSession.setDevicePermissionHandler === "function") {
    defaultSession.setDevicePermissionHandler((details) => {
      return details.deviceType === "audio";
    });
  }
}

function buildMissingRendererPage() {
  return [
    "<!doctype html>",
    "<html><head><meta charset='utf-8'><title>Renderer Missing</title></head>",
    "<body style='background:#050608;color:#f5f7fa;font-family:system-ui;padding:32px'>",
    `<h1>${APP_NAME}</h1>`,
    "<p>Renderer build not found.</p>",
    "<p>Run <code>npm install</code> and <code>npm run build</code> inside <code>UI</code>.</p>",
    "</body></html>",
  ].join("");
}

function createStaticRendererServer(rootDir) {
  return new Promise((resolve, reject) => {
    const indexPath = path.join(rootDir, "index.html");
    if (!fs.existsSync(indexPath)) {
      resolve({
        url: null,
        close: async () => {},
      });
      return;
    }

    const server = http.createServer((req, res) => {
      const safePath = (() => {
        const rawUrl = req.url || "/";
        const pathname = rawUrl.split("?")[0];
        const normalized = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
        const candidate = normalized === "/" ? "/index.html" : normalized;
        return path.join(rootDir, candidate);
      })();

      const finalPath = fs.existsSync(safePath) && fs.statSync(safePath).isFile()
        ? safePath
        : indexPath;

      fs.readFile(finalPath, (error, buffer) => {
        if (error) {
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(String(error));
          return;
        }

        const ext = path.extname(finalPath).toLowerCase();
        res.writeHead(200, {
          "Content-Type": mimeTypes[ext] || "application/octet-stream",
          "Cache-Control": "no-store",
        });
        res.end(buffer);
      });
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("renderer server failed to bind"));
        return;
      }

      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: async () => {
          await new Promise((serverResolve) => server.close(() => serverResolve()));
        },
      });
    });
  });
}

function getAppIcon() {
  const icon = nativeImage.createFromPath(iconPngPath);
  if (icon.isEmpty()) return nativeImage.createEmpty();
  return process.platform === "darwin" ? icon.resize({ width: 18, height: 18 }) : icon;
}

async function stopGatewayBeforeExit() {
  await new Promise((resolve) => {
    execFile("openclaw", ["gateway", "stop"], {
      cwd: repoRootPath,
      timeout: 20_000,
    }, () => resolve());
  });
}

async function requestQuitApplication() {
  const dialogTarget = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const result = await dialog.showMessageBox(dialogTarget, {
    type: "question",
    buttons: ["Exit", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: APP_NAME,
    message: "Exit OpenClaw Beta UI?",
    detail: "This will stop the gateway and close the application completely.",
    noLink: true,
  });

  if (result.response !== 0) {
    return { confirmed: false };
  }

  isQuitting = true;
  await stopGatewayBeforeExit();
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
      mainWindow.removeAllListeners("close");
      mainWindow.destroy();
    } catch {}
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
  setImmediate(() => app.exit(0));
  return { confirmed: true };
}

function ensureWindowFullscreen(windowRef) {
  if (!windowRef || windowRef.isDestroyed()) return;

  const applyPresentation = () => {
    if (!windowRef || windowRef.isDestroyed()) return;
    if (process.platform === "darwin") {
      if (!windowRef.isSimpleFullScreen()) {
        windowRef.setSimpleFullScreen(true);
      }
      if (windowRef.isKiosk()) {
        windowRef.setKiosk(false);
      }
      if (windowRef.isFullScreen() && !windowRef.isSimpleFullScreen()) {
        windowRef.setFullScreen(false);
      }
      return;
    }
    if (!windowRef.isFullScreen()) {
      windowRef.setFullScreen(true);
    }
  };

  applyPresentation();
  for (const delayMs of [180, 420, 760]) {
    setTimeout(() => {
      applyPresentation();
    }, delayMs);
  }
}

async function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    await createWindow();
    return;
  }

  if (process.platform === "darwin" && typeof app.show === "function") {
    app.show();
  }
  mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  if (process.platform === "darwin" && app.dock?.show) app.dock.show();
  mainWindow.focus();
  ensureWindowFullscreen(mainWindow);
}

async function hideMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) return;
  mainWindow.minimize();
}

function rebuildTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    {
      label: "Open Application",
      click: () => {
        void showMainWindow();
      },
    },
    {
      label: "Exit",
      click: () => {
        void requestQuitApplication();
      },
    },
  ]);
  tray.setContextMenu(menu);
  return menu;
}

function createTray() {
  if (tray) return;
  tray = new Tray(getAppIcon());
  tray.setToolTip(APP_NAME);
  rebuildTrayMenu();
  const showTrayMenu = () => {
    const menu = rebuildTrayMenu();
    if (menu) tray.popUpContextMenu(menu);
  };
  tray.on("click", showTrayMenu);
  tray.on("right-click", showTrayMenu);
}

async function getRendererUrl() {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) return devServerUrl;

  if (!rendererServer) rendererServer = await createStaticRendererServer(distDir);
  return rendererServer.url;
}

async function createWindow() {
  const rendererUrl = await getRendererUrl();

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 980,
    minHeight: 720,
    show: false,
    backgroundColor: "#050608",
    autoHideMenuBar: true,
    fullscreen: process.platform !== "darwin",
    simpleFullScreen: process.platform === "darwin",
    fullscreenable: true,
    title: APP_NAME,
    icon: iconPngPath,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.setZoomFactor(1);
  void mainWindow.webContents.setVisualZoomLevelLimits(1, 1);

  mainWindow.webContents.on("before-input-event", (event, input) => {
    const blockedKeys = ["+", "-", "=", "_", "0"];
    const blockedCodes = ["Equal", "Minus", "NumpadAdd", "NumpadSubtract", "Digit0", "Numpad0"];
    if ((input.control || input.meta) && (blockedKeys.includes(input.key) || blockedCodes.includes(input.code))) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on("zoom-changed", (event) => {
    event.preventDefault();
    mainWindow.webContents.setZoomFactor(1);
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    hideMainWindow();
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
    ensureWindowFullscreen(mainWindow);
  });

  if (rendererUrl) {
    await mainWindow.loadURL(rendererUrl);
  } else {
    await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildMissingRendererPage())}`);
  }
}

async function shutdownRendererServer() {
  if (!rendererServer) return;
  const server = rendererServer;
  rendererServer = null;
  await server.close();
}

ipcMain.handle("openclaw-app:hide", async () => {
  hideMainWindow();
  return { ok: true };
});

ipcMain.handle("openclaw-app:show", async () => {
  await showMainWindow();
  return { ok: true };
});

ipcMain.handle("openclaw-app:request-quit", async () => {
  return requestQuitApplication();
});

app.whenReady().then(async () => {
  if (process.platform === "darwin" && app.dock?.setIcon) {
    app.dock.setIcon(iconPngPath);
  }
  installSessionPermissionHandlers();
  createTray();
  await createWindow();

  app.on("activate", async () => {
    await showMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  if (tray) {
    tray.destroy();
    tray = null;
  }
  void shutdownRendererServer();
});
