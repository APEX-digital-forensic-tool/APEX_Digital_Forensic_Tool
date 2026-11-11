import type { Row } from "./gateway";
import type { Messages } from "./i18n/catalog";

/** Review and approval actions accepted by `reports.action`. */
export type ReviewAction =
  | "submit"
  | "complete"
  | "approve"
  | "reject"
  | "reopen"
  | "revoke"
  | "accept_section"
  | "request_changes";

export type ReviewStage =
  | "DRAFT"
  | "IN_REVIEW"
  | "CHANGES_REQUESTED"
  | "REVIEW_COMPLETE"
  | "REJECTED"
  | "APPROVED"
  | "EXPORTED";

/** Draft → In review → Reviewed → Approved → Exported; labels are m.report.reviewSteps. */
export const REVIEW_STEP_COUNT = 5;

export interface ReviewFlow {
  stage: ReviewStage;
  /** Index into the review steps; REVIEW_STEP_COUNT means every step is done. */
  step: number;
  /** Replaces the current step's label when the stage is a detour. */
  stepLabel?: string;
  tone?: "warn" | "danger";
  primary: ReviewAction | "export";
  secondary: ReviewAction[];
  /** Why the primary action cannot run yet; shown instead of the hint. */
  blocked?: string;
  hint: string;
  /** Section accept / request-changes are meaningful only while reviewing. */
  sectionReview: boolean;
  required: number;
  accepted: number;
}

/** Copy for one review action; the catalog holds it as m.report.actions. */
export interface ActionCopy {
  label: string;
  title: string;
  submit: string;
  description: string;
  field?: string;
}

/** Mirrors the engine: sections are required unless coverage opts out. */
export function isRequiredSection(section: Row) {
  return section.coverage?.review_required !== false;
}

export function sectionStatus(version: Row, sectionId: string): string {
  return version.review_state?.section_status?.[sectionId] ?? "UNREVIEWED";
}

/**
 * Derives the one next step for a report version. The engine accepts some
 * transitions in any state (submit, reopen, reject); the UI only offers the
 * ones that move the workflow forward from where it is.
 */
export function reviewFlow({
  version,
  decision,
  exported = false,
  m,
}: {
  version: Row;
  decision: string | null | undefined;
  exported?: boolean;
  m: Messages;
}): ReviewFlow {
  const copy = m.report.flow;
  const sections: Row[] = version.sections ?? [];
  const requiredSections = sections.filter(isRequiredSection);
  const required = requiredSections.length;
  const accepted = requiredSections.filter(
    (s) => sectionStatus(version, s.section_id) === "ACCEPTED",
  ).length;
  const counts = { required, accepted };

  if (decision === "APPROVED") {
    return {
      ...counts,
      stage: exported ? "EXPORTED" : "APPROVED",
      step: exported ? REVIEW_STEP_COUNT : 3,
      primary: "export",
      secondary: ["revoke"],
      sectionReview: false,
      hint: exported ? copy.exported : copy.approved,
    };
  }
  if (decision === "REJECTED") {
    return {
      ...counts,
      stage: "REJECTED",
      step: 3,
      stepLabel: copy.rejectedLabel,
      tone: "danger",
      primary: "reopen",
      secondary: [],
      sectionReview: false,
      hint: copy.rejected,
    };
  }
  switch (version.review_state?.status ?? "DRAFT") {
    case "DRAFT":
      return {
        ...counts,
        stage: "DRAFT",
        step: 0,
        primary: "submit",
        secondary: [],
        sectionReview: false,
        hint: copy.draft,
      };
    case "CHANGES_REQUESTED":
      return {
        ...counts,
        stage: "CHANGES_REQUESTED",
        step: 1,
        stepLabel: copy.changesRequestedLabel,
        tone: "warn",
        primary: "reopen",
        secondary: [],
        sectionReview: true,
        hint: copy.changesRequested,
      };
    case "REVIEW_COMPLETE":
      return {
        ...counts,
        stage: "REVIEW_COMPLETE",
        step: 2,
        primary: "approve",
        secondary: ["reject", "reopen"],
        sectionReview: false,
        hint: decision === "REVOKED" ? copy.revoked : copy.reviewComplete,
      };
    default:
      return {
        ...counts,
        stage: "IN_REVIEW",
        step: 1,
        primary: "complete",
        secondary: [],
        sectionReview: true,
        blocked:
          accepted < required ? copy.blocked(required, accepted) : undefined,
        hint: required === 0 ? copy.noRequired : copy.allAccepted,
      };
  }
}
