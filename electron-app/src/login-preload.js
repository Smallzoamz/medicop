const { contextBridge, ipcRenderer } = require('electron');

// Expose login API to renderer process
contextBridge.exposeInMainWorld('loginAPI', {
    loginSuccess: (userData) => ipcRenderer.send('login-success', userData)
});
