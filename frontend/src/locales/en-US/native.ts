import type { Messages } from "../ko-KR";

export const native: Messages["native"] = {
  pickTitle: "Select evidence to analyze",
  evidenceImages: "Evidence images",
  allFiles: "All files",
  startupFailedTitle: "APEX startup or shutdown failed",
  startupFailedBody:
    "The app or analysis engine could not be prepared. Check write access to the app data directory and the installation, then restart APEX.",
  quitTitle: "Quit APEX",
  quitActive:
    "Analysis is active or its status could not be checked. Quitting may interrupt unfinished work. Quit now?",
  cancel: "Keep using APEX",
  quit: "Quit",
};
