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
const state = (
  search: string,
  timeline: string,
  sources = 5,
  extra: Record<string, unknown> = {},
) => [
  {
    evidence_id: "e1",
    display_name: "yakzzz 폴더",
    search: { state: search, indexed_items: 0, source_items: sources },
    timeline: { state: timeline, events: 0, ...extra },
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
      tasks={[]}
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
      tasks={[]}
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
      tasks={[]}
      onStarted={() => {}}
    />,
  );
  expect(screen.getByText("타임라인 만들기")).toBeTruthy();
  view.rerender(
    <IndexWarning
      route="TIMELINE"
      caseId="c"
      state={state("NONE", "CURRENT")}
      tasks={[]}
      onStarted={() => {}}
    />,
  );
  expect(screen.queryByRole("status")).toBeNull();
});

it("asks for the file index first when the timeline had no input", () => {
  render(
    <IndexWarning
      route="TIMELINE"
      caseId="c"
      state={state("CURRENT", "NONE", 0, { needs_files: true })}
      tasks={[]}
      onStarted={() => {}}
    />,
  );
  expect(screen.getByText("파일 인덱스 만들기")).toBeTruthy();
});

it("says a failed timeline build failed, not that it is partial", () => {
  render(
    <IndexWarning
      route="TIMELINE"
      caseId="c"
      state={state("CURRENT", "PARTIAL", 5, { failed: true })}
      tasks={[]}
      onStarted={() => {}}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain("실패");
  expect(screen.getByRole("status").textContent).not.toContain("일부만");
});

it("keeps the button disabled until the started job has ended", async () => {
  vi.spyOn(gateway, "call").mockResolvedValue({});
  const props = {
    route: "SEARCH" as const,
    caseId: "c",
    state: state("NONE", "NONE"),
    onStarted: () => {},
  };
  const view = render(
    <IndexWarning
      {...props}
      tasks={[{ task_id: "old", kind: "SEARCH", status: "SUCCEEDED" }]}
    />,
  );
  fireEvent.click(screen.getByText("검색 인덱스 만들기"));
  const button = () =>
    screen.getByText("검색 인덱스 만들기") as HTMLButtonElement;
  await vi.waitFor(() => expect(button().disabled).toBe(true));
  view.rerender(
    <IndexWarning
      {...props}
      tasks={[
        { task_id: "old", kind: "SEARCH", status: "SUCCEEDED" },
        { task_id: "new", kind: "SEARCH", status: "RUNNING" },
      ]}
    />,
  );
  expect(button().disabled).toBe(true);
  view.rerender(
    <IndexWarning
      {...props}
      tasks={[
        { task_id: "old", kind: "SEARCH", status: "SUCCEEDED" },
        { task_id: "new", kind: "SEARCH", status: "SUCCEEDED" },
      ]}
    />,
  );
  expect(button().disabled).toBe(false);
});

it("drops an old error when switching between search and timeline", async () => {
  vi.spyOn(gateway, "call").mockRejectedValue(new Error("boom"));
  const common = {
    caseId: "c",
    state: state("NONE", "NONE"),
    tasks: [],
    onStarted: () => {},
  };
  const view = render(<IndexWarning route="SEARCH" {...common} />);
  fireEvent.click(screen.getByText("검색 인덱스 만들기"));
  await screen.findByRole("alert");
  view.rerender(<IndexWarning route="TIMELINE" {...common} />);
  expect(screen.queryByRole("alert")).toBeNull();
});
