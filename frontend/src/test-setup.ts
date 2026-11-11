import { afterEach } from "vitest";

// jsdom does not implement the native dialog methods provided by Electron Chromium.
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute("open");
  };
}

// Locale choice and <html lang> must not leak between tests.
afterEach(() => {
  try {
    if (typeof localStorage !== "undefined") localStorage.clear();
  } catch {
    // Storage may be blocked by a test's own spies.
  }
  if (typeof document !== "undefined") document.documentElement.lang = "ko";
});
