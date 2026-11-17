// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IndexWarning } from "./IndexWarning";
import { gateway } from "./gateway";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const state = (search: string, timeline: string, sources = 5) => [
  {
    evidence_id: "e1",
    display_name: "yakzzz 폴더",
    search: { state: search, indexed_items: 0, source_items: sources },
    timeline: { state: timeline, events: 0 },
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
