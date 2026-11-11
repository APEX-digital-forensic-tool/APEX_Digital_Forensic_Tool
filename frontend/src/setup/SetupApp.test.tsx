// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { renderInEnglish } from "../i18n/testing";
import { I18nProvider } from "../i18n/I18nProvider";
import { createDemoBridge } from "../demoBridge";
import { SetupApp } from "./SetupApp";

afterEach(() => {
  cleanup();
  delete window.apex;
});

it("walks the five steps and finishes", async () => {
  const done = vi.fn(async () => ({ ok: true as const, data: null }));
  window.apex = { ...createDemoBridge(), completeSetup: done };
  render(
    <I18nProvider initialLocale="ko-KR">
      <SetupApp />
    </I18nProvider>,
  );
  expect(screen.getByText("1 / 5")).toBeTruthy();
  await userEvent.click(screen.getByRole("radio", { name: "English" }));
  expect(
    screen.getByRole("heading", { level: 1, name: "Set up APEX" }),
  ).toBeTruthy();
  expect(localStorage.getItem("apex.locale")).toBe("en-US");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.type(screen.getByLabelText("Examiner name"), "Kim");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(
    screen.getByRole("heading", { level: 2, name: "AI connection" }),
  ).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(
    screen.getByRole("heading", {
      level: 2,
      name: "OCR and speech recognition",
    }),
  ).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(
    screen.getByRole("heading", { level: 2, name: "Server account" }),
  ).toBeTruthy();
  expect(screen.getByText("5 / 5")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(done).toHaveBeenCalledOnce();
  expect(localStorage.getItem("apex.examinerName")).toBe("Kim");
});

it("goes back without losing what was entered", async () => {
  window.apex = createDemoBridge();
  renderInEnglish(<SetupApp />);
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.type(screen.getByLabelText("Examiner name"), "Kim");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(
    (screen.getByLabelText("Examiner name") as HTMLInputElement).value,
  ).toBe("Kim");
});

it("stays on the last step and reports when finishing fails", async () => {
  window.apex = {
    ...createDemoBridge(),
    completeSetup: async () => ({
      ok: false as const,
      error: { code: "DESKTOP_CONNECTION_FAILED" },
    }),
  };
  renderInEnglish(<SetupApp />);
  for (const name of ["Next", "Next", "Skip", "Next"])
    await userEvent.click(screen.getByRole("button", { name }));
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByText("5 / 5")).toBeTruthy();
});

const noConnection = {
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

it("shows where you are in the five steps and lets you jump between them", async () => {
  window.apex = createDemoBridge();
  renderInEnglish(<SetupApp />);
  const steps = within(
    screen.getByRole("navigation", { name: "Setup steps" }),
  ).getAllByRole("listitem");
  expect(steps.map((s) => s.textContent)).toEqual([
    "Language",
    "Examiner name",
    "AI connection",
    "OCR and speech recognition",
    "Server account",
  ]);
  const button = (i: number) => within(steps[i]).getByRole("button");
  expect(button(0).getAttribute("aria-current")).toBe("step");
  expect(steps[0].getAttribute("aria-current")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(button(0).getAttribute("aria-current")).toBeNull();
  expect(steps[0].getAttribute("data-state")).toBe("done");
  expect(button(1).getAttribute("aria-current")).toBe("step");
  await userEvent.click(
    within(steps[4]).getByRole("button", { name: "Server account" }),
  );
  expect(
    screen.getByRole("heading", { level: 2, name: "Server account" }),
  ).toBeTruthy();
  expect(screen.getByText("5 / 5")).toBeTruthy();
});

it("saves the AI connection with the step's own primary button and moves on", async () => {
  const save = vi.fn(async () => ({
    ok: true as const,
    data: {
      ...noConnection,
      configured: true,
      has_key: true,
      base_url: "https://api.example.com/v1",
      model_id: "model-x",
    },
  }));
  window.apex = { ...createDemoBridge(), saveAiConnection: save };
  renderInEnglish(<SetupApp />);
  await userEvent.click(screen.getByRole("button", { name: "AI connection" }));
  await userEvent.type(
    await screen.findByLabelText("Base URL"),
    "https://api.example.com/v1",
  );
  await userEvent.type(screen.getByLabelText("Model name"), "model-x");
  await userEvent.type(screen.getByLabelText("API key"), "test-key-123");
  // One primary action on this step: no separate Save next to Next.
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Save and continue" }),
  );
  expect(
    await screen.findByRole("heading", {
      level: 2,
      name: "OCR and speech recognition",
    }),
  ).toBeTruthy();
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      base_url: "https://api.example.com/v1",
      model_id: "model-x",
      api_key: "test-key-123",
    }),
  );
  expect(document.body.innerHTML).not.toContain("test-key-123");
});

it("stays on the AI step and explains a rejected save", async () => {
  window.apex = {
    ...createDemoBridge(),
    saveAiConnection: async () => ({
      ok: false as const,
      error: { code: "AI_CONNECTION_INVALID" },
    }),
  };
  renderInEnglish(<SetupApp />);
  await userEvent.click(screen.getByRole("button", { name: "AI connection" }));
  await screen.findByLabelText("Base URL");
  await userEvent.click(
    screen.getByRole("button", { name: "Save and continue" }),
  );
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(
    screen.getByRole("heading", { level: 2, name: "AI connection" }),
  ).toBeTruthy();
});

it("offers only Next on the AI step when the connection is managed elsewhere", async () => {
  window.apex = {
    ...createDemoBridge(),
    aiConnection: async () => ({
      ok: true as const,
      data: { ...noConnection, configured: true, managed: true },
    }),
  };
  renderInEnglish(<SetupApp />);
  await userEvent.click(screen.getByRole("button", { name: "AI connection" }));
  await screen.findByText(
    /Managed by the APEX_DESKTOP_AI_CONFIG environment variable/,
  );
  expect(
    screen.queryByRole("button", { name: "Save and continue" }),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
});

it("embeds the OCR and account cards without repeating their titles", async () => {
  window.apex = createDemoBridge();
  renderInEnglish(<SetupApp />);
  await userEvent.click(
    screen.getByRole("button", { name: "OCR and speech recognition" }),
  );
  expect(
    screen.queryByRole("heading", {
      name: "Local OCR and speech recognition settings",
    }),
  ).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Server account" }));
  expect(screen.queryByRole("heading", { name: "APEX account" })).toBeNull();
});

function pendingSave() {
  let settle!: (reply: unknown) => void;
  const save = vi.fn(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  return { save, settle: (reply: unknown) => settle(reply) };
}

async function saveOnAiStep(save: unknown) {
  window.apex = {
    ...createDemoBridge(),
    saveAiConnection: save as never,
  };
  renderInEnglish(<SetupApp />);
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.type(
    await screen.findByLabelText("Base URL"),
    "http://127.0.0.1:9/v1",
  );
  await userEvent.type(screen.getByLabelText("Model name"), "test-model");
  await userEvent.type(screen.getByLabelText("API key"), "test-key-123");
  await userEvent.click(
    screen.getByRole("button", { name: "Save and continue" }),
  );
}

function railButtons() {
  return within(
    screen.getByRole("navigation", { name: "Setup steps" }),
  ).getAllByRole("button") as HTMLButtonElement[];
}

it("locks the window while the AI connection is saving and then moves on", async () => {
  const { save, settle } = pendingSave();
  await saveOnAiStep(save);
  const saving = (await screen.findByRole("button", {
    name: "Saving…",
  })) as HTMLButtonElement;
  expect(saving.disabled).toBe(true);
  expect(railButtons().every((b) => b.disabled)).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Back" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Skip" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    screen
      .getByText(/restarting the analysis engine/i)
      .closest("[role='status']"),
  ).toBeTruthy();
  // A busy region can make screen readers hold back the status line inside it.
  expect(document.querySelector("[aria-busy]")).toBeNull();
  await act(async () =>
    settle({
      ok: true,
      data: {
        ...noConnection,
        configured: true,
        has_key: true,
        base_url: "http://127.0.0.1:9/v1",
        model_id: "test-model",
      },
    }),
  );
  expect(
    await screen.findByRole("heading", {
      level: 2,
      name: "OCR and speech recognition",
    }),
  ).toBeTruthy();
  expect(railButtons().every((b) => !b.disabled)).toBe(true);
});

it("stays on the AI step with the error and unlocks when a save fails", async () => {
  const { save, settle } = pendingSave();
  await saveOnAiStep(save);
  await screen.findByRole("button", { name: "Saving…" });
  await act(async () =>
    settle({ ok: false, error: { code: "AI_ENGINE_BUSY" } }),
  );
  expect(await screen.findByText(/An analysis task is running/)).toBeTruthy();
  expect(
    screen.getByRole("heading", { level: 2, name: "AI connection" }),
  ).toBeTruthy();
  expect(railButtons().every((b) => !b.disabled)).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Back" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  expect(
    (
      screen.getByRole("button", {
        name: "Save and continue",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  expect(screen.queryByText(/restarting the analysis engine/i)).toBeNull();
});

function railStates() {
  return within(screen.getByRole("navigation", { name: "Setup steps" }))
    .getAllByRole("listitem")
    .map((item) => item.getAttribute("data-state"));
}

it("checks off only the steps that have something set", async () => {
  localStorage.removeItem("apex.examinerName");
  window.apex = createDemoBridge();
  renderInEnglish(<SetupApp />);
  expect(railStates()).toEqual(["current", "todo", "todo", "todo", "todo"]);
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Server account" }));
  expect(railStates()).toEqual(["done", "todo", "todo", "todo", "current"]);
  await userEvent.click(screen.getByRole("button", { name: "Examiner name" }));
  await userEvent.type(screen.getByLabelText("Examiner name"), "Kim");
  // The step being edited is never shown as done.
  expect(railStates()[1]).toBe("current");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(railStates()).toEqual(["done", "done", "current", "todo", "todo"]);
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  await userEvent.clear(screen.getByLabelText("Examiner name"));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(railStates()[1]).toBe("todo");
});

it("checks off the AI step when a connection is configured", async () => {
  window.apex = {
    ...createDemoBridge(),
    aiConnection: async () => ({
      ok: true as const,
      data: {
        ...noConnection,
        configured: true,
        has_key: true,
        base_url: "http://127.0.0.1:9/v1",
        model_id: "test-model",
      },
    }),
  };
  renderInEnglish(<SetupApp />);
  await userEvent.click(screen.getByRole("button", { name: "AI connection" }));
  await screen.findByText("Configured");
  expect(railStates()[2]).toBe("current");
  await userEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(railStates()[2]).toBe("done");
  expect(railStates()[3]).toBe("current");
});

it("makes the rail a window drag region only on macOS", () => {
  const css = readFileSync("src/setup/setup.css", "utf8");
  const dragging = [
    ...css.matchAll(/([^{}]+)\{[^}]*-webkit-app-region:\s*drag/g),
  ].map((match) => match[1].replace(/\/\*[\s\S]*?\*\//g, "").trim());
  expect(dragging).toEqual([".setup-mac .setup-rail"]);
});
