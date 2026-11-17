import type { Messages } from "../ko-KR";

export const native: Messages["native"] = {
  pickTitle: "Select evidence to analyze",
  evidenceImages: "Evidence images",
  allFiles: "All files",
  startFailedTitle: "APEX could not start",
  startFailed: "An error occurred while opening the app. Start APEX again.",
  userDataUnwritable: (folder) =>
    `APEX cannot write to its data folder.\n\n${folder}\n\nCheck this folder's permissions, then start APEX again.`,
  quitBusyMessage: "Analysis is still running",
  quitBusyDetail:
    "Quitting now cancels or interrupts running tasks. APEX waits up to one minute for evidence registration to finish.",
  quitAnyway: "Quit",
  keepWorking: "Keep working",
};
