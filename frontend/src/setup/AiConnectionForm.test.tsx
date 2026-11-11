// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderInEnglish } from "../i18n/testing";
import { createDemoBridge } from "../demoBridge";
import type { DesktopBridge } from "../gateway";
import { AiConnectionForm } from "./AiConnectionForm";

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
const ok = <T,>(data: T) => ({ ok: true as const, data });

function mount(
  overrides: Partial<DesktopBridge>,
  props: React.ComponentProps<typeof AiConnectionForm> = {},
) {
  window.apex = { ...createDemoBridge(), ...overrides };
  return renderInEnglish(<AiConnectionForm {...props} />);
}

it("saves the connection, then clears the key field and never shows the key", async () => {
  const save = vi.fn(async () =>
    ok({
      ...none,
      configured: true,
      has_key: true,
      base_url: "https://api.example.com/v1",
      model_id: "model-x",
    }),
  );
  mount({ aiConnection: async () => ok(none), saveAiConnection: save });
  await userEvent.type(
    await screen.findByLabelText("Base URL"),
    "https://api.example.com/v1",
  );
  await userEvent.type(screen.getByLabelText("Model name"), "model-x");
  await userEvent.type(screen.getByLabelText("API key"), "test-key-123");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Configured");
  expect(save).toHaveBeenCalledWith({
    base_url: "https://api.example.com/v1",
    model_id: "model-x",
    api_key: "test-key-123",
    temperature: 0,
    max_output: 4096,
    timeout: 30,
  });
  expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
  expect(document.body.innerHTML).not.toContain("test-key-123");
  expect((screen.getByLabelText("API key") as HTMLInputElement).type).toBe(
    "password",
  );
});

it("shows a managed connection as read-only", async () => {
  mount({
    aiConnection: async () => ok({ ...none, configured: true, managed: true }),
  });
  await screen.findByText(
    /Managed by the APEX_DESKTOP_AI_CONFIG environment variable/,
  );
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});

it("blocks saving and removing while analysis is running", async () => {
  mount(
    {
      aiConnection: async () =>
        ok({ ...none, configured: true, has_key: true }),
    },
    {
      blockedReason:
        "You can change this after the running analysis tasks finish.",
      showRemove: true,
    },
  );
  expect(
    (await screen.findByRole("button", { name: "Save" })).hasAttribute(
      "disabled",
    ),
  ).toBe(true);
  expect(
    screen
      .getByRole("button", { name: "Remove connection" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(
    screen.getByText(
      "You can change this after the running analysis tasks finish.",
    ),
  ).toBeTruthy();
});

it("keeps the form filled and explains a rejected save", async () => {
  mount({
    aiConnection: async () => ok(none),
    saveAiConnection: async () => ({
      ok: false,
      error: { code: "AI_CONNECTION_INVALID" },
    }),
  });
  await userEvent.type(
    await screen.findByLabelText("Base URL"),
    "http://api.example.com",
  );
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect((screen.getByLabelText("Base URL") as HTMLInputElement).value).toBe(
    "http://api.example.com",
  );
});

it("says when the key cannot be encrypted on this computer", async () => {
  mount({
    aiConnection: async () => ok({ ...none, storage_available: false }),
  });
  await screen.findByText(
    "This computer cannot encrypt the key, so it is not stored in the app.",
  );
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});

it("offers Try again when the status fails to load", async () => {
  let calls = 0;
  mount({
    aiConnection: async () =>
      ++calls === 1
        ? { ok: false, error: { code: "DESKTOP_CONNECTION_FAILED" } }
        : ok(none),
  });
  await userEvent.click(
    await screen.findByRole("button", { name: "Try again" }),
  );
  await screen.findByLabelText("Base URL");
  expect(calls).toBe(2);
});

it("shows the saving label and the restart status while a save is running", async () => {
  mount({
    aiConnection: async () => ok(none),
    saveAiConnection: () => new Promise(() => {}),
  });
  await userEvent.type(
    await screen.findByLabelText("Base URL"),
    "http://127.0.0.1:9/v1",
  );
  // The live region is there before it has anything to say, so the text is
  // announced when it arrives.
  expect(screen.getByRole("status").textContent).toBe("");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  const saving = screen.getByRole("button", { name: "Saving…" });
  expect((saving as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toMatch(
    /Restarting the analysis engine/,
  );
});

it("keeps the Save label while a removal is running", async () => {
  mount(
    {
      aiConnection: async () =>
        ok({
          ...none,
          configured: true,
          has_key: true,
          base_url: "http://127.0.0.1:9/v1",
          model_id: "test-model",
        }),
      clearAiConnection: () => new Promise(() => {}),
    },
    { showRemove: true },
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Remove connection" }),
  );
  const save = screen.getByRole("button", { name: "Save" });
  expect((save as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Saving…" })).toBeNull();
  expect(screen.getByRole("status").textContent).toMatch(
    /Restarting the analysis engine/,
  );
});
