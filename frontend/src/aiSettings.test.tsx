// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createDemoBridge } from "./demoBridge";
import type { DesktopBridge } from "./gateway";
import { renderInEnglish } from "./i18n/testing";
import core from "./__fixtures__/core.json";

afterEach(() => {
  cleanup();
  delete window.apex;
});

const none = {
  configured: false,
  managed: false,
  has_key: false,
  storage_available: true,
  base_url: null,
  model_id: null,
  temperature: 0,
  max_output: 4096,
  timeout: 30,
};
const configured = {
  ...none,
  configured: true,
  has_key: true,
  base_url: "http://127.0.0.1:9/v1",
  model_id: "test-model",
};
const ok = <T,>(data: T) => ({ ok: true as const, data });

/** The demo bridge with overrides; counts `runtime` calls, i.e. bootstraps. */
function mount(
  overrides: Partial<DesktopBridge> = {},
  tasks?: Record<string, unknown>[],
) {
  const bridge = { ...createDemoBridge(), ...overrides };
  const original = bridge.invoke.bind(bridge);
  const runtime = { calls: 0 };
  bridge.invoke = async (op, payload) => {
    if (op === "runtime") runtime.calls++;
    if (op === "tasks.list" && tasks) return ok(tasks);
    return original(op, payload);
  };
  window.apex = bridge;
  renderInEnglish(<App />);
  return runtime;
}

async function openCase() {
  const select = screen.getByLabelText("Current case") as HTMLSelectElement;
  await waitFor(() =>
    expect([...select.options].map((o) => o.value)).toContain(core.cases[0].id),
  );
  fireEvent.change(select, { target: { value: core.cases[0].id } });
}

async function openSettings() {
  await userEvent.click(screen.getByRole("button", { name: "Settings" }));
}

it("blocks Save and Remove while the open case has an active task", async () => {
  mount({ aiConnection: async () => ok(configured) }, [
    { task_id: "t1", case_id: core.cases[0].id, status: "RUNNING" },
  ]);
  await openCase();
  await openSettings();
  expect(
    await screen.findByText(
      "You can change this after the running analysis tasks finish.",
    ),
  ).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (
      screen.getByRole("button", {
        name: "Remove connection",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

it("removes a configured connection and loads the app state again", async () => {
  const clear = vi.fn(async () => ok(none));
  const runtime = mount({
    aiConnection: async () => ok(configured),
    clearAiConnection: clear,
  });
  await openSettings();
  await screen.findByText("Configured");
  await waitFor(() => expect(runtime.calls).toBeGreaterThan(0));
  const before = runtime.calls;
  await userEvent.click(
    screen.getByRole("button", { name: "Remove connection" }),
  );
  await screen.findByText("Not configured");
  expect(clear).toHaveBeenCalledOnce();
  await waitFor(() => expect(runtime.calls).toBeGreaterThan(before));
});

it("explains a save refused because analysis is running", async () => {
  mount({
    aiConnection: async () => ok(none),
    saveAiConnection: async () => ({
      ok: false as const,
      error: { code: "AI_ENGINE_BUSY" },
    }),
  });
  await openSettings();
  await userEvent.type(
    await screen.findByLabelText("Base URL"),
    "http://127.0.0.1:9/v1",
  );
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(
    await screen.findByText(
      "An analysis task is running, so this cannot be changed now. Try again after it finishes.",
    ),
  ).toBeTruthy();
});
