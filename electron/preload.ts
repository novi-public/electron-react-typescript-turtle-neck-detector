import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('app:get-version') as Promise<string>,
  triggerPostureAlert: (payload: { mode: 'flash' | 'image'; imagePath?: string }) =>
    ipcRenderer.send('trigger-posture-alert', payload),
  getAlertImages: () =>
    ipcRenderer.invoke('get-alert-images') as Promise<Array<{ id: string; name: string; path: string }>>,
});
