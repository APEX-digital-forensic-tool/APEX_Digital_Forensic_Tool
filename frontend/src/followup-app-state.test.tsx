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
import type { Row } from "./gateway";
import core from "./__fixtures__/core.json";

afterEach(() => {
  cleanup();
  delete window.apex;
});

async function openCase() {
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
}

it("ignores a blank search submit", async () => {
  const bridge = createDemoBridge();
  const original = bridge.invoke.bind(bridge);
  const queries: Row[] = [];
  bridge.invoke = async (op, payload) => {
    if (op === "search.query") queries.push(payload);
    return original(op, payload);
  };
  window.apex = bridge;
  await openCase();
  fireEvent.click(screen.getByRole("button", { name: "분석" }));
  fireEvent.click(screen.getByRole("button", { name: "통합 검색" }));
  const input = screen.getByLabelText("검색어");
  fireEvent.change(input, { target: { value: "   " } });
  fireEvent.submit(input.closest("form")!);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(queries).toEqual([]);
});

it("allows a retry when a folder job start returns no task id", async () => {
  const bridge = createDemoBridge();
  const original = bridge.invoke.bind(bridge);
  const starts: Row[] = [];
  bridge.invoke = async (op, payload) => {
    if (op === "analysis.start") {
      starts.push(payload);
      return { ok: true, data: {} };
    }
    const reply = await original(op, payload);
    if (op === "files.list" && reply.ok && payload.parent_node_id)
      for (const node of reply.data.items)
        if (node.node_type === "DIRECTORY") node.is_partial = true;
    return reply;
  };
  window.apex = bridge;
  await openCase();
  fireEvent.click(screen.getByRole("button", { name: "파일 시스템" }));
  const row = async () =>
    (
      await within(await screen.findByRole("table")).findAllByText(
        (_, el) => el?.tagName === "SPAN" && !!el.closest("tr"),
      )
    )
      .find((el) => el.closest("tr")?.textContent?.includes("폴더"))!
      .closest("tr")!;
  fireEvent.doubleClick(await row());
  await waitFor(() => expect(starts.length).toBe(1));
  fireEvent.click(screen.getByRole("button", { name: "상위 폴더로 이동" }));
  fireEvent.doubleClick(await row());
  await waitFor(() => expect(starts.length).toBe(2), { timeout: 3000 });
});
