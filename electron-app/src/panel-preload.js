const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('panelAPI', {
    close: (panelType) => ipcRenderer.send('close-panel-window', panelType),
    copyToClipboard: (text) => {
        navigator.clipboard.writeText(text);
        return true;
    },
    // Auto-announce function
    announce: (message) => ipcRenderer.send('send-announcement', message)
});
