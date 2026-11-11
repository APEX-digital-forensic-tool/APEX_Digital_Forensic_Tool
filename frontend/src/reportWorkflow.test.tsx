// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Reports } from "./panels";
import { gateway, type Row } from "./gateway";
import { reviewFlow } from "./reportWorkflow";
import fixture from "./__fixtures__/report.json";
import { koKR } from "./locales/ko-KR";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const base = fixture.detail.versions[0];
function version(
  status: string,
  sectionStatus: Record<string, string> = {},
  sections: Row[] = [
    { ...base.sections[0], section_id: "s1", title: "Scope" },
    { ...base.sections[0], section_id: "s2", title: "Findings" },
  ],
): Row {
  return {
    ...base,
    sections,
    review_state: {
      ...base.review_state,
      status,
      section_status: sectionStatus,
    },
  };
}

describe("reviewFlow", () => {
  it("offers only submission on a draft and keeps sections read-only", () => {
    const flow = reviewFlow({
      version: version("DRAFT"),
      decision: null,
      m: koKR,
    });
    expect(flow).toMatchObject({
      stage: "DRAFT",
      primary: "submit",
      secondary: [],
      sectionReview: false,
    });
  });

  it("blocks completion until every required section is accepted", () => {
    const partial = reviewFlow({
      version: version("IN_REVIEW", { s1: "ACCEPTED" }),
      decision: null,
      m: koKR,
    });
    expect(partial.primary).toBe("complete");
    expect(partial.blocked).toMatch(/필수 섹션 2개 중 1개/);
    expect(partial.sectionReview).toBe(true);

    const done = reviewFlow({
      version: version("IN_REVIEW", { s1: "ACCEPTED", s2: "ACCEPTED" }),
      decision: null,
      m: koKR,
    });
    expect(done.blocked).toBeUndefined();
  });

  it("ignores sections the engine marks as not requiring review", () => {
    const flow = reviewFlow({
      version: version("IN_REVIEW", { s1: "ACCEPTED" }, [
        { ...base.sections[0], section_id: "s1" },
        {
          ...base.sections[0],
          section_id: "s2",
          coverage: { status: "UNKNOWN", review_required: false },
        },
      ]),
      decision: null,
      m: koKR,
    });
    expect(flow).toMatchObject({ required: 1, accepted: 1 });
    expect(flow.blocked).toBeUndefined();
  });

  it("routes requested changes back to reopening, not approval", () => {
    const flow = reviewFlow({
      version: version("CHANGES_REQUESTED", { s2: "CHANGES_REQUESTED" }),
      decision: null,
      m: koKR,
    });
    expect(flow).toMatchObject({
      stage: "CHANGES_REQUESTED",
      primary: "reopen",
      tone: "warn",
    });
  });

  it("puts approval first after review completion", () => {
    const flow = reviewFlow({
      version: version("REVIEW_COMPLETE"),
      decision: null,
      m: koKR,
    });
    expect(flow).toMatchObject({
      primary: "approve",
      secondary: ["reject", "reopen"],
      sectionReview: false,
    });
    expect(
      reviewFlow({
        version: version("REVIEW_COMPLETE"),
        decision: "REVOKED",
        m: koKR,
      }).hint,
    ).toMatch(/승인이 철회되었습니다/);
  });

  it("only exports or revokes an approved version", () => {
    const flow = reviewFlow({
      version: version("REVIEW_COMPLETE"),
      decision: "APPROVED",
      m: koKR,
    });
    expect(flow).toMatchObject({
      stage: "APPROVED",
      primary: "export",
      secondary: ["revoke"],
    });
    expect(
      reviewFlow({
        version: version("REVIEW_COMPLETE"),
        decision: "APPROVED",
        exported: true,
        m: koKR,
      }).stage,
    ).toBe("EXPORTED");
  });

  it("sends a rejected version back to review", () => {
    const flow = reviewFlow({
      version: version("REVIEW_COMPLETE"),
      decision: "REJECTED",
      m: koKR,
    });
    expect(flow).toMatchObject({
      stage: "REJECTED",
      primary: "reopen",
      tone: "danger",
    });
  });
});

function mockReport(v: Row, decision: string | null = null) {
  return vi
    .spyOn(gateway, "call")
    .mockImplementation(async <T = Row,>(op: string): Promise<T> => {
      if (op === "reports.list") return { items: [fixture.report] } as T;
      if (op === "reports.get")
        return {
          ...fixture.detail,
          versions: [v],
          approvals: {
            [v.report_version_id]: decision ? { decision } : null,
          },
        } as T;
      if (op === "reports.action") return {} as T;
      throw new Error(op);
    });
}
async function openReport() {
  render(
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
  return screen.findByRole("region", { name: "검토 진행" });
}

describe("Reports review workflow", () => {
  it("shows a draft's single next step without approval or export", async () => {
    mockReport(version("DRAFT"));
    const flow = await openReport();
    expect(
      within(flow).getByRole("listitem", { current: "step" }).textContent,
    ).toContain("초안");
    expect(
      within(flow).getByRole("button", { name: "검토 제출" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "보관이력 포함 승인" })).toBe(
      null,
    );
    expect(screen.queryByRole("button", { name: "내보내기" })).toBeNull();
    expect(screen.queryByRole("button", { name: "이 섹션 채택" })).toBeNull();
  });

  it("explains why review completion is disabled", async () => {
    mockReport(version("IN_REVIEW", { s1: "ACCEPTED" }));
    const flow = await openReport();
    const complete = within(flow).getByRole("button", { name: "검토 완료" });
    expect(complete.hasAttribute("disabled")).toBe(true);
    const hint = document.getElementById(
      complete.getAttribute("aria-describedby")!,
    );
    expect(hint?.textContent).toMatch(/필수 섹션 2개 중 1개/);
    // The accepted section only offers further change requests.
    expect(
      screen.getAllByRole("button", { name: "이 섹션 채택" }),
    ).toHaveLength(1);
  });

  it("records approval through a dialog that names the custody check", async () => {
    const call = mockReport(version("REVIEW_COMPLETE"));
    const flow = await openReport();
    fireEvent.click(
      within(flow).getByRole("button", { name: "보관이력 포함 승인" }),
    );
    const dialog = screen.getByRole("dialog", { name: "보관이력 포함 승인" });
    expect(dialog.textContent).toMatch(/보관 이력 검증에 실패하면/);
    fireEvent.change(within(dialog).getByLabelText("검토·결정 사유"), {
      target: { value: "Custody verified" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "승인" }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        "reports.action",
        expect.objectContaining({ action: "approve" }),
      ),
    );
  });

  it("labels section change requests with the section title", async () => {
    mockReport(version("IN_REVIEW"));
    await openReport();
    fireEvent.click(screen.getAllByRole("button", { name: "수정 요청" })[1]);
    const dialog = screen.getByRole("dialog", {
      name: "섹션 수정 요청 · Findings",
    });
    expect(within(dialog).getByLabelText("요청할 수정 내용")).toBeTruthy();
  });

  it("offers export and revocation once approved", async () => {
    mockReport(version("REVIEW_COMPLETE"), "APPROVED");
    const flow = await openReport();
    expect(
      within(flow)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["승인 철회", "내보내기"]);
  });
});
