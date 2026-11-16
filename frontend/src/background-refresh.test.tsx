// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { App } from "./App";
import { createDemoBridge } from "./demoBridge";
import type { Reply, Row } from "./gateway";
import core from "./__fixtures__/core.json";
import { koKR } from "./locales/ko-KR";

const conflict = koKR.errors.STATE_CONFLICT as string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  cleanup();
  delete window.apex;
});

type Hooks = {
  backgroundHashStatus?: () => string | null;
  tasksFail?: () => boolean;
  cancelFails?: boolean;
  pagedTimeline?: boolean;
};

function bridgeWith(hooks: Hooks) {
  const bridge = createDemoBridge();
  const original = bridge.invoke.bind(bridge);
  const cursors: unknown[] = [];
  bridge.invoke = async (op: string, payload: Row): Promise<Reply<unknown>> => {
    if (op === "tasks.list") {
      if (hooks.tasksFail?.())
        return {
          ok: false,
          error: { code: "STATE_CONFLICT" },
        } as Reply<unknown>;
      const reply = (await original(op, payload)) as { ok: true; data: Row[] };
      const status = hooks.backgroundHashStatus?.();
      if (reply.ok && status)
        reply.data = [
          ...reply.data,
          {
            task_id: "bg-1",
            case_id: payload.case_id,
            kind: "HASH",
            status,
            actions: status === "RUNNING" ? ["CANCEL"] : [],
            job: null,
            error: null,
          },
        ];
      return reply;
    }
    if (op === "tasks.cancel" && hooks.cancelFails)
      return { ok: false, error: { code: "STATE_CONFLICT" } } as Reply<unknown>;
    if (op === "timeline.list" && hooks.pagedTimeline) {
      cursors.push(payload.cursor);
      const reply = (await original(op, {
        ...payload,
        cursor: null,
        evidence_id: null,
      })) as { ok: true; data: Row };
      const second = payload.cursor === "c2";
      reply.data = {
        items: (reply.data.items as Row[]).slice(0, 1).map((e) => ({
          ...e,
          title: second ? "PAGE-TWO" : "PAGE-ONE",
        })),
        page: {
          has_more: !second,
          next_cursor: second ? null : "c2",
          returned: 1,
        },
      };
      return reply;
    }
    return original(op, payload);
  };
  return { bridge, cursors };
}

async function openCase(route?: "타임라인") {
  render(<App />);
  await screen.findByText("데모 · 합성 데이터");
  fireEvent.change(screen.getByLabelText("현재 사건"), {
    target: { value: core.cases[0].id },
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "파일 시스템" })).toBeTruthy(),
  );
  if (route) {
    fireEvent.click(screen.getByRole("button", { name: "분석" }));
    fireEvent.click(screen.getByRole("button", { name: route }));
  }
}

const table = () => document.querySelector("#main-workspace table");

it("keeps the page and selection when an unrelated job finishes (#55)", async () => {
  let status = "RUNNING";
  const { bridge, cursors } = bridgeWith({
    backgroundHashStatus: () => status,
    pagedTimeline: true,
  });
  window.apex = bridge;
  await openCase("타임라인");
  await screen.findByText("PAGE-ONE", {}, { timeout: 10000 });
  fireEvent.click(screen.getByRole("button", { name: "다음 결과" }));
  await screen.findByText("PAGE-TWO");
  fireEvent.click(screen.getAllByText("PAGE-TWO")[0]);
  await waitFor(() =>
    expect(screen.queryByText("항목을 선택해주세요")).toBeNull(),
  );
  const before = cursors.length;
  status = "SUCCEEDED";
  await waitFor(() => expect(cursors.length).toBeGreaterThan(before), {
    timeout: 5000,
  });
  expect(cursors.slice(before)).toEqual(["c2"]);
  await sleep(300);
  expect(screen.getAllByText("PAGE-TWO").length).toBeGreaterThan(0);
  expect(screen.queryByText("PAGE-ONE")).toBeNull();
  expect(screen.queryByText("항목을 선택해주세요")).toBeNull();
}, 20000);

it("switching evidence does not replay jobs that had already ended (#55)", async () => {
  const { bridge, cursors } = bridgeWith({
    backgroundHashStatus: () => "SUCCEEDED",
    pagedTimeline: true,
  });
  window.apex = bridge;
  await openCase("타임라인");
  await screen.findByText("PAGE-ONE", {}, { timeout: 10000 });
  await sleep(2000);
  const loads = cursors.length;
  const evidenceSelect = screen.getByLabelText<HTMLSelectElement>("현재 증거");
  const usb = [...evidenceSelect.options].find(
    (o) => o.text === "외장 USB · 합성 폴더",
  )!;
  fireEvent.change(evidenceSelect, { target: { value: usb.value } });
  await sleep(3500);
  expect(cursors.length - loads).toBe(1);
}, 20000);

it("keeps the table through a failed poll and clears the warning after a good one (#56)", async () => {
  let fail = false;
  const { bridge } = bridgeWith({
    tasksFail: () => {
      const now = fail;
      fail = false;
      return now;
    },
  });
  window.apex = bridge;
  await openCase();
  await waitFor(() => expect(table()).not.toBeNull(), { timeout: 10000 });
  fail = true;
  await screen.findByText(conflict, {}, { timeout: 4000 });
  expect(table()).not.toBeNull();
  await waitFor(() => expect(screen.queryByText(conflict)).toBeNull(), {
    timeout: 4000,
  });
  expect(table()).not.toBeNull();
}, 20000);

it("shows a failed action on every screen until dismissed, without hiding the list (#57)", async () => {
  const { bridge } = bridgeWith({
    backgroundHashStatus: () => "RUNNING",
    cancelFails: true,
  });
  window.apex = bridge;
  await openCase();
  await waitFor(() => expect(table()).not.toBeNull(), { timeout: 10000 });
  fireEvent.click(screen.getByRole("button", { name: /^작업 \d+$/ }));
  fireEvent.click(await screen.findByRole("button", { name: "작업 취소" }));
  await screen.findByText(conflict);
  expect(table()).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "사건" }));
  fireEvent.click(screen.getByRole("button", { name: "사건 개요" }));
  expect(screen.getByText(conflict)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "알림 닫기" }));
  expect(screen.queryByText(conflict)).toBeNull();
}, 20000);
