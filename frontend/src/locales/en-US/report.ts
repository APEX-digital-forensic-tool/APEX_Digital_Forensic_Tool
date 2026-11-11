import type { Messages } from "../ko-KR";

export const report: Messages["report"] = {
  reviewSteps: ["Draft", "In review", "Reviewed", "Approved", "Exported"],
  actions: {
    submit: {
      label: "Submit for review",
      title: "Submit for review",
      submit: "Submit",
      description:
        "Moves this version to review. The reason is kept in the review history.",
    },
    complete: {
      label: "Complete review",
      title: "Complete review",
      submit: "Record completion",
      description:
        "Finishes the review once the required sections are accepted. Approval or rejection is decided next.",
    },
    approve: {
      label: "Approve with custody check",
      title: "Approve with custody check",
      submit: "Approve",
      description:
        "Approves this version together with a snapshot that verifies the chain of custody. If custody verification fails, the version is not approved.",
    },
    reject: {
      label: "Reject",
      title: "Reject report",
      submit: "Reject",
      description:
        "Does not approve this version. After rejection, write a new version or reopen the review.",
    },
    reopen: {
      label: "Reopen review",
      title: "Reopen review",
      submit: "Reopen",
      description:
        "Continues the review. Existing section acceptance records are kept.",
    },
    revoke: {
      label: "Revoke approval",
      title: "Revoke approval",
      submit: "Revoke",
      description:
        "After revocation this version cannot be exported. The earlier approval stays in the history.",
    },
    accept_section: {
      label: "Accept this section",
      title: "Accept section",
      submit: "Accept",
      description:
        "Records that you checked this section's content and citations.",
    },
    request_changes: {
      label: "Request changes",
      title: "Request section changes",
      submit: "Request",
      field: "Changes to request",
      description:
        "The request is kept in the review history and the report moves to Changes requested.",
    },
    export: {
      label: "Export",
      title: "Export report",
      submit: "Export",
      description: "",
    },
  },
  flow: {
    exported:
      "The export is complete. You can export the same approved content again.",
    approved:
      "The content is fixed as it was at approval. To change it, revoke the approval and reopen the review.",
    rejectedLabel: "Rejected",
    rejected:
      "This version was rejected. Write a new version or reopen the review.",
    draft: "This is a draft. Submit it for review to start accepting sections.",
    changesRequestedLabel: "Changes requested",
    changesRequested:
      "Changes were requested. Write a new version, or reopen the review on this version.",
    revoked: "The approval was revoked. Approve again or reopen the review.",
    reviewComplete:
      "The review is complete. Approving records a snapshot that verifies the chain of custody and unlocks export.",
    blocked: (required: number, accepted: number) =>
      `${accepted} of ${required} required sections are accepted. Accept all of them to complete the review.`,
    noRequired:
      "There are no required sections to accept. Complete the review.",
    allAccepted: "All required sections are accepted. Complete the review.",
  },
  bar: {
    label: "Review progress",
    older: (latest: number) =>
      `You are viewing an earlier version. The latest is version ${latest}.`,
  },
  list: {
    heading: "Reports",
    create: "Create report",
    more: "Load more reports",
    selectTitle: "Select a report",
    selectBody: "Review the examiner's draft, approve it, then export it.",
    newVersion: "Write new version",
    versionLabel: "Report version",
    versionOption: (version: number, kind: string) =>
      `Version ${version} · ${kind}`,
    optionalReview: "Optional review",
    citations: "Citations",
    limitations: "Limitations and provenance",
    history: "Review history",
  },
  export: {
    resultTitle: "Export result",
    closeResult: "Close export result",
    openFolder: "Open results folder",
    title: "Export approved report",
    description:
      "Saved in the case's derived results folder. Existing files are not overwritten.",
    format: "File format",
    filename: "File name (with extension)",
    staleConfirm:
      "I confirm the sources are not up to date and export this approved version.",
    done: "The report file was created. Find it in the results folder.",
    check: "Check the report export status.",
  },
  create: {
    titleField: "Report title",
  },
  review: {
    reason: "Reason for the review decision",
    sectionTitle: (action: string, section: string) => `${action} · ${section}`,
  },
  compare: {
    label: "Report version comparison",
    title: "Compare versions",
    base: "Base version",
    other: "Compared version",
    same: "Both versions are identical.",
    diff: (added: number, removed: number) =>
      `${added} added or changed sections · ${removed} removed or changed sections`,
    baseColumn: "Base",
    otherColumn: "Compared",
    note: "A section is shown as different if its content, order or citations differ at all.",
  },
  history: {
    title: "Search history",
    none: "No searches have been run yet.",
    entry: (mode: string, count: string | number, time: string) =>
      ` · ${mode} · ${count} results · ${time}`,
    again: "Search again",
  },
  version: {
    defaultSectionTitle: "Key findings",
    noteSource: (kind: string) => `Source ${kind}`,
    noteFormat: (kind: string) => `Format ${kind}`,
    notePartial: "Partial analysis",
    noteStale: "Stale result warning",
    title: "Write new report version",
    body: "The original version is preserved. The new version needs review and approval again.",
    titleField: "Title",
    summary: "Summary",
    section: (index: number) => `Section ${index}`,
    sectionType: "Section type",
    sectionTypeLabel: (index: number) => `Section ${index} type`,
    sectionTitle: "Section title",
    sectionTitleLabel: (index: number) => `Section ${index} title`,
    content: "Content",
    contentLabel: (index: number) => `Section ${index} content`,
    citationsKept: (count: number) =>
      count === 1 ? "1 citation kept" : `${count} citations kept`,
    preserved: (notes: string) => `Preserved state: ${notes}`,
    up: "Move up",
    down: "Move down",
    removeSection: "Delete section",
    addSection: "Add section",
    limitations: "Limitations of the analysis (one per line)",
  },
};
