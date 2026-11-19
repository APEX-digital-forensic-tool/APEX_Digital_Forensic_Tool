// Stand-in for frontend/electron/preload.ts. Operations reach the real engine.
// The native file dialog is the only replaced boundary: queue a path with
// window.__apexVerify.pick("/abs/path") before clicking an add or pick button.
(() => {
  const queue = [];
  const call = async (operation, payload) => {
    const body = { ...payload };
    if (operation === "evidence.register") {
      body.source_path = body.source_reference;
      delete body.source_reference;
    }
    const response = await fetch("/__engine/v1/operations/" + operation, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.json();
  };
  window.__apexVerify = {
    pick: (path) => queue.push(path),
    pending: () => [...queue],
  };
  window.apex = {
    invoke: (operation, payload) => call(operation, payload),
    pick: async () => {
      const path = queue.shift();
      return {
        ok: true,
        data: path ? { reference: path, name: path.split("/").pop() } : null,
      };
    },
    openExports: async () => ({ ok: true, data: null }),
    account: async () => ({ ok: true, data: null }),
    login: async () => ({ ok: false, error: { code: "DESKTOP_REQUIRED" } }),
    logout: async () => ({ ok: true, data: null }),
    aiConnection: async () => ({
      ok: true,
      data: { configured: false, managed_by_env: false, key_storage_available: false },
    }),
    saveAiConnection: async () => ({ ok: false, error: { code: "DESKTOP_REQUIRED" } }),
    clearAiConnection: async () => ({ ok: true, data: null }),
    completeSetup: async () => ({ ok: true, data: null }),
  };
})();
