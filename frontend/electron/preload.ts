import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("apex", {
  invoke: (operation: string, payload: Record<string, unknown>) =>
    ipcRenderer.invoke("apex:invoke", operation, payload),
  pick: (
    kind: "file" | "directory",
    locale?: string,
    purpose?: "evidence" | "model" | "tessdata",
  ) => ipcRenderer.invoke("apex:pick", kind, locale, purpose),
  openExports: () => ipcRenderer.invoke("apex:exports"),
  account: () => ipcRenderer.invoke("apex:account"),
  login: (input: unknown) => ipcRenderer.invoke("apex:login", input),
  logout: () => ipcRenderer.invoke("apex:logout"),
  onAccountChange: (listener: (status: unknown) => void) => {
    const forward = (_event: unknown, status: unknown) => listener(status);
    ipcRenderer.on("apex:account-changed", forward);
    return () => {
      ipcRenderer.removeListener("apex:account-changed", forward);
    };
  },
  aiConnection: () => ipcRenderer.invoke("apex:ai-connection"),
  saveAiConnection: (input: unknown) =>
    ipcRenderer.invoke("apex:ai-connection-save", input),
  clearAiConnection: () => ipcRenderer.invoke("apex:ai-connection-clear"),
  completeSetup: () => ipcRenderer.invoke("apex:setup-complete"),
  restartEngine: () => ipcRenderer.invoke("apex:restart-engine"),
});
