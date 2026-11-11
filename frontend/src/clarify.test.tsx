// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
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
import type { Reply, Row } from "./gateway";
import {
  DisplayZone,
  Fields,
  confidence,
  displayValue,
  evidenceFormat,
  timeWithZone,
  zoneLabel,
} from "./ui";
import core from "./__fixtures__/core.json";
import { koKR } from "./locales/ko-KR";

afterEach(() => {
  cleanup();
  delete window.apex;
});

describe("display formatting", () => {
  it("states the case offset next to single timestamps", () => {
    expect(timeWithZone("2026-09-14T00:00:00.000Z", "Asia/Seoul", koKR)).toBe(
      "2026-09-14 09:00:00 (UTC+9)",
    );
    expect(timeWithZone("2026-09-14 09:00:00", "Asia/Seoul", koKR)).toMatch(
      /시간대 미확정/,
    );
  });

  it("names a fixed offset in headers but the IANA zone when DST shifts it", () => {
    expect(zoneLabel("Asia/Seoul")).toBe("UTC+9");
    expect(zoneLabel("UTC")).toBe("UTC");
    expect(zoneLabel("Europe/Berlin")).toBe("Europe/Berlin");
  });

  it("translates engine values instead of printing them", () => {
    expect(displayValue("ACQUISITION", "Asia/Seoul", koKR)).toBe("획득");
    expect(displayValue(["프로젝트", "보고서"], "Asia/Seoul", koKR)).toBe(
      "프로젝트, 보고서",
    );
    expect(displayValue("2026-09-14T00:40:00.000Z", "Asia/Seoul", koKR)).toBe(
      "2026-09-14 09:40:00",
    );
    expect(displayValue(true, "Asia/Seoul", koKR)).toBe("예");
    expect(confidence(0.944, koKR)).toBe("94%");
    expect(confidence("HIGH", koKR)).toBe("높음");
  });

  it("keeps image format names as written", () => {
    expect(evidenceFormat("RAW", koKR)).toBe("RAW");
    expect(evidenceFormat("E01", koKR)).toBe("E01");
    expect(evidenceFormat("DIRECTORY", koKR)).toBe("폴더");
  });

  it("formats timestamps inside detail fields with the case offset", () => {
    render(
      <DisplayZone.Provider value="Asia/Seoul">
        <Fields
          value={{
            occurred_at_utc: "2026-09-14T01:20:00Z",
            created_by: "분석가 A",
          }}
        />
      </DisplayZone.Provider>,
    );
    expect(screen.getByText("발생 시각")).toBeTruthy();
    expect(screen.getByText("2026-09-14 10:20:00 (UTC+9)")).toBeTruthy();
    expect(screen.getByText("작성자")).toBeTruthy();
  });
});

function recording() {
  const bridge = createDemoBridge();
  const original = bridge.invoke.bind(bridge);
  const calls: [string, Row][] = [];
  bridge.invoke = async (op, payload) => {
    calls.push([op, payload]);
    if (op === "candidates.review" || op === "custody.add")
      return { ok: true, data: {} } as Reply<Row>;
    return original(op, payload);
  };
  window.apex = bridge;
  return calls;
}
async function openRoute(label: string) {
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
  const group = (
    {
      "증거 보관 이력": "사건",
      "통합 검색": "분석",
      "추출 후보 검토": "분석",
    } as Record<string, string>
  )[label];
  if (group) fireEvent.click(screen.getByRole("button", { name: group }));
  fireEvent.click(screen.getByRole("button", { name: label }));
}

describe("decision copy", () => {
  it("names a rejection and quotes the candidate before recording it", async () => {
    const calls = recording();
    await openRoute("추출 후보 검토");
    const table = await screen.findByRole("table");
    const text = "다음 주까지 수정본을 전달해 주세요.";
    fireEvent.click(await within(table).findByText(text));
    fireEvent.click(await screen.findByRole("button", { name: "반려" }));
    const dialog = screen.getByRole("dialog", { name: "후보 반려" });
    expect(within(dialog).getByText(text)).toBeTruthy();
    expect(dialog.textContent).toMatch(/회의실_화이트보드\.jpg/);
    fireEvent.change(within(dialog).getByLabelText("반려 사유"), {
      target: { value: "원본 이미지와 문구가 다름" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "반려 기록" }));
    await waitFor(() =>
      expect(
        calls.find(([op]) => op === "candidates.review")?.[1],
      ).toMatchObject({
        review_status: "REJECTED",
        reason: "원본 이미지와 문구가 다름",
      }),
    );
  });

  it("shows candidate sources as paths, not node IDs", async () => {
    recording();
    await openRoute("추출 후보 검토");
    const table = await screen.findByRole("table");
    expect(within(table).getAllByText(/\/회의실_화이트보드\.jpg$/).length).toBe(
      4,
    );
    expect(within(table).queryByText(/^0{8}-/)).toBeNull();
  });

  it("makes the custody event type an explicit, translated choice", async () => {
    recording();
    await openRoute("증거 보관 이력");
    fireEvent.click(await screen.findByText("보관 이력 이벤트 추가"));
    const select = within(screen.getByRole("dialog")).getByLabelText(
      "이벤트 유형",
    ) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.required).toBe(true);
    const names = [...select.options].map((o) => o.textContent);
    expect(names).toContain("이관");
    // Custody wording, not the report/case status labels.
    expect(names).toContain("반출");
    expect(names).not.toContain("내보내기 완료");
    expect([...select.options].map((o) => o.textContent)).not.toContain(
      "TRANSFERRED",
    );
  });
});
