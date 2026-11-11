// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderInEnglish } from "./testing";
import { I18nProvider } from "./I18nProvider";
import { App } from "../App";
import { createDemoBridge } from "../demoBridge";
import core from "../__fixtures__/core.json";
import { enUS } from "../locales/en-US";
import { GatewayError, type Reply, type Row } from "../gateway";
import {
  Badge,
  displayValue,
  Empty,
  ErrorState,
  evidenceFormat,
  Loading,
  time,
} from "../ui";

afterEach(() => {
  cleanup();
  delete window.apex;
});

it("renders shared states in English", () => {
  renderInEnglish(
    <>
      <Empty />
      <Loading />
      <ErrorState
        error={new GatewayError("DESKTOP_REQUIRED")}
        retry={() => {}}
      />
    </>,
  );
  expect(screen.getByText("No results")).toBeTruthy();
  expect(
    screen.getByText("Nothing was found in the selected scope."),
  ).toBeTruthy();
  expect(screen.getByText("Waiting for the analysis engine")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
});

it("translates enum labels and helper text", () => {
  renderInEnglish(<Badge value="CHANGES_REQUESTED" />);
  expect(screen.getByText("Changes requested")).toBeTruthy();
  expect(displayValue(true, "UTC", enUS)).toBe("Yes");
  expect(evidenceFormat("DIRECTORY", enUS)).toBe("Folder");
  expect(time("2026-01-01T00:00:00", "UTC", enUS)).toContain(
    "time zone unknown",
  );
});

it("switches the shell to English without losing the open case", async () => {
  window.apex = createDemoBridge();
  render(
    <I18nProvider initialLocale="ko-KR">
      <App />
    </I18nProvider>,
  );
  await waitFor(() =>
    expect(
      document.querySelector(`option[value="${core.cases[0].id}"]`),
    ).toBeTruthy(),
  );
  fireEvent.change(screen.getByLabelText("현재 사건"), {
    target: { value: core.cases[0].id },
  });
  fireEvent.click(await screen.findByRole("button", { name: "설정" }));
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "언어 · Language" }),
    "en-US",
  );
  expect(
    screen.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Settings" })
      .getAttribute("aria-current"),
  ).toBe("page");
  expect(
    (screen.getByLabelText("Current case") as HTMLSelectElement).value,
  ).toBe(core.cases[0].id);
  for (const name of ["Case", "Explore", "Analyze", "Report"])
    expect(screen.getByRole("button", { name })).toBeTruthy();
});

it("creates new cases in the display language", async () => {
  const bridge = createDemoBridge();
  const invoke = vi.spyOn(bridge, "invoke");
  window.apex = bridge;
  renderInEnglish(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "New case" }));
  fireEvent.change(screen.getByLabelText(/Case name/), {
    target: { value: "Laptop seizure" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create case" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      "cases.create",
      expect.objectContaining({ locale: "en-US" }),
    ),
  );
});

it("renders route views in English", async () => {
  window.apex = createDemoBridge();
  renderInEnglish(<App />);
  await screen.findByText("Demo · Synthetic data");
  fireEvent.change(screen.getByLabelText("Current case"), {
    target: { value: core.cases[0].id },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Case" }));
  fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
  expect(await screen.findByText(/^\d+ shown · /)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(
    screen.getByRole("heading", { name: "Runtime capabilities" }),
  ).toBeTruthy();
});

it("prints no placeholder for a task the engine reports without a kind", async () => {
  const bridge = createDemoBridge();
  const original = bridge.invoke.bind(bridge);
  bridge.invoke = async (op, payload) =>
    op === "tasks.list"
      ? {
          ok: true,
          data: [
            {
              task_id: "t-1",
              case_id: payload.case_id,
              status: "SUCCEEDED",
              actions: [],
            },
          ],
        }
      : (original(op, payload) as Promise<Reply<Row>>);
  window.apex = bridge;
  renderInEnglish(<App />);
  await screen.findByText("Demo · Synthetic data");
  fireEvent.change(screen.getByLabelText("Current case"), {
    target: { value: core.cases[0].id },
  });
  fireEvent.click(await screen.findByRole("button", { name: /^Tasks \d+$/ }));
  await waitFor(() =>
    expect(document.querySelector(".job-card strong")).toBeTruthy(),
  );
  expect(document.querySelector(".job-card strong")?.textContent).toBe("");
});
