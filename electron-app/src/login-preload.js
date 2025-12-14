const { contextBridge, ipcRenderer, shell } = require('electron');

// Expose login API to renderer process
contextBridge.exposeInMainWorld('loginAPI', {
    loginSuccess: (userData) => ipcRenderer.send('login-success', userData),
    closeApp: () => ipcRenderer.send('close-login-window'),
    openExternal: (url) => ipcRenderer.send('open-external', url)
});
