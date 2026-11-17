// @vitest-environment jsdom
// Regression coverage for the Project 1 intake, cancellation and restart fixes.
import React from "react";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, expect, it } from "vitest";
import {
  cleanup,
  act,
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
  await waitFor(() =>
    expect(document.querySelector("#main-workspace table")).not.toBeNull(),
  );
}

it("editing a search mode does not execute the previously submitted query", async () => {
  const bridge = createDemoBridge();
  const original = bridge.invoke.bind(bridge);
  const searches: Row[] = [];
  bridge.invoke = async (operation, payload) => {
    if (operation === "search.query") searches.push(payload);
    return original(operation, payload);
  };
  window.apex = bridge;
  await openCase();
  fireEvent.click(screen.getByRole("button", { name: "검색", exact: true }));
  const input = await screen.findByLabelText("검색어");
  fireEvent.change(input, { target: { value: "README" } });
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(searches.length).toBe(1));
  fireEvent.change(input, { target: { value: "different draft" } });
  await act(async () => {
    fireEvent.change(screen.getByLabelText("검색 방식"), { target: { value: "PREFIX" } });
    await new Promise((done) => setTimeout(done, 100));
  });
  expect(searches.length).toBe(1);
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(searches.length).toBe(2));
  expect(searches[1]).toMatchObject({ query_text: "different draft", query_mode: "PREFIX" });
});

it("GUI-001: adding directory evidence must not request an unsupported default HASH", async () => {
  const bridge = createDemoBridge();
  const original = bridge.invoke.bind(bridge);
  const hashes: Row[] = [];
  let registered = false;
  let completionObserved = false;
  bridge.pick = async () => ({
    ok: true,
    data: { reference: "qa-directory", name: "synthetic-directory" },
  });
  bridge.invoke = async (op, p) => {
    if (op === "evidence.register") {
      registered = true;
      return {
        ok: true,
        data: { task_id: "qa-register-directory", status: "QUEUED" },
      };
    }
    if (op === "tasks.list" && registered) {
      completionObserved = true;
      return {
        ok: true,
        data: [
          {
            task_id: "qa-register-directory",
            case_id: p.case_id,
            kind: "REGISTER",
            status: "SUCCEEDED",
            result: { id: "qa-directory-evidence", format: "DIRECTORY" },
            actions: [],
          },
        ],
      };
    }
    if (op === "analysis.start") {
      if (p.kind === "HASH") hashes.push(p);
      return { ok: true, data: { task_id: "qa-hash", status: "QUEUED" } };
    }
    return original(op, p);
  };
  window.apex = bridge;
  await openCase();
  fireEvent.click(screen.getByRole("button", { name: "폴더 추가" }));
  const dialog = await screen.findByRole("dialog", { name: "폴더 증거 등록" });
  // Leave the form's actual default selected, as an ordinary user would.
  fireEvent.click(within(dialog).getByRole("button", { name: "증거 등록" }));
  await waitFor(() => expect(completionObserved).toBe(true), { timeout: 5000 });
  expect(hashes).toEqual([]);
});

it("GUI-002: reopening a partial folder after its analysis was CANCELLED must retry", async () => {
  const bridge = createDemoBridge();
  const original = bridge.invoke.bind(bridge);
  const starts: Row[] = [];
  let cancellationObserved = false;
  bridge.invoke = async (op, p) => {
    if (op === "analysis.start" && p.node_id) {
      starts.push(p);
      return {
        ok: true,
        data: { task_id: "qa-folder-analysis", status: "QUEUED" },
      };
    }
    if (op === "tasks.list" && starts.length) {
      cancellationObserved = true;
      return {
        ok: true,
        data: [
          {
            task_id: "qa-folder-analysis",
            case_id: p.case_id,
            kind: "FILES",
            status: "CANCELLED",
            actions: [],
          },
        ],
      };
    }
    const reply = await original(op, p);
    if (op === "files.list" && reply.ok && !p.parent_node_id?.startsWith("x")) {
      for (const n of reply.data.items)
        if (n.node_type === "DIRECTORY") n.is_partial = true;
    }
    return reply;
  };
  window.apex = bridge;
  await openCase();
  const folder = (
    await within(screen.getByRole("table")).findAllByText(
      (_, el) => el?.tagName === "SPAN" && !!el.closest("tr"),
    )
  ).find((el) => el.closest("tr")?.textContent?.includes("폴더"));
  expect(folder).toBeTruthy();
  const folderName = folder!.textContent!;
  fireEvent.doubleClick(folder!.closest("tr")!);
  await waitFor(() => expect(starts.length).toBe(1));
  const firstNode = starts[0].node_id;
  await waitFor(() => expect(cancellationObserved).toBe(true), {
    timeout: 5000,
  });
  fireEvent.click(screen.getByRole("button", { name: "상위 폴더로 이동" }));
  await waitFor(() =>
    expect(
      document.querySelector("#main-workspace table")?.textContent,
    ).toContain(folderName),
  );
  const again = within(screen.getByRole("table")).getByText(folderName);
  fireEvent.doubleClick(again.closest("tr")!);
  await waitFor(
    () => expect(starts.filter((s) => s.node_id === firstNode).length).toBe(2),
    { timeout: 1500 },
  );
});

it("GUI-003: restartEngine must report failure when the replacement engine cannot start", async () => {
  // Run the exact production function, supplying only its surrounding state.
  // No Electron process, UI automation, disk writes or real backend are involved.
  const source = readFileSync("electron/main.ts", "utf8");
  const begin = source.indexOf("async function restartEngine() {");
  const end = source.indexOf("// Serialized", begin);
  expect(begin).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(begin);
  const state: Record<string, any> = {
    quitting: false,
    backend: undefined,
    generation: 0,
    backendURL: "",
    backendError: "SERVICE_NOT_READY",
    stopChild: async () => true,
    Date,
    wait: async () => {
      throw new Error("terminal startup failure must not wait");
    },
  };
  state.startBackend = async () => {
    state.backendError = "BACKEND_START_FAILED";
  };
  const result = await runInNewContext(
    source.slice(begin, end) + "\nrestartEngine()",
    state,
  );
  expect(state.backendURL).toBe("");
  expect(state.backendError).toBe("BACKEND_START_FAILED");
  expect(result).toBe(false);
});
