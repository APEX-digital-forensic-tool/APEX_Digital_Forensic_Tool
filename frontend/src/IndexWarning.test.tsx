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
import { IndexWarning } from "./IndexWarning";
import { gateway } from "./gateway";
import { App } from "./App";
import { createDemoBridge } from "./demoBridge";
import core from "./__fixtures__/core.json";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.apex;
});
const state = (search: string, timeline: string, sources = 5) => [
  {
    evidence_id: "e1",
    display_name: "yakzzz 폴더",
    search: { state: search, indexed_items: 0, source_items: sources },
    timeline: { state: timeline, events: 0, source_items: sources },
  },
];

it("warns that an evidence has no search index and builds it on request", async () => {
  const call = vi.spyOn(gateway, "call").mockResolvedValue({});
  const onStarted = vi.fn();
  render(
    <IndexWarning
      route="SEARCH"
      caseId="c"
      state={state("NONE", "NONE")}
      onStarted={onStarted}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain("yakzzz 폴더");
  fireEvent.click(screen.getByText("검색 인덱스 만들기"));
  await vi.waitFor(() => expect(onStarted).toHaveBeenCalled());
  expect(call).toHaveBeenCalledWith("analysis.start", {
    case_id: "c",
    evidence_id: "e1",
    kind: "SEARCH",
    profile_type: "FULL_ANALYSIS",
  });
});

it("asks for the file index first when nothing is indexed to search", () => {
  render(
    <IndexWarning
      route="SEARCH"
      caseId="c"
      state={state("NONE", "NONE", 0)}
      onStarted={() => {}}
    />,
  );
  expect(screen.getByText("파일 인덱스 만들기")).toBeTruthy();
});

it("warns about the timeline and stays silent when current", () => {
  const view = render(
    <IndexWarning
      route="TIMELINE"
      caseId="c"
      state={state("CURRENT", "NONE")}
      onStarted={() => {}}
    />,
  );
  expect(screen.getByText("타임라인 만들기")).toBeTruthy();
  view.rerender(
    <IndexWarning
      route="TIMELINE"
      caseId="c"
      state={state("NONE", "CURRENT")}
      onStarted={() => {}}
    />,
  );
  expect(screen.queryByRole("status")).toBeNull();
});

it("loads index warnings before a search is submitted and builds the indicated evidence", async () => {
  const bridge = createDemoBridge();
  const original = bridge.invoke.bind(bridge);
  const searches: unknown[] = [];
  const starts: unknown[] = [];
  bridge.invoke = async (operation, payload) => {
    if (operation === "index.state")
      return { ok: true, data: state("NONE", "NONE") };
    if (operation === "search.query") searches.push(payload);
    if (operation === "analysis.start") {
      starts.push(payload);
      return { ok: true, data: { task_id: "build-e1", status: "QUEUED" } };
    }
    return original(operation, payload);
  };
  window.apex = bridge;
  render(<App />);
  await screen.findByText("데모 · 합성 데이터");
  fireEvent.change(screen.getByLabelText("현재 사건"), {
    target: { value: core.cases[0].id },
  });
  await waitFor(() =>
    expect(
      (screen.getByLabelText("현재 증거") as HTMLSelectElement).value,
    ).toBe(core.evidence[0].id),
  );
  fireEvent.click(screen.getByRole("button", { name: "검색" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "검색 인덱스 만들기" }),
  );
  await waitFor(() =>
    expect(starts).toContainEqual({
      case_id: core.cases[0].id,
      evidence_id: "e1",
      kind: "SEARCH",
      profile_type: "FULL_ANALYSIS",
    }),
  );
  expect(searches).toEqual([]);
});

it("disables another build while the evidence index is running", () => {
  const running = state("PARTIAL", "NONE");
  const pending = running.map((e) => ({
    ...e,
    search: { ...e.search, status: "RUNNING" },
  }));
  render(
    <IndexWarning
      route="SEARCH"
      caseId="c"
      state={pending}
      onStarted={() => {}}
    />,
  );
  expect(
    (
      screen.getByRole("button", {
        name: "검색 인덱스 만들기",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
