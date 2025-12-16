const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcherAPI', {
    // Window controls
    minimize: () => ipcRenderer.send('launcher-minimize'),
    closeApp: () => ipcRenderer.send('close-login-window'),

    // Login
    loginSuccess: (userData) => ipcRenderer.send('login-success', userData),

    // External links
    openExternal: (url) => ipcRenderer.send('open-external', url),

    // Update events
    onUpdateStatus: (callback) => ipcRenderer.on('update-status', (event, status) => callback(status)),
    onUpdateProgress: (callback) => ipcRenderer.on('download-progress', (event, percent) => callback(percent))
});
