// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { HANGUL, renderInEnglish } from "./testing";
import { enUS } from "../locales/en-US";
import { FormDialog, Reports } from "../panels";
import { gateway, type Row } from "../gateway";
import { reviewFlow } from "../reportWorkflow";
import fixture from "../__fixtures__/report.json";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const base = fixture.detail.versions[0];
const draftVersion: Row = {
  ...base,
  sections: [
    { ...base.sections[0], section_id: "s1", title: "Scope" },
    { ...base.sections[0], section_id: "s2", title: "Findings" },
  ],
  review_state: { ...base.review_state, status: "DRAFT", section_status: {} },
};

it("labels the review workflow in English", async () => {
  vi.spyOn(gateway, "call").mockImplementation(
    async <T = Row,>(op: string): Promise<T> => {
      if (op === "reports.list") return { items: [fixture.report] } as T;
      if (op === "reports.get")
        return {
          ...fixture.detail,
          versions: [draftVersion],
          approvals: { [draftVersion.report_version_id]: null },
        } as T;
      throw new Error(op);
    },
  );
  renderInEnglish(
    <Reports
      caseId={base.case_id}
      evidenceId=""
      renderer={{}}
      onNotice={vi.fn()}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: new RegExp(fixture.report.title),
    }),
  );
  const flow = await screen.findByRole("region", { name: "Review progress" });
  expect(
    within(flow)
      .getAllByRole("listitem")
      // Each step starts with its number mark.
      .map((item) => item.textContent?.replace(/^\d+/, "")),
  ).toEqual(["Draft", "In review", "Reviewed", "Approved", "Exported"]);
  expect(
    within(flow).getByRole("button", { name: "Submit for review" }),
  ).toBeTruthy();
});

it("derives English hints from reviewFlow", () => {
  const flow = reviewFlow({ version: draftVersion, decision: null, m: enUS });
  expect(flow.hint).not.toMatch(HANGUL);
  expect(flow.hint.length).toBeGreaterThan(0);
  expect(enUS.report.actions[flow.primary].label).toBe("Submit for review");
});

it("marks required dialog fields in English", () => {
  renderInEnglish(
    <FormDialog
      title="Dialog"
      fields={[{ key: "name", label: "Case name", required: true }]}
      onSubmit={async () => {}}
      onClose={() => {}}
    />,
  );
  // The marker is drawn by CSS from this attribute, so it follows the catalog.
  expect(
    screen.getByText("Case name").getAttribute("data-required-label"),
  ).toBe("Required");
});
