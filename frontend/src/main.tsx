import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { I18nProvider } from "./i18n/I18nProvider";
import { SetupApp } from "./setup/SetupApp";
import "@astryxdesign/core/astryx.css";
import "./styles.css";
import "./workbench/workbench.css";
async function mount() {
  if (import.meta.env.DEV && import.meta.env.VITE_APEX_DEMO === "1") {
    const { createDemoBridge } = await import("./demoBridge");
    window.apex = createDemoBridge();
  }
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <I18nProvider>
        {location.hash === "#setup" ? <SetupApp /> : <App />}
      </I18nProvider>
    </React.StrictMode>,
  );
}
void mount();
