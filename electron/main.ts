import { app, BrowserWindow, ipcMain, powerSaveBlocker, screen, session } from 'electron';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const ALERT_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let powerSaveBlockerId: number | null = null;

type NotificationMode = 'flash' | 'image';

type TriggerPostureAlertPayload = {
  mode: NotificationMode;
  imagePath?: string;
};

type AlertImageItem = {
  id: string;
  name: string;
  path: string;
};

async function directoryExists(directoryPath: string) {
  try {
    const stat = await fs.stat(directoryPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function getAlertImagesDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'alert-images')
    : path.join(process.cwd(), 'public', 'assets', 'alert-images');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveAlertImageUrl(imagePath?: string) {
  if (!imagePath) {
    return '';
  }

  if (imagePath.startsWith('file://')) {
    return imagePath;
  }

  const decodedPath = decodeURIComponent(imagePath.replace(/^assets\/alert-images\//, ''));
  const fileName = path.basename(decodedPath);
  const extension = path.extname(fileName).toLowerCase();

  if (!ALERT_IMAGE_EXTENSIONS.has(extension)) {
    return '';
  }

  const filePath = path.join(getAlertImagesDir(), fileName);

  if (existsSync(filePath)) {
    return pathToFileURL(filePath).toString();
  }

  return '';
}

async function getAlertImages(): Promise<AlertImageItem[]> {
  const alertImagesDir = getAlertImagesDir();

  if (!(await directoryExists(alertImagesDir))) {
    return [];
  }

  try {
    const fileNames = await fs.readdir(alertImagesDir);

    return fileNames
      .filter((fileName) => ALERT_IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase()))
      .sort((a, b) => a.localeCompare(b))
      .map((fileName) => {
        const filePath = path.join(alertImagesDir, fileName);

        return {
          id: fileName,
          name: fileName,
          path: pathToFileURL(filePath).toString(),
        };
      });
  } catch {
    return [];
  }
}

function raiseOverlayWindow(overlayWindow: BrowserWindow) {
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.moveTop();
}

async function createOverlayWindow(bounds: Electron.Rectangle, transparent = true) {
  const overlayWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent,
    backgroundColor: transparent ? '#00000000' : '#ffffff',
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    show: true,
    type: 'panel',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  overlayWindow.setFullScreenable(false);
  overlayWindow.setOpacity(transparent ? 1 : 0);
  raiseOverlayWindow(overlayWindow);

  return overlayWindow;
}

function getOverlayHtml(payload: TriggerPostureAlertPayload, displayWidth: number, imageSource = '') {
  const mode = payload.mode === 'image' ? 'image' : 'flash';
  const imageMarkup = imageSource
    ? `<img src="${escapeHtml(imageSource)}" alt="posture alert" onload="console.log('image load success')" onerror="console.log('image load failed'); this.remove(); document.querySelector('.image-placeholder').hidden = false;" /><div class="image-placeholder" hidden>🐱</div>`
    : `<div class="image-placeholder">🐱</div>`;

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <style>
      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: transparent;
        pointer-events: none;
      }

      .flash {
        width: 100vw;
        height: 100vh;
        background: rgba(255, 255, 255, 0.72);
        animation: flash-alert 2s ease-in-out forwards;
      }

      @keyframes flash-alert {
        0%, 100% { opacity: 0; }
        12%, 36%, 60%, 84% { opacity: 1; }
        24%, 48%, 72% { opacity: 0; }
      }

      .image-runner {
        position: fixed;
        top: 50%;
        right: -260px;
        display: grid;
        width: 220px;
        height: 220px;
        place-items: center;
        transform: translateY(-50%);
        pointer-events: none;
        animation: moveRightToLeft 3s linear forwards;
      }

      .image-runner img {
        max-width: 220px;
        max-height: 220px;
        object-fit: contain;
        filter: drop-shadow(0 18px 24px rgba(15, 23, 42, 0.28));
      }

      .image-placeholder {
        font-size: 148px;
        line-height: 1;
        filter: drop-shadow(0 18px 24px rgba(15, 23, 42, 0.28));
      }

      @keyframes moveRightToLeft {
        from { transform: translate(0, -50%); }
        to { transform: translate(-${displayWidth + 480}px, -50%); }
      }
    </style>
  </head>
  <body>
    ${
      mode === 'flash'
        ? '<div class="flash"></div>'
        : `<div class="image-runner">${imageMarkup}</div>`
    }
  </body>
</html>`;
}

async function triggerPostureAlert(payload: TriggerPostureAlertPayload) {
  const mode = payload.mode === 'image' ? 'image' : 'flash';
  const displays = screen.getAllDisplays();
  const imageSource = mode === 'image' ? resolveAlertImageUrl(payload.imagePath) : '';

  if (mode === 'image') {
    console.log('image alert requested');
    console.log('selected imagePath:', payload.imagePath ?? '');
    console.log('resolved image url:', imageSource || '(placeholder)');
  }

  if (mode === 'flash') {
    const overlayWindows = await Promise.all(
      displays.map(async (display) => {
        const overlayWindow = await createOverlayWindow(display.bounds, false);
        overlayWindow.showInactive();
        raiseOverlayWindow(overlayWindow);
        return overlayWindow;
      }),
    );

    let tick = 0;
    const intervalId = setInterval(() => {
      tick += 1;
      const opacity = tick % 2 === 1 ? 0.62 : 0;

      for (const overlayWindow of overlayWindows) {
        if (!overlayWindow.isDestroyed()) {
          overlayWindow.setOpacity(opacity);
          raiseOverlayWindow(overlayWindow);
        }
      }

      if (tick >= 4) {
        clearInterval(intervalId);

        for (const overlayWindow of overlayWindows) {
          if (!overlayWindow.isDestroyed()) {
            overlayWindow.close();
          }
        }
      }
    }, 250);

    return;
  }

  const overlayWindows = await Promise.all(
    displays.map(async (display) => {
      const overlayWindow = await createOverlayWindow(display.bounds, true);
      const html = getOverlayHtml({ mode, imagePath: payload.imagePath }, display.bounds.width, imageSource);

      overlayWindow.webContents.on('console-message', (_event, _level, message) => {
        if (message === 'image load success' || message === 'image load failed') {
          console.log(message);
        }
      });
      await overlayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      overlayWindow.showInactive();
      raiseOverlayWindow(overlayWindow);

      return overlayWindow;
    }),
  );

  setTimeout(() => {
    for (const overlayWindow of overlayWindows) {
      if (!overlayWindow.isDestroyed()) {
        overlayWindow.close();
      }
    }
  }, 3250);
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    title: 'Turtle Neck Detector',
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    return;
  }

  mainWindow.loadFile(path.join(__dirname, '../dist/app/index.html'));
}

async function setupAutoUpdater() {
  let autoUpdater: {
    autoDownload: boolean;
    autoInstallOnAppQuit: boolean;
    on: (eventName: string, callback: (...args: unknown[]) => void) => void;
    downloadUpdate: () => Promise<unknown>;
    quitAndInstall: () => void;
    checkForUpdates: () => Promise<unknown>;
  };

  try {
    const updaterModule = (await new Function('return import("electron-updater")')()) as {
      autoUpdater: typeof autoUpdater;
    };
    autoUpdater = updaterModule.autoUpdater;
  } catch (error) {
    console.warn('electron-updater is not installed. Auto update is disabled.', error);
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', () => {
    mainWindow?.webContents.send('update-available');
  });

  ipcMain.on('download-update', () => {
    autoUpdater.downloadUpdate().catch((error: unknown) => {
      console.error('Update download failed:', error);
    });
  });

  ipcMain.on('install-update', () => {
    autoUpdater.quitAndInstall();
  });

  if (!isDev) {
    autoUpdater.checkForUpdates().catch((error: unknown) => {
      console.error('Update check failed:', error);
    });
  }
}

app.whenReady().then(() => {
  if (powerSaveBlockerId === null) {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  }

  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('get-alert-images', () => getAlertImages());
  ipcMain.on('trigger-posture-alert', (_event, payload: TriggerPostureAlertPayload) => {
    console.log('trigger-posture-alert received:', payload);
    triggerPostureAlert(payload).catch((error) => {
      console.error('Posture alert overlay failed:', error);
    });
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });

  createWindow();
  setupAutoUpdater().catch((error) => {
    console.error('Auto updater setup failed:', error);
  });

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;

  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    powerSaveBlocker.stop(powerSaveBlockerId);
  }
});

app.on('window-all-closed', () => {
  if (isQuitting && process.platform !== 'darwin') {
    app.quit();
  }
});
