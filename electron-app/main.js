const { app, BrowserWindow, shell, dialog, ipcMain, session, globalShortcut, Tray, Menu, clipboard } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');

// Enable autoplay for audio/video without user gesture
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Keep a global reference of windows
let splashWindow;
let loginWindow;
let mainWindow;
let goodbyeWindow;
let overlayWindow;
let tray = null;
let loggedInUser = null;
let isOverlayMode = false;
let panelWindows = {}; // Store separate panel windows

// Create splash screen
function createSplashWindow() {
    splashWindow = new BrowserWindow({
        width: 400,
        height: 350,
        frame: false,
        resizable: false,
        center: true,
        alwaysOnTop: true,
        icon: path.join(__dirname, 'src', 'icon.ico'),
        backgroundColor: '#0f172a',
        roundedCorners: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    splashWindow.loadFile(path.join(__dirname, 'src', 'splash.html'));
}

// Create login window (legacy - kept for potential future use)
function createLoginWindow() {
    loginWindow = new BrowserWindow({
        width: 400,
        height: 580,
        frame: false,
        resizable: false,
        center: true,
        icon: path.join(__dirname, 'src', 'icon.ico'),
        backgroundColor: '#0f172a',
        roundedCorners: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'src', 'login-preload.js')
        }
    });

    loginWindow.loadFile(path.join(__dirname, 'src', 'login.html'));

    loginWindow.on('closed', () => {
        loginWindow = null;
        // If closed without login, quit app
        if (!loggedInUser && !mainWindow) {
            app.quit();
        }
    });
}

// Create Launcher window (new main entry point)
let launcherWindow = null;

function createLauncherWindow() {
    launcherWindow = new BrowserWindow({
        width: 800,
        height: 500,
        frame: false,
        resizable: false,
        center: true,
        icon: path.join(__dirname, 'src', 'icon.ico'),
        backgroundColor: '#0f172a',
        roundedCorners: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'src', 'launcher-preload.js')
        }
    });

    launcherWindow.loadFile(path.join(__dirname, 'src', 'launcher.html'));

    // Check for updates after launcher is shown
    launcherWindow.once('ready-to-show', () => {
        setTimeout(() => {
            setupLauncherAutoUpdater();
        }, 1000);
    });

    launcherWindow.on('closed', () => {
        launcherWindow = null;
        // If closed without login, quit app
        if (!loggedInUser && !mainWindow) {
            app.quit();
        }
    });

    console.log('🚀 Launcher window created');
}

// Setup auto updater for launcher
function setupLauncherAutoUpdater() {
    console.log('🔄 Checking for updates from launcher...');

    autoUpdater.autoDownload = true; // Auto download when update found
    autoUpdater.autoInstallOnAppQuit = true;

    // Send status to launcher
    if (launcherWindow && !launcherWindow.isDestroyed()) {
        launcherWindow.webContents.send('update-status', 'checking');
    }

    autoUpdater.checkForUpdates().catch(err => {
        console.log('❌ Check update error:', err);
        if (launcherWindow && !launcherWindow.isDestroyed()) {
            launcherWindow.webContents.send('update-status', 'error');
        }
    });

    autoUpdater.on('update-available', (info) => {
        console.log('✅ Update available:', info.version);
        pendingUpdateInfo = info;
        if (launcherWindow && !launcherWindow.isDestroyed()) {
            launcherWindow.webContents.send('update-status', 'available');
        }
    });

    autoUpdater.on('update-not-available', () => {
        console.log('ℹ️ No update available');
        if (launcherWindow && !launcherWindow.isDestroyed()) {
            launcherWindow.webContents.send('update-status', 'ready');
        }
    });

    autoUpdater.on('download-progress', (progress) => {
        if (launcherWindow && !launcherWindow.isDestroyed()) {
            launcherWindow.webContents.send('update-status', 'downloading');
            launcherWindow.webContents.send('download-progress', progress.percent);
        }
    });

    autoUpdater.on('update-downloaded', () => {
        console.log('✅ Update downloaded! Restarting...');
        if (launcherWindow && !launcherWindow.isDestroyed()) {
            launcherWindow.webContents.send('update-status', 'downloaded');
        }
        // Auto restart after 2 seconds with silent install
        setTimeout(() => {
            // isSilent = true, isForceRunAfter = true (run app after install)
            autoUpdater.quitAndInstall(true, true);
        }, 2000);
    });

    autoUpdater.on('error', (err) => {
        console.log('❌ AutoUpdater error:', err);
        if (launcherWindow && !launcherWindow.isDestroyed()) {
            launcherWindow.webContents.send('update-status', 'error');
        }
    });
}

// Create goodbye window (shown when logging out)
function createGoodbyeWindow() {
    // Close main window first
    if (mainWindow) {
        mainWindow.close();
        mainWindow = null;
    }

    goodbyeWindow = new BrowserWindow({
        width: 400,
        height: 350,
        frame: false,
        resizable: false,
        center: true,
        alwaysOnTop: true,
        icon: path.join(__dirname, 'src', 'icon.ico'),
        backgroundColor: '#0f172a',
        roundedCorners: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'src', 'goodbye-preload.js')
        }
    });

    goodbyeWindow.loadFile(path.join(__dirname, 'src', 'goodbye.html'));

    // Auto close after 2.5 seconds and show launcher
    setTimeout(() => {
        if (goodbyeWindow) {
            goodbyeWindow.close();
            goodbyeWindow = null;
        }
        createLauncherWindow();
    }, 2500);
}

// Create goodbye-close window (shown when closing the app)
function createGoodbyeCloseWindow() {
    // Close confirm window if open
    if (confirmCloseWindow) {
        confirmCloseWindow.close();
        confirmCloseWindow = null;
    }

    // Close main window
    if (mainWindow) {
        mainWindow.close();
        mainWindow = null;
    }

    goodbyeWindow = new BrowserWindow({
        width: 350,
        height: 300,
        frame: false,
        resizable: false,
        center: true,
        alwaysOnTop: true,
        icon: path.join(__dirname, 'src', 'icon.ico'),
        backgroundColor: '#0f172a',
        roundedCorners: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    goodbyeWindow.loadFile(path.join(__dirname, 'src', 'goodbye-close.html'));

    // Auto quit after 2 seconds
    setTimeout(() => {
        app.quit();
    }, 2000);
}

// Create custom confirm close window
let confirmCloseWindow = null;

function createConfirmCloseWindow() {
    if (confirmCloseWindow) return; // Already open

    confirmCloseWindow = new BrowserWindow({
        width: 340,
        height: 240,
        frame: false,
        resizable: false,
        center: true,
        alwaysOnTop: true,
        parent: mainWindow,
        modal: true,
        icon: path.join(__dirname, 'src', 'icon.ico'),
        backgroundColor: '#0f172a',
        roundedCorners: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'src', 'confirm-close-preload.js')
        }
    });

    confirmCloseWindow.loadFile(path.join(__dirname, 'src', 'confirm-close.html'));

    confirmCloseWindow.on('closed', () => {
        confirmCloseWindow = null;
    });
}

// Create main window
function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 768,
        show: false, // Don't show until ready
        title: `Medical OP Systems v${app.getVersion()}`,
        icon: path.join(__dirname, 'src', 'icon.ico'),
        frame: false, // Custom title bar
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            // Enable external content for YouTube iframe API
            webSecurity: true,
            allowRunningInsecureContent: false,
            // Allow iframes from external sources (YouTube)
            webviewTag: false,
            // Enable media features
            plugins: true
        },
        autoHideMenuBar: true,
        backgroundColor: '#0f172a'
    });

    // Pass user data to renderer via query params
    const userDataParam = loggedInUser ? encodeURIComponent(JSON.stringify(loggedInUser)) : '';
    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'), {
        query: { userData: userDataParam }
    });

    // Open external links in browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // Show main window immediately when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();

        // Check for updates after window is shown
        setTimeout(() => {
            setupAutoUpdater();
        }, 3000);
    });

    // Handle window closed
    mainWindow.on('closed', () => {
        mainWindow = null;
        loggedInUser = null; // Clear user on close
    });
}

// ========== AUTO UPDATE ==========
let updateWindow = null;
let pendingUpdateInfo = null;
let backgroundCheckInterval = null;

function createUpdateWindow(currentVersion, newVersion) {
    updateWindow = new BrowserWindow({
        width: 420,
        height: 450,
        frame: false,
        transparent: true,
        resizable: false,
        center: true,
        alwaysOnTop: true,
        parent: mainWindow,
        modal: true,
        icon: path.join(__dirname, 'src', 'icon.ico'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'src', 'update-preload.js')
        }
    });

    updateWindow.loadFile(path.join(__dirname, 'src', 'update.html'), {
        query: { current: currentVersion, new: newVersion }
    });

    updateWindow.on('closed', () => {
        updateWindow = null;
    });
}

function setupAutoUpdater() {
    console.log('🔄 Setting up auto-updater...');

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    console.log('🔍 Checking for updates...');
    autoUpdater.checkForUpdates().catch(err => {
        console.log('❌ Check update error:', err);
    });

    autoUpdater.on('checking-for-update', () => {
        console.log('📡 Checking for update...');
    });

    autoUpdater.on('update-available', (info) => {
        console.log('✅ Update available:', info.version);
        pendingUpdateInfo = info;

        // Notify main window about available update (for in-app notification)
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-available', {
                currentVersion: app.getVersion(),
                newVersion: info.version
            });
        }
    });

    autoUpdater.on('update-not-available', (info) => {
        console.log('ℹ️ No update available. Current version is latest.');
        // Silently ignore - no popup needed when no update
    });

    autoUpdater.on('download-progress', (progress) => {
        console.log(`📥 Download progress: ${Math.round(progress.percent)}%`);
        if (mainWindow) {
            mainWindow.setProgressBar(progress.percent / 100);
            mainWindow.webContents.send('update-download-progress', progress.percent);
        }
        if (updateWindow) {
            updateWindow.webContents.send('download-progress', progress.percent);
        }
    });

    autoUpdater.on('update-downloaded', () => {
        console.log('✅ Update downloaded!');
        if (mainWindow) {
            mainWindow.setProgressBar(-1);
            mainWindow.webContents.send('update-downloaded');
        }
        if (updateWindow) {
            updateWindow.webContents.send('download-complete');
        }
        // Auto restart after 2 seconds with silent install
        setTimeout(() => {
            autoUpdater.quitAndInstall(true, true);
        }, 2000);
    });

    autoUpdater.on('error', (err) => {
        console.log('❌ AutoUpdater Error:', err);
        if (updateWindow) {
            updateWindow.close();
        }
    });

    // Start periodic background check (every 30 minutes)
    if (backgroundCheckInterval) clearInterval(backgroundCheckInterval);
    backgroundCheckInterval = setInterval(() => {
        console.log('🔄 Background update check...');
        autoUpdater.checkForUpdates().catch(err => {
            console.log('❌ Background check error:', err);
        });
    }, 30 * 60 * 1000); // 30 minutes
}

// IPC handlers for update window
ipcMain.on('download-update', () => {
    autoUpdater.downloadUpdate();
});

// Accept update from main window (in-app notification)
ipcMain.on('accept-update-from-main', () => {
    console.log('✅ User accepted update from main window');
    if (pendingUpdateInfo) {
        autoUpdater.downloadUpdate();
    }
});

// Skip update for now (dismiss notification)
ipcMain.on('skip-update', () => {
    console.log('⏭️ User skipped update');
    // Just dismiss - will ask again in 30 minutes
});

// Recheck update from launcher
ipcMain.on('recheck-update', () => {
    console.log('🔄 Rechecking for updates...');
    setupLauncherAutoUpdater();
});

ipcMain.on('custom-download', async () => {
    // Let user choose where to save the installer
    const result = await dialog.showOpenDialog(updateWindow, {
        title: 'เลือกโฟลเดอร์สำหรับบันทึกไฟล์ติดตั้ง',
        properties: ['openDirectory']
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        // User cancelled, close update window
        if (updateWindow) {
            updateWindow.close();
        }
        return;
    }

    const downloadPath = result.filePaths[0];

    // Download update to custom location
    const https = require('https');
    const fs = require('fs');
    const pathModule = require('path');

    // Get download URL from pending update info
    if (!pendingUpdateInfo || !pendingUpdateInfo.files || pendingUpdateInfo.files.length === 0) {
        console.log('❌ No update info available');
        if (updateWindow) updateWindow.close();
        return;
    }

    const updateFile = pendingUpdateInfo.files.find(f => f.url.endsWith('.exe'));
    if (!updateFile) {
        console.log('❌ No exe file found in update');
        if (updateWindow) updateWindow.close();
        return;
    }

    const downloadUrl = `https://github.com/Smallzoamz/medicop/releases/download/v${pendingUpdateInfo.version}/${updateFile.url}`;
    const filePath = pathModule.join(downloadPath, updateFile.url);

    console.log(`📥 Custom download: ${downloadUrl} -> ${filePath}`);

    const file = fs.createWriteStream(filePath);

    https.get(downloadUrl, {
        headers: { 'User-Agent': 'Medical-OP-Systems' }
    }, (response) => {
        // Handle redirect
        if (response.statusCode === 302 || response.statusCode === 301) {
            https.get(response.headers.location, {
                headers: { 'User-Agent': 'Medical-OP-Systems' }
            }, (redirectResponse) => {
                handleDownload(redirectResponse, file, filePath);
            });
        } else {
            handleDownload(response, file, filePath);
        }
    }).on('error', (err) => {
        console.log('❌ Download error:', err);
        fs.unlinkSync(filePath);
        if (updateWindow) updateWindow.close();
    });

    function handleDownload(response, file, filePath) {
        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;

        response.on('data', (chunk) => {
            downloadedSize += chunk.length;
            const percent = (downloadedSize / totalSize) * 100;
            if (updateWindow) {
                updateWindow.webContents.send('download-progress', percent);
            }
            if (mainWindow) {
                mainWindow.setProgressBar(percent / 100);
            }
        });

        response.pipe(file);

        file.on('finish', () => {
            file.close();
            console.log(`✅ Custom download complete: ${filePath}`);
            if (mainWindow) {
                mainWindow.setProgressBar(-1);
            }
            if (updateWindow) {
                updateWindow.webContents.send('download-complete');
            }
            // Open the folder containing the installer
            shell.showItemInFolder(filePath);
            // Close update window after 2 seconds
            setTimeout(() => {
                if (updateWindow) updateWindow.close();
            }, 2000);
        });
    }
});

ipcMain.on('close-update', () => {
    if (updateWindow) {
        updateWindow.close();
    }
});

// Handle login success from login/launcher window
ipcMain.on('login-success', (event, userData) => {
    console.log('✅ Login success:', userData.username);
    loggedInUser = userData;

    // Close launcher window
    if (launcherWindow) {
        launcherWindow.close();
        launcherWindow = null;
    }

    // Close login window (legacy)
    if (loginWindow) {
        loginWindow.close();
        loginWindow = null;
    }

    // Create and show main window with user data
    createMainWindow();
});

// Handle launcher minimize
ipcMain.on('launcher-minimize', () => {
    if (launcherWindow) launcherWindow.minimize();
});

// ========== WINDOW CONTROLS ==========
ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.on('window-close', () => {
    if (mainWindow) {
        // Show custom confirmation window
        createConfirmCloseWindow();
    }
});

// Handle confirm close dialog responses
ipcMain.on('confirm-close-cancel', () => {
    if (confirmCloseWindow) {
        confirmCloseWindow.close();
        confirmCloseWindow = null;
    }
});

ipcMain.on('confirm-close-confirm', () => {
    createGoodbyeCloseWindow();
});

ipcMain.handle('window-is-maximized', () => {
    return mainWindow ? mainWindow.isMaximized() : false;
});

// Handle close login window (X button on login page)
ipcMain.on('close-login-window', () => {
    console.log('❌ Closing login window');
    app.quit();
});

// Handle open external URL (for Discord OAuth)
ipcMain.on('open-external', (event, url) => {
    shell.openExternal(url);
});

// Handle user logout - show goodbye then return to login
ipcMain.on('user-logout', () => {
    console.log('🔓 User logout - showing goodbye screen');
    loggedInUser = null;

    // Close overlay window if open
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.close();
        overlayWindow = null;
        isOverlayMode = false;
    }

    // Close any open panel windows
    Object.keys(panelWindows).forEach(key => {
        if (panelWindows[key] && !panelWindows[key].isDestroyed()) {
            panelWindows[key].close();
        }
    });
    panelWindows = {};

    // Show goodbye window
    createGoodbyeWindow();
});

// Show centered game mode notification
let notifyWindow = null;
function showGameModeNotification(text, bgColor) {
    // Close existing notification
    if (notifyWindow && !notifyWindow.isDestroyed()) {
        notifyWindow.close();
    }

    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width } = primaryDisplay.workAreaSize;

    notifyWindow = new BrowserWindow({
        width: 250,
        height: 50,
        x: Math.round((width - 250) / 2),
        y: 20,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        transparent: true,
        focusable: false,
        resizable: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    notifyWindow.setIgnoreMouseEvents(true);
    notifyWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    notifyWindow.setAlwaysOnTop(true, 'screen-saver');

    const html = `
        <html>
        <body style="margin:0; background:transparent; display:flex; justify-content:center; align-items:center; height:100%;">
            <div style="background:${bgColor}; color:white; padding:12px 24px; border-radius:12px; font-family:system-ui; font-size:16px; font-weight:bold; box-shadow:0 4px 20px rgba(0,0,0,0.3);">
                ${text}
            </div>
        </body>
        </html>
    `;
    notifyWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

    // Auto close after 1.5 seconds
    setTimeout(() => {
        if (notifyWindow && !notifyWindow.isDestroyed()) {
            notifyWindow.close();
            notifyWindow = null;
        }
    }, 1500);
}

// ========== MINI OVERLAY MODE ==========
// Settings file path
const settingsPath = path.join(app.getPath('userData'), 'overlay-settings.json');

// Load/Save settings functions
function loadSettings() {
    try {
        if (fs.existsSync(settingsPath)) {
            return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        }
    } catch (e) { console.error('Failed to load settings:', e); }
    return { overlay: { x: 50, y: 50, opacity: 0.95 }, panel: { opacity: 0.95 } };
}

function saveSettings(settings) {
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        console.log('💾 Settings saved');
    } catch (e) { console.error('Failed to save settings:', e); }
}

// Load saved settings
let allSettings = loadSettings();
let overlaySettings = allSettings.overlay || { x: 50, y: 50, opacity: 0.95 };
let panelSettings = allSettings.panel || { opacity: 0.95 };

function createOverlayWindow() {
    if (overlayWindow) {
        overlayWindow.focus();
        return;
    }

    overlayWindow = new BrowserWindow({
        width: 300,
        height: 500,
        x: overlaySettings.x,
        y: overlaySettings.y,
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: false,  // Show in taskbar as a convenience feature
        transparent: true,
        opacity: overlaySettings.opacity,
        icon: path.join(__dirname, 'src', 'icon.ico'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'src', 'overlay-preload.js')
        }
    });

    // Keep overlay visible across all workspaces and Alt+Tab
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    // Overlay starts in interactive mode - use F10 to toggle to game mode

    // Pass user data
    const userDataParam = loggedInUser ? encodeURIComponent(JSON.stringify(loggedInUser)) : '';
    overlayWindow.loadFile(path.join(__dirname, 'src', 'overlay.html'), {
        query: { userData: userDataParam }
    });

    overlayWindow.on('closed', () => {
        overlayWindow = null;
        isOverlayMode = false;
        // Close all panel windows
        Object.values(panelWindows).forEach(win => {
            if (win && !win.isDestroyed()) {
                win.close();
            }
        });
        panelWindows = {};
        // Unregister hotkeys
        globalShortcut.unregister('F10');
        globalShortcut.unregister('F11');
        // Show main window again
        if (mainWindow) {
            mainWindow.show();
        }
    });

    // Register F10 hotkey to toggle overlay and all panels visibility
    globalShortcut.register('F10', () => {
        if (overlayWindow) {
            if (overlayWindow.isVisible()) {
                overlayWindow.hide();
                // Hide all panels too
                Object.values(panelWindows).forEach(win => {
                    if (win && !win.isDestroyed()) win.hide();
                });
                console.log('🙈 All windows hidden (F10)');
            } else {
                overlayWindow.show();
                // Show all panels too
                Object.values(panelWindows).forEach(win => {
                    if (win && !win.isDestroyed()) win.show();
                });
                console.log('👁️ All windows shown (F10)');
            }
        }
    });
    console.log('⌨️ F10 hotkey registered for all windows toggle');

    // F11 to toggle interactive mode (click-through vs clickable) for all windows
    let isInteractiveMode = true; // Start as interactive
    globalShortcut.register('F11', () => {
        if (overlayWindow) {
            isInteractiveMode = !isInteractiveMode;
            if (isInteractiveMode) {
                // Interactive mode - can click
                overlayWindow.setIgnoreMouseEvents(false);
                overlayWindow.setFocusable(true);
                Object.values(panelWindows).forEach(win => {
                    if (win && !win.isDestroyed()) {
                        win.setIgnoreMouseEvents(false);
                        win.setFocusable(true);
                    }
                });
                // Show centered notification
                showGameModeNotification('🖱️ Interactive Mode', '#d97706');
                console.log('🖱️ Interactive Mode ON - All windows clickable (F11)');
            } else {
                // Game mode - all windows are click-through
                overlayWindow.setIgnoreMouseEvents(true, { forward: true });
                overlayWindow.setFocusable(false);
                Object.values(panelWindows).forEach(win => {
                    if (win && !win.isDestroyed()) {
                        win.setIgnoreMouseEvents(true, { forward: true });
                        win.setFocusable(false);
                    }
                });
                // Show centered notification
                showGameModeNotification('🎮 Game Mode ON', '#059669');
                console.log('🎮 Game Mode ON - All windows click-through (F11)');
            }
        }
    });
    console.log('⌨️ F11 hotkey registered for all windows interactive toggle');

    console.log('🖥️ Mini Overlay window created');
}

// Toggle Mini Overlay Mode
ipcMain.on('toggle-overlay-mode', () => {
    if (isOverlayMode) {
        // Exit overlay mode
        if (overlayWindow) {
            overlayWindow.close();
            overlayWindow = null;
        }
        // Destroy tray
        if (tray) {
            tray.destroy();
            tray = null;
        }
        isOverlayMode = false;
        if (mainWindow) {
            mainWindow.show();
        }
        console.log('📺 Switched to Full Mode');
    } else {
        // Enter overlay mode
        isOverlayMode = true;

        // Create system tray
        if (!tray) {
            tray = new Tray(path.join(__dirname, 'src', 'icon.ico'));
            const contextMenu = Menu.buildFromTemplate([
                {
                    label: '📺 กลับ Full Mode', click: () => {
                        ipcMain.emit('toggle-overlay-mode');
                    }
                },
                { type: 'separator' },
                {
                    label: '🖥️ แสดง Overlay', click: () => {
                        if (overlayWindow) overlayWindow.show();
                    }
                },
                { type: 'separator' },
                {
                    label: '❌ ปิดโปรแกรม', click: () => {
                        app.quit();
                    }
                }
            ]);
            tray.setToolTip('Medical OP Systems - Mini Overlay');
            tray.setContextMenu(contextMenu);

            // Double-click to show main window
            tray.on('double-click', () => {
                ipcMain.emit('toggle-overlay-mode');
            });

            console.log('🔔 System tray created');
        }

        // Keep main window visible - overlay is just a convenience feature
        // mainWindow stays open, user can minimize if they want
        createOverlayWindow();
        console.log('🖥️ Switched to Mini Overlay Mode');
    }
});

// Expand overlay (resize to larger)
ipcMain.on('overlay-expand', () => {
    if (overlayWindow) {
        const currentBounds = overlayWindow.getBounds();
        overlayWindow.setBounds({
            x: currentBounds.x,
            y: currentBounds.y,
            width: 300,
            height: 350
        });
    }
});

// Collapse overlay (resize to smaller)
ipcMain.on('overlay-collapse', () => {
    if (overlayWindow) {
        const currentBounds = overlayWindow.getBounds();
        overlayWindow.setBounds({
            x: currentBounds.x,
            y: currentBounds.y,
            width: 300,
            height: 150
        });
    }
});

// Hide overlay temporarily
ipcMain.on('overlay-hide', () => {
    if (overlayWindow) {
        overlayWindow.hide();
    }
});

// Show overlay
ipcMain.on('overlay-show', () => {
    if (overlayWindow) {
        overlayWindow.show();
    }
});

// Exit overlay and show main window
ipcMain.on('overlay-exit', () => {
    if (overlayWindow) {
        overlayWindow.close();
        overlayWindow = null;
    }
    // Destroy tray
    if (tray) {
        tray.destroy();
        tray = null;
    }
    isOverlayMode = false;
    if (mainWindow) {
        mainWindow.show();
    }
});

// Expand overlay for feature panel
ipcMain.on('overlay-expand-panel', () => {
    if (overlayWindow) {
        const currentBounds = overlayWindow.getBounds();
        overlayWindow.setBounds({
            x: currentBounds.x,
            y: currentBounds.y,
            width: 300,
            height: 280
        });
    }
});

// Collapse overlay (hide feature panel)
ipcMain.on('overlay-collapse-panel', () => {
    if (overlayWindow) {
        const currentBounds = overlayWindow.getBounds();
        overlayWindow.setBounds({
            x: currentBounds.x,
            y: currentBounds.y,
            width: 300,
            height: 150
        });
    }
});

// Auto-resize overlay based on content height
ipcMain.on('overlay-resize', (event, height) => {
    if (overlayWindow) {
        const currentBounds = overlayWindow.getBounds();
        const newHeight = Math.min(Math.max(height, 200), 800); // Min 200, Max 800
        overlayWindow.setBounds({
            x: currentBounds.x,
            y: currentBounds.y,
            width: 300,
            height: newHeight
        });
    }
});

// Set overlay opacity
ipcMain.on('overlay-set-opacity', (event, opacity) => {
    if (overlayWindow) {
        const newOpacity = Math.min(Math.max(opacity, 0.3), 1.0);
        overlayWindow.setOpacity(newOpacity);
        overlaySettings.opacity = newOpacity;
        allSettings.overlay = overlaySettings;
        saveSettings(allSettings);
    }
});

// Save overlay position
ipcMain.on('overlay-save-position', () => {
    if (!overlayWindow) return;
    const bounds = overlayWindow.getBounds();
    overlaySettings.x = bounds.x;
    overlaySettings.y = bounds.y;
    allSettings.overlay = overlaySettings;
    saveSettings(allSettings);
    console.log(`💾 Overlay position saved: x=${bounds.x}, y=${bounds.y}`);
});

// Get overlay settings
ipcMain.handle('overlay-get-settings', () => {
    return overlaySettings;
});

// Auto-announce feature - sends message to game chat
ipcMain.on('send-announcement', (event, message) => {
    // Copy message to clipboard
    clipboard.writeText(message);
    console.log('📢 Announcement copied:', message.substring(0, 50) + '...');

    // Wait 500ms then simulate keystrokes using PowerShell
    setTimeout(() => {
        const { spawn } = require('child_process');

        // PowerShell commands as single string
        const psCommands = 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("{PGDN}"); Start-Sleep -Milliseconds 150; [System.Windows.Forms.SendKeys]::SendWait("^v"); Start-Sleep -Milliseconds 100; [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")';

        const ps = spawn('powershell', ['-NoProfile', '-Command', psCommands], {
            windowsHide: true
        });

        ps.on('error', (err) => {
            console.error('❌ PowerShell error:', err);
        });

        ps.on('close', (code) => {
            if (code === 0) {
                console.log('✅ Announcement sent successfully');
            } else {
                console.error('❌ PowerShell exited with code:', code);
            }
        });
    }, 500);
});

// Create separate panel windows
// panelSettings is already loaded at the top

ipcMain.on('open-panel-window', (event, panelType) => {
    // Close existing panel of same type
    if (panelWindows[panelType]) {
        panelWindows[panelType].focus();
        return;
    }

    const panelConfig = {
        price: { width: 320, height: 550, title: 'ตารางค่ารักษา' },
        copy: { width: 400, height: 250, title: 'รวมคำสั่ง' },
        blacklist: { width: 500, height: 580, title: 'Blacklist' }
    };

    const config = panelConfig[panelType] || { width: 200, height: 200, title: 'Panel' };

    // Get saved position for this panel or calculate new one
    const savedPanelPositions = allSettings.panelPositions || {};
    let panelX, panelY;

    if (savedPanelPositions[panelType]) {
        panelX = savedPanelPositions[panelType].x;
        panelY = savedPanelPositions[panelType].y;
    } else {
        const overlayBounds = overlayWindow ? overlayWindow.getBounds() : { x: 50, y: 150 };
        const xOffset = Object.keys(panelWindows).length * 210;
        panelX = overlayBounds.x + 290 + xOffset;
        panelY = overlayBounds.y;
    }

    const panelWin = new BrowserWindow({
        width: config.width,
        height: config.height,
        x: panelX,
        y: panelY,
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        transparent: true,
        opacity: panelSettings.opacity,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'src', 'panel-preload.js')
        }
    });

    panelWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    panelWin.setAlwaysOnTop(true, 'screen-saver');

    panelWin.loadFile(path.join(__dirname, 'src', `panel-${panelType}.html`));

    // Save position when panel is moved
    panelWin.on('moved', () => {
        const bounds = panelWin.getBounds();
        if (!allSettings.panelPositions) allSettings.panelPositions = {};
        allSettings.panelPositions[panelType] = { x: bounds.x, y: bounds.y };
        saveSettings(allSettings);
        console.log(`📍 Panel ${panelType} position saved: x=${bounds.x}, y=${bounds.y}`);
    });

    panelWin.on('closed', () => {
        delete panelWindows[panelType];
    });

    panelWindows[panelType] = panelWin;
    console.log(`📋 Panel window created: ${panelType} at (${panelX}, ${panelY})`);
});

// Set opacity for all panels and overlay
ipcMain.on('set-all-opacity', (event, opacity) => {
    const newOpacity = Math.min(Math.max(opacity, 0.3), 1.0);

    // Apply to overlay
    if (overlayWindow) {
        overlayWindow.setOpacity(newOpacity);
    }

    // Apply to all panel windows
    Object.values(panelWindows).forEach(win => {
        if (win && !win.isDestroyed()) {
            win.setOpacity(newOpacity);
        }
    });

    // Save settings using JSON file
    overlaySettings.opacity = newOpacity;
    panelSettings.opacity = newOpacity;
    allSettings.overlay = overlaySettings;
    allSettings.panel = panelSettings;
    saveSettings(allSettings);

    console.log(`🎨 Opacity set to ${Math.round(newOpacity * 100)}% for all windows`);
});

// Get current opacity for display
ipcMain.handle('get-all-opacity', () => {
    return panelSettings.opacity;
});

// Close panel window
ipcMain.on('close-panel-window', (event, panelType) => {
    if (panelWindows[panelType]) {
        panelWindows[panelType].close();
        delete panelWindows[panelType];
    }
});

// Track which windows were visible before Blacklist opened
let hiddenWindowsBeforeBlacklist = {
    overlay: false,
    panels: []
};

// Open Blacklist panel (hides other windows)
ipcMain.on('open-blacklist-panel', () => {
    // Save state of visible windows
    hiddenWindowsBeforeBlacklist.overlay = overlayWindow && overlayWindow.isVisible();
    hiddenWindowsBeforeBlacklist.panels = [];

    Object.entries(panelWindows).forEach(([type, win]) => {
        if (win && !win.isDestroyed() && win.isVisible() && type !== 'blacklist') {
            hiddenWindowsBeforeBlacklist.panels.push(type);
            win.hide();
        }
    });

    // Hide overlay
    if (overlayWindow && overlayWindow.isVisible()) {
        overlayWindow.hide();
    }

    // Open or focus Blacklist panel
    if (panelWindows.blacklist) {
        panelWindows.blacklist.show();
        panelWindows.blacklist.focus();
    } else {
        // Create blacklist panel (center of screen)
        const { screen } = require('electron');
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.workAreaSize;

        const panelWidth = 500;
        const panelHeight = 580;
        const panelX = Math.round((width - panelWidth) / 2);
        const panelY = Math.round((height - panelHeight) / 2);

        const blacklistWin = new BrowserWindow({
            width: panelWidth,
            height: panelHeight,
            x: panelX,
            y: panelY,
            frame: false,
            resizable: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            transparent: true,
            opacity: panelSettings.opacity,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'src', 'panel-preload.js')
            }
        });

        blacklistWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        blacklistWin.setAlwaysOnTop(true, 'screen-saver');
        blacklistWin.loadFile(path.join(__dirname, 'src', 'panel-blacklist.html'));

        blacklistWin.on('closed', () => {
            delete panelWindows.blacklist;
        });

        panelWindows.blacklist = blacklistWin;
        console.log('🚫 Blacklist panel opened (focused mode)');
    }
});

// Close Blacklist panel (restores other windows)
ipcMain.on('close-blacklist-panel', () => {
    // Close blacklist panel
    if (panelWindows.blacklist) {
        panelWindows.blacklist.close();
        delete panelWindows.blacklist;
    }

    // Restore overlay
    if (hiddenWindowsBeforeBlacklist.overlay && overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.show();
    }

    // Restore other panels that were open
    hiddenWindowsBeforeBlacklist.panels.forEach(type => {
        if (panelWindows[type] && !panelWindows[type].isDestroyed()) {
            panelWindows[type].show();
        }
    });

    // Reset state
    hiddenWindowsBeforeBlacklist = { overlay: false, panels: [] };
    console.log('✅ Blacklist panel closed, overlays restored');
});

// ========== MUSIC BOX ==========
let musicBoxWindow = null;

function createMusicBoxWindow() {
    if (musicBoxWindow && !musicBoxWindow.isDestroyed()) {
        musicBoxWindow.focus();
        return;
    }

    // Get saved position or use default
    const savedPos = allSettings.musicBox || { x: 100, y: 100 };

    musicBoxWindow = new BrowserWindow({
        width: 400,
        height: 600,
        x: savedPos.x,
        y: savedPos.y,
        frame: false,
        resizable: true,
        minWidth: 350,
        minHeight: 500,
        alwaysOnTop: true,
        skipTaskbar: false,
        transparent: true,
        opacity: panelSettings.opacity || 0.95,
        icon: path.join(__dirname, 'src', 'icon.ico'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'src', 'musicbox-preload.js')
        }
    });

    musicBoxWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    musicBoxWindow.setAlwaysOnTop(true, 'screen-saver');

    // Load music box from Firebase-hosted URL (deployed public folder)
    // For now, load local file - change to URL after deployment
    musicBoxWindow.loadFile(path.join(__dirname, 'src', 'music.html'));

    // Save position when moved
    musicBoxWindow.on('moved', () => {
        const bounds = musicBoxWindow.getBounds();
        allSettings.musicBox = { x: bounds.x, y: bounds.y };
        saveSettings(allSettings);
        console.log(`🎵 Music Box position saved: x=${bounds.x}, y=${bounds.y}`);
    });

    musicBoxWindow.on('closed', () => {
        musicBoxWindow = null;
        console.log('🎵 Music Box closed');
    });

    console.log('🎵 Music Box window created');
}

// Open Music Box
ipcMain.on('open-music-box', () => {
    createMusicBoxWindow();
});

// Close Music Box
ipcMain.on('close-music-box', () => {
    if (musicBoxWindow && !musicBoxWindow.isDestroyed()) {
        musicBoxWindow.close();
        musicBoxWindow = null;
    }
});

// ========== END AUTO UPDATE ==========

// App ready
app.whenReady().then(() => {
    // Configure session to allow YouTube iframe API and audio streams
    const filter = {
        urls: [
            '*://*.youtube.com/*',
            '*://*.googlevideo.com/*',
            '*://www.youtube.com/*',
            '*://s.ytimg.com/*',
            // Audio streaming domain for Lo-Fi radio
            '*://*.ilovemusic.de/*',
            '*://streams.ilovemusic.de/*'
        ]
    };

    // Allow cross-origin requests for YouTube
    session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
        // Remove restrictive headers that block iframes
        const responseHeaders = { ...details.responseHeaders };

        // Allow embedding in iframes
        delete responseHeaders['x-frame-options'];
        delete responseHeaders['X-Frame-Options'];

        // Allow cross-origin requests
        responseHeaders['Access-Control-Allow-Origin'] = ['*'];

        callback({ responseHeaders });
    });

    console.log('🎵 YouTube iframe API CORS bypass enabled');

    // Show splash first
    createSplashWindow();

    // After splash, show launcher window
    setTimeout(() => {
        if (splashWindow) {
            splashWindow.close();
            splashWindow = null;
        }
        createLauncherWindow();
    }, 2500);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            if (loggedInUser) {
                createMainWindow();
            } else {
                createLauncherWindow();
            }
        }
    });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
