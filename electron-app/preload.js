const { contextBridge, ipcRenderer } = require('electron');

// Expose isElectronApp and window controls to renderer process securely
contextBridge.exposeInMainWorld('electronEnv', {
    isElectron: true
});

// Window controls for custom title bar
contextBridge.exposeInMainWorld('windowControls', {
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
    isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
    logout: () => ipcRenderer.send('user-logout'),
    toggleOverlayMode: () => ipcRenderer.send('toggle-overlay-mode'),
    openMusicBox: () => ipcRenderer.send('open-music-box'),
    openExternal: (url) => ipcRenderer.send('open-external', url),
    // Logout with confirmation - use this from UI
    confirmLogout: () => {
        // Ask user for confirmation before logout
        if (window.showConfirm) {
            window.showConfirm('ออกจากระบบ', 'คุณต้องการออกจากระบบใช่หรือไม่?').then(confirmed => {
                if (confirmed) {
                    ipcRenderer.send('user-logout');
                }
            });
        } else {
            // Fallback to native confirm
            if (confirm('คุณต้องการออกจากระบบใช่หรือไม่?')) {
                ipcRenderer.send('user-logout');
            }
        }
    }
});

// Update notification API for in-app alerts
contextBridge.exposeInMainWorld('updateNotification', {
    onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, info) => callback(info)),
    onDownloadProgress: (callback) => ipcRenderer.on('update-download-progress', (event, percent) => callback(percent)),
    onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', () => callback()),
    acceptUpdate: () => ipcRenderer.send('accept-update-from-main'),
    skipUpdate: () => ipcRenderer.send('skip-update')
});

// Also try to set directly (for backward compatibility)
window.addEventListener('DOMContentLoaded', () => {
    // Set isElectronApp flag
    try {
        window.isElectronApp = true;
    } catch (e) { }

    // Hide footer in Electron app
    const footer = document.getElementById('app-footer');
    if (footer) {
        footer.style.display = 'none';
    }

    // Initialize custom title bar
    const titleBar = document.getElementById('electron-title-bar');
    if (titleBar && window.windowControls) {
        titleBar.classList.remove('hidden');
        document.body.classList.add('has-title-bar');

        document.getElementById('btn-minimize')?.addEventListener('click', () => {
            window.windowControls.minimize();
        });

        document.getElementById('btn-maximize')?.addEventListener('click', () => {
            window.windowControls.maximize();
        });

        document.getElementById('btn-close')?.addEventListener('click', () => {
            window.windowControls.close();
        });
    }

    // Log startup
    console.log('🖥️ Medical OP Systems - Desktop App Loaded');
});
