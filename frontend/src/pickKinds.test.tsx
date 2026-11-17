// @vitest-environment jsdom
import React from "react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { App } from "./App";
import { MachineSettings } from "./MachineSettings";
import { createDemoBridge } from "./demoBridge";
import { gateway, type Reply } from "./gateway";
import { pickAllowed } from "./pickKinds";
import core from "./__fixtures__/core.json";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.apex;
});

/** A bridge whose pick answers like the shell: refused unless the shared table allows it. */
function shellPick() {
  const calls: string[] = [];
  const pick = vi.fn(
    async (kind: string, _locale: unknown, purpose: unknown) => {
      calls.push(`${String(purpose)}:${kind}`);
      return (
        pickAllowed(purpose, kind)
          ? { ok: true, data: null }
          : { ok: false, error: { code: "VALIDATION_ERROR" } }
      ) as Reply<null>;
    },
  );
  window.apex = { ...createDemoBridge(), pick: pick as never };
  return calls;
}

// Every renderer call of window.apex.pick is driven below; a new call site must be added here.
it("knows every renderer file that opens a native pick", () => {
  const dir = join(process.cwd(), "src");
  const callers = readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .filter((f) => readFileSync(join(dir, f), "utf8").includes("apex.pick("));
  expect(callers.sort()).toEqual(["App.tsx", "MachineSettings.tsx"]);
});

it("opens every machine-settings pick with a kind the shell accepts", async () => {
  vi.spyOn(gateway, "call").mockResolvedValue({
    settings: { ocr_provider: "auto", stt_provider: "faster-whisper" },
    stt: { is_available: true },
    ocr: { is_available: true },
    managed: false,
  });
  const calls = shellPick();
  render(<MachineSettings />);
  fireEvent.click(await screen.findByText("OCR 언어 모델 폴더 선택"));
  fireEvent.click(screen.getByText("음성 모델 선택"));
  fireEvent.change(screen.getByLabelText("음성 인식"), {
    target: { value: "whisper.cpp" },
  });
  fireEvent.click(screen.getByText("음성 모델 선택"));
  await waitFor(() => expect(calls).toHaveLength(3));
  expect(calls).toEqual([
    "tessdata:directory",
    "model:directory",
    "model:file",
  ]);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("opens both evidence picks with a kind the shell accepts", async () => {
  const calls = shellPick();
  render(<App />);
  await screen.findByText("데모 · 합성 데이터");
  fireEvent.change(screen.getByLabelText("현재 사건"), {
    target: { value: core.cases[0].id },
  });
  fireEvent.click(await screen.findByRole("button", { name: "이미지 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "폴더 추가" }));
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls).toEqual(["evidence:file", "evidence:directory"]);
  expect(screen.queryByRole("alert")).toBeNull();
});
