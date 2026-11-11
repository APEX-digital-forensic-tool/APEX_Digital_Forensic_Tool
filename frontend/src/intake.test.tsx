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
import type { Reply, Row } from "./gateway";
import { integritySummary, missingReaders } from "./EvidenceIntake";
import core from "./__fixtures__/core.json";
import { koKR } from "./locales/ko-KR";

afterEach(() => {
  cleanup();
  delete window.apex;
});

it("names the readers an image needs that this runtime lacks", () => {
  const caps = [
    { id: "e01-libewf", status: "CAPABILITY_UNAVAILABLE" },
    { id: "pytsk3", status: "AVAILABLE" },
  ];
  expect(missingReaders("file", "disk.E01", caps).map((c) => c.id)).toEqual([
    "e01-libewf",
  ]);
  expect(missingReaders("file", "notes.txt", caps)).toEqual([]);
});

it("surfaces a mismatch ahead of other hashes", () => {
  const h = integritySummary(
    {
      hashes: [
        {
          algorithm: "SHA256",
          digest_hex: "a".repeat(64),
          verification_status: "MATCH",
        },
        {
          algorithm: "MD5",
          digest_hex: "b".repeat(32),
          verification_status: "MISMATCH",
        },
      ],
    },
    koKR,
  );
  expect(h).toMatchObject({ label: "MD5", status: "MISMATCH" });
  expect(integritySummary({ hashes: [], status: "HASHING" }, koKR).label).toBe(
    "해시 계산 중",
  );
});

it("confirms the source, registers it, then starts the chosen hash", async () => {
  const bridge = createDemoBridge();
  const original = bridge.invoke.bind(bridge);
  const calls: [string, Row][] = [];
  let registered = false;
  bridge.invoke = async (op, payload) => {
    calls.push([op, payload]);
    if (op === "evidence.register") {
      registered = true;
      return { ok: true, data: { task_id: "t-register", status: "QUEUED" } };
    }
    if (op === "tasks.list" && registered)
      return {
        ok: true,
        data: [
          {
            task_id: "t-register",
            case_id: payload.case_id,
            kind: "REGISTER",
            status: "SUCCEEDED",
            result: { id: "ev-new" },
            actions: [],
          },
        ],
      };
    if (op === "analysis.start")
      return { ok: true, data: { task_id: "t-hash" } };
    return original(op, payload) as Promise<Reply<Row>>;
  };
  window.apex = bridge;
  render(<App />);
  await screen.findByText("데모 · 합성 데이터");
  fireEvent.change(screen.getByLabelText("현재 사건"), {
    target: { value: core.cases[0].id },
  });
  fireEvent.click(await screen.findByRole("button", { name: "이미지 추가" }));
  const dialog = await screen.findByRole("dialog", {
    name: "이미지 증거 등록",
  });
  expect(within(dialog).getByText("업무용PC_디스크.E01")).toBeTruthy();
  expect(dialog.textContent).toMatch(/형식은 등록할 때 엔진이 확인합니다/);
  expect(
    (within(dialog).getByLabelText("등록 후 무결성 해시") as HTMLSelectElement)
      .value,
  ).toBe("SHA256");
  fireEvent.change(within(dialog).getByLabelText("표시 이름"), {
    target: { value: "피의자 PC 디스크" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "증거 등록" }));
  await waitFor(() =>
    expect(calls.find(([op]) => op === "evidence.register")?.[1]).toMatchObject(
      {
        source_reference: "demo-pick",
        display_name: "피의자 PC 디스크",
      },
    ),
  );
  await waitFor(
    () =>
      expect(calls.find(([op]) => op === "analysis.start")?.[1]).toMatchObject({
        evidence_id: "ev-new",
        kind: "HASH",
        algorithm: "SHA256",
      }),
    { timeout: 5000 },
  );
});
