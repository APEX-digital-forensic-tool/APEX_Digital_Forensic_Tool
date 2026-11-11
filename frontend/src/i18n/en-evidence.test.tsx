// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderInEnglish } from "./testing";
import { enUS } from "../locales/en-US";
import { intakeDialog, integritySummary } from "../EvidenceIntake";
import { EvidenceTree } from "../workbench/EvidenceTree";
import { FileViewer } from "../workbench/FileViewer";
import { Properties } from "../workbench/Properties";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("renders the file viewer chrome in English", () => {
  renderInEnglish(
    <FileViewer
      caseId="case-1"
      selected={null}
      height={320}
      onHeight={vi.fn()}
      onCollect={vi.fn()}
      onSelect={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("region", { name: "File content viewer" }),
  ).toBeTruthy();
  expect(screen.getByText("Content viewer")).toBeTruthy();
  expect(screen.getByText("No file selected")).toBeTruthy();
  expect(screen.getByText("Read-only")).toBeTruthy();
});

it("renders empty properties and the empty tree in English", () => {
  renderInEnglish(
    <>
      <Properties row={null} zone="UTC" />
      <EvidenceTree
        caseId=""
        evidence={[]}
        evidenceId=""
        folderId=""
        selectedNode={null}
        trail={[]}
        revision={0}
        onOpen={vi.fn()}
        onEvidence={vi.fn()}
      />
    </>,
  );
  expect(
    screen.getByText("Select evidence or a file to see its properties."),
  ).toBeTruthy();
  expect(screen.getByRole("tree", { name: "Evidence tree" })).toBeTruthy();
  expect(screen.getByText("Select a case to browse evidence.")).toBeTruthy();
});

it("confirms an evidence source in English and names the missing reader", () => {
  const spec = intakeDialog({
    picked: { reference: "ref", name: "disk.E01" },
    kind: "file",
    capabilities: [
      {
        id: "e01-libewf",
        status: "CAPABILITY_UNAVAILABLE",
        reason: "DEPENDENCY_NOT_INSTALLED",
      },
    ],
    register: async () => {},
    m: enUS,
  });
  expect(spec.title).toBe("Add image evidence");
  expect(spec.submitLabel).toBe("Add evidence");
  expect(spec.fields[1].optionLabel?.("SHA256")).toBe("SHA-256 (recommended)");
  renderInEnglish(<>{spec.context}</>);
  const warning = screen.getByRole("alert").textContent ?? "";
  expect(warning).toContain("Read E01 images");
  expect(warning).toContain("Required component not installed");
  expect(
    screen.getByText(/The engine confirms the format at registration\./),
  ).toBeTruthy();
});

it("describes hash state in English", () => {
  expect(integritySummary({ hashes: [], status: "HASHING" }, enUS).label).toBe(
    "Hashing",
  );
  expect(
    integritySummary({ hashes: [{ algorithm: "SHA256" }] }, enUS).label,
  ).toBe("SHA-256");
});
