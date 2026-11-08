import type { Row } from "./gateway";

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

export const REVIEW_STEPS = [
  "초안",
  "검토 중",
  "검토 완료",
  "승인",
  "내보냄",
] as const;

export interface ReviewFlow {
  stage: ReviewStage;
  /** Index into REVIEW_STEPS; REVIEW_STEPS.length means every step is done. */
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

export const actionCopy: Record<
  ReviewAction | "export",
  {
    label: string;
    title: string;
    submit: string;
    description: string;
    field?: string;
  }
> = {
  submit: {
    label: "검토 제출",
    title: "검토 제출",
    submit: "제출",
    description: "이 버전을 검토 단계로 넘깁니다. 사유는 검토 이력에 남습니다.",
  },
  complete: {
    label: "검토 완료",
    title: "검토 완료",
    submit: "완료 기록",
    description:
      "필수 섹션 채택을 마치고 검토를 완료합니다. 이후 승인 또는 반려를 결정합니다.",
  },
  approve: {
    label: "보관이력 포함 승인",
    title: "보관이력 포함 승인",
    submit: "승인",
    description:
      "증거 보관 이력을 검증한 스냅샷과 함께 이 버전을 승인합니다. 보관 이력 검증에 실패하면 승인되지 않습니다.",
  },
  reject: {
    label: "반려",
    title: "보고서 반려",
    submit: "반려",
    description:
      "이 버전을 승인하지 않습니다. 반려 후에는 새 버전을 작성하거나 검토를 재개해야 합니다.",
  },
  reopen: {
    label: "검토 재개",
    title: "검토 재개",
    submit: "재개",
    description:
      "검토를 다시 진행합니다. 기존 섹션 채택 기록은 그대로 유지됩니다.",
  },
  revoke: {
    label: "승인 철회",
    title: "승인 철회",
    submit: "철회",
    description:
      "승인을 철회하면 이 버전을 내보낼 수 없습니다. 기존 승인 기록은 이력에 남습니다.",
  },
  accept_section: {
    label: "이 섹션 채택",
    title: "섹션 채택",
    submit: "채택",
    description: "이 섹션의 내용과 인용 근거를 확인했음을 기록합니다.",
  },
  request_changes: {
    label: "수정 요청",
    title: "섹션 수정 요청",
    submit: "요청",
    field: "요청할 수정 내용",
    description:
      "요청 내용은 검토 이력에 남고, 보고서는 수정 요청 상태가 됩니다.",
  },
  export: {
    label: "내보내기",
    title: "보고서 내보내기",
    submit: "내보내기",
    description: "",
  },
};

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
}: {
  version: Row;
  decision: string | null | undefined;
  exported?: boolean;
}): ReviewFlow {
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
      step: exported ? REVIEW_STEPS.length : 3,
      primary: "export",
      secondary: ["revoke"],
      sectionReview: false,
      hint: exported
        ? "내보내기를 완료했습니다. 같은 승인 내용으로 다시 내보낼 수 있습니다."
        : "승인 시점의 내용으로 고정되었습니다. 내용을 고치려면 승인을 철회한 뒤 검토를 재개하세요.",
    };
  }
  if (decision === "REJECTED") {
    return {
      ...counts,
      stage: "REJECTED",
      step: 3,
      stepLabel: "반려됨",
      tone: "danger",
      primary: "reopen",
      secondary: [],
      sectionReview: false,
      hint: "반려된 버전입니다. 새 버전을 작성하거나 검토를 재개하세요.",
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
        hint: "초안입니다. 검토를 제출하면 섹션별 채택을 시작할 수 있습니다.",
      };
    case "CHANGES_REQUESTED":
      return {
        ...counts,
        stage: "CHANGES_REQUESTED",
        step: 1,
        stepLabel: "수정 요청",
        tone: "warn",
        primary: "reopen",
        secondary: [],
        sectionReview: true,
        hint: "수정이 요청되었습니다. 새 버전을 작성하거나, 이 버전에서 검토를 재개하세요.",
      };
    case "REVIEW_COMPLETE":
      return {
        ...counts,
        stage: "REVIEW_COMPLETE",
        step: 2,
        primary: "approve",
        secondary: ["reject", "reopen"],
        sectionReview: false,
        hint:
          decision === "REVOKED"
            ? "승인이 철회되었습니다. 다시 승인하거나 검토를 재개하세요."
            : "검토가 완료되었습니다. 승인하면 증거 보관 이력을 검증한 스냅샷이 함께 기록되고 내보내기가 열립니다.",
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
          accepted < required
            ? `필수 섹션 ${required}개 중 ${accepted}개를 채택했습니다. 모두 채택하면 검토를 완료할 수 있습니다.`
            : undefined,
        hint:
          required === 0
            ? "채택할 필수 섹션이 없습니다. 검토를 완료하세요."
            : "필수 섹션을 모두 채택했습니다. 검토를 완료하세요.",
      };
  }
}
