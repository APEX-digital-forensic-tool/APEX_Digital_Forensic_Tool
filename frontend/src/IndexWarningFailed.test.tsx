// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { IndexWarning } from "./IndexWarning";

afterEach(cleanup);
const state = (key: "search" | "timeline", status: string) => [
  {
    evidence_id: "e1",
    display_name: "증거",
    search: { state: "CURRENT", status: "COMPLETE", source_items: 3 },
    timeline: { state: "CURRENT", status: "COMPLETE", source_items: 3 },
    [key]: {
      state: "PARTIAL",
      status,
      source_status: "COMPLETE",
      source_items: 3,
    },
  },
];

it.each(["timeline", "search"] as const)(
  "says a failed %s build failed, not that it is partial",
  (key) => {
    render(
      <IndexWarning
        route={key === "search" ? "SEARCH" : "TIMELINE"}
        caseId="c"
        state={state(key, "FAILED")}
        onStarted={() => {}}
      />,
    );
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toContain("실패");
    expect(text).not.toContain("일부만");
  },
);

it("keeps the partial wording for a partial build", () => {
  render(
    <IndexWarning
      route="TIMELINE"
      caseId="c"
      state={state("timeline", "PARTIAL")}
      onStarted={() => {}}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain("일부만");
});

it.each(["timeline", "search"] as const)(
  "says a failed %s build failed even when there was nothing to build from",
  (key) => {
    render(
      <IndexWarning
        route={key === "search" ? "SEARCH" : "TIMELINE"}
        caseId="c"
        state={[
          {
            evidence_id: "e1",
            display_name: "증거",
            search: { state: "CURRENT", status: "COMPLETE", source_items: 3 },
            timeline: { state: "CURRENT", status: "COMPLETE", source_items: 3 },
            [key]: {
              state: "NONE",
              status: "FAILED",
              source_status: "NOT_STARTED",
              source_items: 0,
            },
          },
        ]}
        onStarted={() => {}}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("실패");
  },
);
