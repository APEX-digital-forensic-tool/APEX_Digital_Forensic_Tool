import type { Messages } from "../ko-KR";

export const setup: Messages["setup"] = {
  title: "Set up APEX",
  steps: [
    "Language",
    "Examiner name",
    "AI connection",
    "OCR and speech recognition",
    "Server account",
  ],
  back: "Back",
  skip: "Skip",
  next: "Next",
  start: "Start",
  progress: (n: number, total: number) => `${n} / ${total}`,
  optional: "Optional. You can change this later in Settings.",
  accountNote: "Sign-in lasts until you quit the app.",
  machineNote: "The defaults work out of the box.",
  ai: {
    title: "AI connection",
    baseUrl: "Base URL",
    model: "Model name",
    apiKey: "API key",
    keepKey: "Leave empty to keep the stored key.",
    advanced: "Advanced settings",
    temperature: "Temperature",
    maxOutput: "Max output tokens",
    timeout: "Timeout (seconds)",
    save: "Save",
    remove: "Remove connection",
    configured: "Configured",
    notConfigured: "Not configured",
    managed:
      "Managed by the APEX_DESKTOP_AI_CONFIG environment variable. Change it in the runtime environment.",
    storageUnavailable:
      "This computer cannot encrypt the key, so it is not stored in the app.",
    restartNote: "Saving restarts the analysis engine.",
    busy: "You can change this after the running analysis tasks finish.",
    policyNote: "What is sent to AI is decided by each case's AI data policy.",
  },
  examiner: {
    label: "Examiner name",
    hint: "Prefilled when you create a case. You can change it for each case.",
  },
};
