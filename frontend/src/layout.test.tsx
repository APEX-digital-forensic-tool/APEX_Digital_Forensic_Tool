// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { App } from "./App";
import { createDemoBridge } from "./demoBridge";
import core from "./__fixtures__/core.json";

afterEach(() => {
  cleanup();
  delete window.apex;
});

it("shows one group's screens at a time and remembers the last one", async () => {
  window.apex = createDemoBridge();
  const { container } = render(<App />);
  await screen.findByText("데모 · 합성 데이터");
  fireEvent.change(screen.getByLabelText("현재 사건"), {
    target: { value: core.cases[0].id },
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "파일 시스템" })).toBeTruthy(),
  );
  expect(screen.queryByRole("button", { name: "타임라인" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "분석" }));
  fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
  expect(screen.queryByRole("button", { name: "파일 시스템" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "탐색" }));
  fireEvent.click(screen.getByRole("button", { name: "분석" }));
  expect(
    screen
      .getByRole("button", { name: "타임라인" })
      .getAttribute("aria-current"),
  ).toBe("page");

  // The report screen does not act on the evidence tree, so it takes the width.
  const shell = container.querySelector(".app-shell")!;
  expect(shell.classList.contains("no-evidence-pane")).toBe(false);
  fireEvent.click(
    screen
      .getAllByRole("button", { name: "보고서" })
      .find((b) => b.closest(".tab-groups"))!,
  );
  expect(shell.classList.contains("no-evidence-pane")).toBe(true);
});

it("opens search with Ctrl+F and closes drawers with Escape", async () => {
  window.apex = createDemoBridge();
  render(<App />);
  await screen.findByText("데모 · 합성 데이터");
  fireEvent.change(screen.getByLabelText("현재 사건"), {
    target: { value: core.cases[0].id },
  });
  fireEvent.keyDown(window, { key: "f", ctrlKey: true });
  const query = await screen.findByLabelText("검색어");
  await waitFor(() => expect(document.activeElement).toBe(query));

  fireEvent.click(screen.getByRole("button", { name: "AI 도우미" }));
  expect(screen.getByRole("button", { name: "AI 닫기" })).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("button", { name: "AI 닫기" })).toBeNull();
});

it("rejects a mistyped case time zone before creating the case", async () => {
  const bridge = createDemoBridge();
  const original = bridge.invoke.bind(bridge);
  const ops: string[] = [];
  bridge.invoke = async (op, payload) => {
    ops.push(op);
    return original(op, payload);
  };
  window.apex = bridge;
  render(<App />);
  await screen.findByText("데모 · 합성 데이터");
  fireEvent.click(screen.getByRole("button", { name: "새 사건" }));
  const dialog = screen.getByRole("dialog", { name: "새 사건 만들기" });
  fireEvent.change(within(dialog).getByLabelText("사건 이름"), {
    target: { value: "시간대 확인" },
  });
  fireEvent.change(within(dialog).getByLabelText("시간대 (IANA)"), {
    target: { value: "Asia/Seol" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "사건 만들기" }));
  await within(dialog).findByText(/알 수 없는 시간대 이름입니다/);
  expect(ops).not.toContain("cases.create");
});
