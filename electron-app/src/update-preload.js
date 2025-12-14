const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods for the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    downloadUpdate: () => ipcRenderer.send('download-update'),
    customDownload: () => ipcRenderer.send('custom-download'),
    closeUpdate: () => ipcRenderer.send('close-update'),
    onProgress: (callback) => ipcRenderer.on('download-progress', (event, percent) => callback(percent)),
    onDownloadComplete: (callback) => ipcRenderer.on('download-complete', () => callback())
});
