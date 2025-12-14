const { contextBridge, ipcRenderer } = require('electron');

// Expose confirm dialog API to renderer process
contextBridge.exposeInMainWorld('confirmAPI', {
    cancel: () => ipcRenderer.send('confirm-close-cancel'),
    confirm: () => ipcRenderer.send('confirm-close-confirm')
});
