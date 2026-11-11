import type { ActionCopy, ReviewAction } from "../../reportWorkflow";

const reviewSteps: [string, string, string, string, string] = [
  "초안",
  "검토 중",
  "검토 완료",
  "승인",
  "내보냄",
];

const actions: Record<ReviewAction | "export", ActionCopy> = {
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

export const report = {
  reviewSteps,
  actions,
  flow: {
    exported:
      "내보내기를 완료했습니다. 같은 승인 내용으로 다시 내보낼 수 있습니다.",
    approved:
      "승인 시점의 내용으로 고정되었습니다. 내용을 고치려면 승인을 철회한 뒤 검토를 재개하세요.",
    rejectedLabel: "반려됨",
    rejected: "반려된 버전입니다. 새 버전을 작성하거나 검토를 재개하세요.",
    draft: "초안입니다. 검토를 제출하면 섹션별 채택을 시작할 수 있습니다.",
    changesRequestedLabel: "수정 요청",
    changesRequested:
      "수정이 요청되었습니다. 새 버전을 작성하거나, 이 버전에서 검토를 재개하세요.",
    revoked: "승인이 철회되었습니다. 다시 승인하거나 검토를 재개하세요.",
    reviewComplete:
      "검토가 완료되었습니다. 승인하면 증거 보관 이력을 검증한 스냅샷이 함께 기록되고 내보내기가 열립니다.",
    blocked: (required: number, accepted: number) =>
      `필수 섹션 ${required}개 중 ${accepted}개를 채택했습니다. 모두 채택하면 검토를 완료할 수 있습니다.`,
    noRequired: "채택할 필수 섹션이 없습니다. 검토를 완료하세요.",
    allAccepted: "필수 섹션을 모두 채택했습니다. 검토를 완료하세요.",
  },
  bar: {
    label: "검토 진행",
    older: (latest: number) =>
      `이전 버전을 보고 있습니다. 최신은 버전 ${latest}입니다.`,
  },
  list: {
    heading: "보고서",
    create: "보고서 만들기",
    more: "보고서 더 보기",
    selectTitle: "보고서를 선택하세요",
    selectBody: "분석자가 작성한 초안을 검토하고 승인한 후 내보내세요.",
    newVersion: "새 버전 작성",
    versionLabel: "보고서 버전",
    versionOption: (version: number, kind: string) =>
      `버전 ${version} · ${kind}`,
    optionalReview: "선택 검토",
    citations: "인용 근거",
    limitations: "한계 및 출처",
    history: "검토 이력",
  },
  export: {
    resultTitle: "내보내기 결과",
    closeResult: "내보내기 결과 닫기",
    openFolder: "결과 폴더 열기",
    title: "승인된 보고서 내보내기",
    description:
      "사건의 파생 결과 폴더에 저장됩니다. 기존 파일은 덮어쓰지 않습니다.",
    format: "파일 형식",
    filename: "파일 이름 (확장자 포함)",
    staleConfirm:
      "출처가 최신 상태가 아님을 확인했으며 이 승인 버전을 내보냅니다.",
    done: "보고서 파일을 생성했습니다. 결과 폴더에서 확인하세요.",
    check: "보고서 내보내기 상태를 확인해주세요.",
  },
  create: {
    titleField: "보고서 제목",
  },
  review: {
    reason: "검토·결정 사유",
    sectionTitle: (action: string, section: string) => `${action} · ${section}`,
  },
  compare: {
    label: "보고서 버전 비교",
    title: "버전 비교",
    base: "기준 버전",
    other: "비교 버전",
    same: "두 버전의 내용이 같습니다.",
    diff: (added: number, removed: number) =>
      `추가·변경된 섹션 ${added}개 · 제거·변경된 섹션 ${removed}개`,
    baseColumn: "기준",
    otherColumn: "비교",
    note: "섹션 내용·순서·인용이 하나라도 다르면 다른 섹션으로 표시됩니다.",
  },
  history: {
    title: "검색 이력",
    none: "아직 실행한 검색이 없습니다.",
    entry: (mode: string, count: string | number, time: string) =>
      ` · ${mode} · 결과 ${count}개 · ${time}`,
    again: "다시 검색",
  },
  version: {
    defaultSectionTitle: "주요 발견 사항",
    noteSource: (kind: string) => `출처 ${kind}`,
    noteFormat: (kind: string) => `형식 ${kind}`,
    notePartial: "부분 분석",
    noteStale: "오래된 결과 경고",
    title: "새 보고서 버전 작성",
    body: "원본 버전은 보존됩니다. 새 버전에는 다시 검토와 승인이 필요합니다.",
    titleField: "제목",
    summary: "요약",
    section: (index: number) => `섹션 ${index}`,
    sectionType: "섹션 유형",
    sectionTypeLabel: (index: number) => `섹션 ${index} 유형`,
    sectionTitle: "섹션 제목",
    sectionTitleLabel: (index: number) => `섹션 ${index} 제목`,
    content: "내용",
    contentLabel: (index: number) => `섹션 ${index} 내용`,
    citationsKept: (count: number) => `인용 ${count}개 유지`,
    preserved: (notes: string) => `유지되는 상태: ${notes}`,
    up: "위로",
    down: "아래로",
    removeSection: "섹션 삭제",
    addSection: "섹션 추가",
    limitations: "분석의 한계 (줄마다 하나)",
  },
};
