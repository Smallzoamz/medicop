const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    closeMusicBox: () => ipcRenderer.send('close-music-box')
});
