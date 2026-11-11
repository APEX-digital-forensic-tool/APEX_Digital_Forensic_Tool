import type { Messages } from "../ko-KR";

export const setup: Messages["setup"] = {
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
