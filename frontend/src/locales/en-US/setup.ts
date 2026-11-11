import type { Messages } from "../ko-KR";

export const setup: Messages["setup"] = {
  title: "Set up APEX",
  stepsLabel: "Setup steps",
  steps: [
    "Language",
    "Examiner name",
    "AI connection",
    "OCR and speech recognition",
    "Server account",
  ],
  descriptions: [
    "Choose the language the app is shown in. It changes as soon as you pick.",
    "The examiner name is prefilled when you create a case. You can change it for each case.",
    "Connect an external AI provider to use AI-assisted analysis. All local analysis works without it.",
    "The analyzers and models used for text recognition (OCR) and speech recognition (STT). The defaults work out of the box.",
    "A server account is only for connecting to remote services. Local analysis does not need it, and sign-in lasts until you quit the app.",
  ],
  intro:
    "Everything except language can be skipped and changed later in Settings.",
  back: "Back",
  skip: "Skip",
  next: "Next",
  saveAndNext: "Save and continue",
  saving: "Saving…",
  start: "Start",
  progress: (n: number, total: number) => `${n} / ${total}`,
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
    saving:
      "Restarting the analysis engine. This can take up to a minute or so.",
    busy: "You can change this after the running analysis tasks finish.",
    policyNote: "What is sent to AI is decided by each case's AI data policy.",
  },
  examiner: {
    title: "New case defaults",
    label: "Examiner name",
    hint: "Prefilled when you create a case. You can change it for each case.",
  },
};
