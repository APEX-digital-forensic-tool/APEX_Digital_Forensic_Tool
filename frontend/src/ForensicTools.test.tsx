// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ForensicTools } from "./ForensicTools";
import { AiAssistant } from "./AiAssistant";
import { gateway } from "./gateway";
import ntfsFile from "./__fixtures__/ntfs-file.json";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("does not carry a carving resume offset into another evidence", () => {
  const onTask = vi.fn();
  const view = render(
    <ForensicTools
      caseId="case"
      evidenceId="one"
      selected={null}
      onTask={onTask}
    />,
  );
  fireEvent.click(screen.getByText("복구·카빙·OCR·ADS"));
  fireEvent.click(screen.getByText("파일 시그니처 카빙"));
  fireEvent.change(screen.getByLabelText("탐색 시작 오프셋"), {
    target: { value: "268435440" },
  });
  view.rerender(
    <ForensicTools
      caseId="case"
      evidenceId="two"
      selected={null}
      onTask={onTask}
    />,
  );
  fireEvent.click(screen.getByText("복구·카빙·OCR·ADS"));
  expect(
    (screen.getByLabelText("탐색 시작 오프셋") as HTMLInputElement).value,
  ).toBe("0");
  for (const value of ["", "1048577", "1.5"]) {
    fireEvent.change(screen.getByLabelText("한 작업의 탐색량 (MiB)"), {
      target: { value },
    });
    expect(screen.getByText("카빙 시작").hasAttribute("disabled")).toBe(true);
  }
});

it("enables ADS lookup for the real serialized NTFS file DTO only", () => {
  expect((ntfsFile as Record<string, unknown>).provider_id).toBeUndefined();
  const view = render(
    <ForensicTools
      caseId={ntfsFile.case_id}
      evidenceId={ntfsFile.evidence_id}
      onTask={vi.fn()}
      selected={ntfsFile}
    />,
  );
  fireEvent.click(screen.getByText("복구·카빙·OCR·ADS"));
  fireEvent.click(screen.getByText("NTFS 데이터 스트림 (ADS)"));
  expect(screen.getByText("데이터 스트림 조회").hasAttribute("disabled")).toBe(
    false,
  );
  for (const selected of [
    { ...ntfsFile, id: "dir", node_type: "DIRECTORY" },
    { ...ntfsFile, id: "deleted", is_deleted: true },
    {
      ...ntfsFile,
      id: "logical",
      filesystem_provider: { id: "apex.logical_directory_provider" },
    },
  ]) {
    view.rerender(
      <ForensicTools
        caseId={ntfsFile.case_id}
        evidenceId={ntfsFile.evidence_id}
        onTask={vi.fn()}
        selected={selected}
      />,
    );
    fireEvent.click(screen.getByText("복구·카빙·OCR·ADS"));
    expect(
      screen.getByText("데이터 스트림 조회").hasAttribute("disabled"),
    ).toBe(true);
  }
});

it("keeps stream selection and offset fixed until the requested read completes", async () => {
  let finish!: (value: any) => void;
  vi.spyOn(gateway, "call").mockImplementation(async (op) =>
    op === "files.streams"
      ? { streams: [{ id: 2, name: "hidden", size: 20 }] }
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  render(
    <ForensicTools
      caseId="case"
      evidenceId="evidence"
      onTask={vi.fn()}
      selected={{ ...ntfsFile, id: "node" }}
    />,
  );
  fireEvent.click(screen.getByText("복구·카빙·OCR·ADS"));
  fireEvent.click(screen.getByText("NTFS 데이터 스트림 (ADS)"));
  fireEvent.click(screen.getByText("데이터 스트림 조회"));
  await screen.findByRole("option", { name: "hidden · 20 bytes" });
  fireEvent.click(screen.getByText("스트림 읽기"));
  expect(screen.getByLabelText("데이터 스트림").hasAttribute("disabled")).toBe(
    true,
  );
  expect(screen.getByLabelText("스트림 오프셋").hasAttribute("disabled")).toBe(
    true,
  );
  await act(async () => finish({ text_preview: "selected stream bytes" }));
  expect(screen.getByLabelText("데이터 스트림").hasAttribute("disabled")).toBe(
    false,
  );
  fireEvent.change(screen.getByLabelText("스트림 오프셋"), {
    target: { value: " " },
  });
  expect(screen.getByText("스트림 읽기").hasAttribute("disabled")).toBe(true);
});

it("sends the selected ADS id and offset and registers export tasks", async () => {
  const call = vi.spyOn(gateway, "call").mockImplementation(async (op) =>
    op === "files.streams"
      ? {
          streams: [
            { id: 2, name: "", size: 10 },
            { id: 4, name: "hidden", size: 26 },
          ],
        }
      : op === "streams.read"
        ? { text_preview: "known stream" }
        : { task_id: "export-task" },
  );
  const onTask = vi.fn();
  render(
    <ForensicTools
      caseId="case"
      evidenceId="evidence"
      onTask={onTask}
      selected={{ ...ntfsFile, id: "node" }}
    />,
  );
  fireEvent.click(screen.getByText("복구·카빙·OCR·ADS"));
  fireEvent.click(screen.getByText("NTFS 데이터 스트림 (ADS)"));
  fireEvent.click(screen.getByText("데이터 스트림 조회"));
  await screen.findByRole("option", { name: "hidden · 26 bytes" });
  fireEvent.change(screen.getByLabelText("데이터 스트림"), {
    target: { value: "4" },
  });
  fireEvent.change(screen.getByLabelText("스트림 오프셋"), {
    target: { value: "7" },
  });
  fireEvent.click(screen.getByText("스트림 읽기"));
  await waitFor(() =>
    expect(call).toHaveBeenCalledWith("streams.read", {
      case_id: "case",
      node_id: "node",
      stream_id: 4,
      offset: 7,
    }),
  );
  await waitFor(() =>
    expect(screen.getByText("스트림 내보내기").hasAttribute("disabled")).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByText("스트림 내보내기"));
  await waitFor(() => expect(onTask).toHaveBeenCalledOnce());
});

it("requires explicit review and clears it after selection changes", async () => {
  const fingerprint = "a".repeat(64);
  const call = vi.spyOn(gateway, "call").mockResolvedValue({
    status: "REVIEW_REQUIRED",
    preview: {
      fingerprint,
      payload: { text: "review this excerpt" },
      notice: "review notice",
    },
  });
  const view = render(
    <AiAssistant
      caseId="case"
      selected={{ type: "FILE_SYSTEM_NODE", id: "one" }}
    />,
  );
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "CONTENT" },
  });
  expect(screen.getByText("현재 선택 분석 요청").hasAttribute("disabled")).toBe(
    true,
  );
  fireEvent.click(screen.getByText("전송할 발췌문 준비"));
  fireEvent.click(await screen.findByText("전송할 발췌문"));
  await screen.findByText("review this excerpt");
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByText("현재 선택 분석 요청"));
  await waitFor(() =>
    expect(call).toHaveBeenCalledWith("ai.analyze", {
      case_id: "case",
      resource_type: "FILE_SYSTEM_NODE",
      resource_id: "one",
      mode: "CONTENT",
      reviewed_fingerprint: fingerprint,
    }),
  );
  view.rerender(
    <AiAssistant
      caseId="case"
      selected={{ type: "FILE_SYSTEM_NODE", id: "two" }}
    />,
  );
  expect(screen.queryByText("review this excerpt")).toBeNull();
  expect(screen.getByText("현재 선택 분석 요청").hasAttribute("disabled")).toBe(
    true,
  );
});

const open = (props: Record<string, unknown>) => {
  render(
    <ForensicTools
      caseId="case"
      evidenceId="ev"
      selected={null}
      onTask={vi.fn()}
      {...props}
    />,
  );
  fireEvent.click(screen.getByText("복구·카빙·OCR·ADS"));
  for (const title of [
    "파일 시그니처 카빙",
    "OCR·음성 인식",
    "NTFS 데이터 스트림 (ADS)",
  ])
    fireEvent.click(screen.getByText(title));
};
const textFile = {
  id: "n1",
  node_type: "FILE",
  extension: "txt",
  mime_candidate: "text/plain",
  original_name: "note.txt",
  filesystem_provider: { id: "apex.pytsk_filesystem_provider" },
};

it("disables carving for folder evidence and says why", () => {
  open({ evidenceFormat: "DIRECTORY" });
  expect((screen.getByText("카빙 시작") as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(
    screen.getByText(/폴더 증거에는 카빙을 사용할 수 없습니다/),
  ).toBeTruthy();
});

it("keeps carving available for disk images", () => {
  open({ evidenceFormat: "IMG" });
  expect((screen.getByText("카빙 시작") as HTMLButtonElement).disabled).toBe(
    false,
  );
});

it("lets OCR run on a non-image name but warns, and limits STT to media", () => {
  open({ selected: textFile });
  expect(
    (screen.getByText("선택 파일 문자 추출") as HTMLButtonElement).disabled,
  ).toBe(false);
  expect(screen.getByText(/파일 이름이 이미지가 아닙니다/)).toBeTruthy();
  expect(
    (screen.getByText("선택 파일 음성 인식") as HTMLButtonElement).disabled,
  ).toBe(true);
  cleanup();
  open({
    selected: { ...textFile, extension: "PNG", mime_candidate: "image/png" },
  });
  expect(screen.queryByText(/파일 이름이 이미지가 아닙니다/)).toBeNull();
  expect(screen.queryByText(/음성 또는 영상 파일/)).toBeTruthy();
});

it("shows plain 'no streams' when the filesystem is unknown", async () => {
  vi.spyOn(gateway, "call").mockResolvedValue({
    streams: [],
    ads_supported: null,
    filesystem_type: null,
  });
  open({ selected: textFile });
  fireEvent.click(screen.getByText("데이터 스트림 조회"));
  expect(
    await screen.findByText("대체 데이터 스트림이 없습니다."),
  ).toBeTruthy();
  expect(screen.queryByText(/해당 없음/)).toBeNull();
});

it("explains that ADS exist only on NTFS when a FAT file has none", async () => {
  vi.spyOn(gateway, "call").mockResolvedValue({
    streams: [],
    ads_supported: false,
    filesystem_type: "FAT32",
  });
  open({ selected: textFile });
  fireEvent.click(screen.getByText("데이터 스트림 조회"));
  expect(
    await screen.findByText(/FAT32 파일 시스템에는 대체 데이터 스트림/),
  ).toBeTruthy();
});
