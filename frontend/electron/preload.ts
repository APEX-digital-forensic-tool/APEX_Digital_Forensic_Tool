import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("apex", {
  invoke: (operation: string, payload: Record<string, unknown>) =>
    ipcRenderer.invoke("apex:invoke", operation, payload),
  pick: (kind: "file" | "directory", locale?: string) =>
    ipcRenderer.invoke("apex:pick", kind, locale),
  openExports: () => ipcRenderer.invoke("apex:exports"),
  account: () => ipcRenderer.invoke("apex:account"),
  login: (input: unknown) => ipcRenderer.invoke("apex:login", input),
  logout: () => ipcRenderer.invoke("apex:logout"),
  aiConnection: () => ipcRenderer.invoke("apex:ai-connection"),
  saveAiConnection: (input: unknown) =>
    ipcRenderer.invoke("apex:ai-connection-save", input),
  clearAiConnection: () => ipcRenderer.invoke("apex:ai-connection-clear"),
  completeSetup: () => ipcRenderer.invoke("apex:setup-complete"),
});
