const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  triggerPostureAlert: (payload) => ipcRenderer.send('trigger-posture-alert', payload),
  getAlertImages: () => ipcRenderer.invoke('get-alert-images'),
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', callback);
  },
  downloadUpdate: () => ipcRenderer.send('download-update'),
  installUpdate: () => ipcRenderer.send('install-update'),
});
