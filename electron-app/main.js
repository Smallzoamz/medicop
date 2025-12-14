const { app, BrowserWindow, shell, dialog, ipcMain, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

// Enable autoplay for audio/video without user gesture
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Keep a global reference of windows
let splashWindow;
let loginWindow;
let mainWindow;
let goodbyeWindow;
let loggedInUser = null;

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

// Create login window
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

    // Auto close after 2.5 seconds and show login
    setTimeout(() => {
        if (goodbyeWindow) {
            goodbyeWindow.close();
            goodbyeWindow = null;
        }
        createLoginWindow();
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
        createUpdateWindow(app.getVersion(), info.version);
    });

    autoUpdater.on('update-not-available', (info) => {
        console.log('ℹ️ No update available. Current version is latest.');
        // Silently ignore - no popup needed when no update
    });

    autoUpdater.on('download-progress', (progress) => {
        console.log(`📥 Download progress: ${Math.round(progress.percent)}%`);
        if (mainWindow) {
            mainWindow.setProgressBar(progress.percent / 100);
        }
        if (updateWindow) {
            updateWindow.webContents.send('download-progress', progress.percent);
        }
    });

    autoUpdater.on('update-downloaded', () => {
        console.log('✅ Update downloaded!');
        if (mainWindow) {
            mainWindow.setProgressBar(-1);
        }
        if (updateWindow) {
            updateWindow.webContents.send('download-complete');
        }
        // Auto restart after 2 seconds
        setTimeout(() => {
            autoUpdater.quitAndInstall();
        }, 2000);
    });

    autoUpdater.on('error', (err) => {
        console.log('❌ AutoUpdater Error:', err);
        if (updateWindow) {
            updateWindow.close();
        }
    });
}

// IPC handlers for update window
ipcMain.on('download-update', () => {
    autoUpdater.downloadUpdate();
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

// Handle login success from login window
ipcMain.on('login-success', (event, userData) => {
    console.log('✅ Login success:', userData.username);
    loggedInUser = userData;

    // Close login window
    if (loginWindow) {
        loginWindow.close();
        loginWindow = null;
    }

    // Create and show main window with user data
    createMainWindow();
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

    // Show goodbye window
    createGoodbyeWindow();
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

    // After splash, show login window (not main window)
    setTimeout(() => {
        if (splashWindow) {
            splashWindow.close();
            splashWindow = null;
        }
        createLoginWindow();
    }, 2500);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            if (loggedInUser) {
                createMainWindow();
            } else {
                createLoginWindow();
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
