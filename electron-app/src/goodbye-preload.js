const { contextBridge, ipcRenderer } = require('electron');

// Expose goodbye API to renderer process (empty for now, can add later)
contextBridge.exposeInMainWorld('goodbyeAPI', {
    // Can add functions if needed
});
