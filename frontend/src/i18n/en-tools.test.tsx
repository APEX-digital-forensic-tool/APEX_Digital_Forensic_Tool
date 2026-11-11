// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderInEnglish } from "./testing";
import { gateway } from "../gateway";
import { AiAssistant } from "../AiAssistant";
import { ForensicTools } from "../ForensicTools";
import { ImageInspector } from "../ImageInspector";
import { MachineSettings } from "../MachineSettings";
import { VideoInspector } from "../VideoInspector";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("shows the AI redaction notice in English even though the engine sends Korean", async () => {
  vi.spyOn(gateway, "call").mockResolvedValue({
    status: "REVIEW_REQUIRED",
    preview: {
      fingerprint: "a".repeat(64),
      payload: { text: "review this excerpt" },
      requires_review: true,
      notice:
        "자동 가림은 모든 비밀정보를 찾아내지 못합니다. 전송할 발췌문을 확인하세요.",
    },
  });
  renderInEnglish(
    <AiAssistant
      caseId="case"
      selected={{ type: "FILE_SYSTEM_NODE", id: "one" }}
    />,
  );
  expect(
    screen.getByRole("option", { name: "Structure summary" }),
  ).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "CONTENT" },
  });
  fireEvent.click(screen.getByText("Prepare excerpt to send"));
  fireEvent.click(await screen.findByText("Excerpt to send"));
  expect(
    await screen.findByText(
      "Automatic redaction cannot find every secret. Review the excerpt before sending.",
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/자동 가림/)).toBeNull();
});

it("names the bundled STT model in English", async () => {
  vi.spyOn(gateway, "call").mockResolvedValue({
    settings: {
      ocr_provider: "auto",
      stt_provider: "faster-whisper",
      stt_model_path: null,
    },
    stt: { is_available: true },
    ocr: { is_available: true },
    managed: false,
    bundled_stt: { available: true, name: "Whisper base · 다국어" },
  });
  renderInEnglish(<MachineSettings />);
  expect(
    await screen.findByText(
      /Whisper base · Multilingual \(incl\. Korean and English\)/,
    ),
  ).toBeTruthy();
  expect(screen.getByText("Use the bundled multilingual model")).toBeTruthy();
  expect(screen.queryByText(/다국어/)).toBeNull();
});

it("labels the analysis tools in English", () => {
  renderInEnglish(
    <>
      <ForensicTools
        caseId="case"
        evidenceId="one"
        selected={null}
        onTask={vi.fn()}
      />
      <ImageInspector
        caseId="case"
        resourceType="FILE_SYSTEM_NODE"
        resourceId="image"
      />
      <VideoInspector
        caseId="case"
        resourceType="FILE_SYSTEM_NODE"
        resourceId="video"
      />
    </>,
  );
  expect(screen.getByText("More analysis")).toBeTruthy();
  expect(screen.getByText("Recover deleted files")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Image view · Bit analysis" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Video frame viewer" }),
  ).toBeTruthy();
});
