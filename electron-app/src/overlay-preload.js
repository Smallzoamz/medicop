const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
    expand: () => ipcRenderer.send('overlay-expand'),
    collapse: () => ipcRenderer.send('overlay-collapse'),
    expandPanel: () => ipcRenderer.send('overlay-expand-panel'),
    collapsePanel: () => ipcRenderer.send('overlay-collapse-panel'),
    hide: () => ipcRenderer.send('overlay-hide'),
    exit: () => ipcRenderer.send('overlay-exit'),
    openPanel: (panelType) => ipcRenderer.send('open-panel-window', panelType),
    resizeToFit: (height) => ipcRenderer.send('overlay-resize', height),
    // Settings functions - apply to ALL windows
    setAllOpacity: (opacity) => ipcRenderer.send('set-all-opacity', opacity),
    getAllOpacity: () => ipcRenderer.invoke('get-all-opacity'),
    savePosition: () => ipcRenderer.send('overlay-save-position'),
    getSettings: () => ipcRenderer.invoke('overlay-get-settings'),
    // Game mode listener
    onGameModeChanged: (callback) => ipcRenderer.on('game-mode-changed', (event, isGameMode) => callback(isGameMode)),
    // Blacklist panel - opens with focus mode (hides other overlays)
    openBlacklistPanel: () => ipcRenderer.send('open-blacklist-panel')
});
