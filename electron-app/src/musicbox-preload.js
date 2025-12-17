const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    closeMusicBox: () => ipcRenderer.send('close-music-box'),
    searchYouTube: (query) => ipcRenderer.invoke('youtube-search', query)
});
