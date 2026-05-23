/// <reference types="vite/client" />

type NotificationMode = "flash" | "image";

type TriggerPostureAlertPayload = {
  mode: NotificationMode;
  imagePath?: string;
};

type AlertImageItem = {
  id: string;
  name: string;
  path: string;
};

interface Window {
  electronAPI?: {
    getAppVersion: () => Promise<string>;
    triggerPostureAlert: (payload: TriggerPostureAlertPayload) => void;
    getAlertImages: () => Promise<AlertImageItem[]>;
    onUpdateAvailable: (callback: () => void) => void;
    downloadUpdate: () => void;
    installUpdate: () => void;
  };
}
