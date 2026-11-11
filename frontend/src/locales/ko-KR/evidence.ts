export const evidence = {
  /** Engine reader id → what the reader does. */
  readers: {
    "e01-libewf": "E01 이미지 읽기",
    "vhd-libvhdi": "VHD 이미지 읽기",
    "vhdx-qemu-img": "VHDX 이미지 읽기",
    "raw-dd-img": "RAW·DD 이미지 읽기",
    pytsk3: "디스크 이미지 파일시스템 해석",
    "filesystem-provider": "폴더 읽기",
  },
  hashRecommended: (name: string) => `${name} (권장)`,
  hashNone: "지금은 계산하지 않음",
  hashing: "해시 계산 중",
  hashPending: "해시 계산 전",
  subject: {
    folder: "폴더",
    imageWithExtension: (extension: string) =>
      `이미지 파일 · 확장자 .${extension}`,
    image: "이미지 파일",
    formatNote: "· 형식은 등록할 때 엔진이 확인합니다.",
    missing: (reader: string, id: string, reason: string) =>
      `이 PC에서는 ${reader} 구성요소(${id})를 사용할 수 없습니다${reason}. 등록이 실패하거나 내부 파일을 읽지 못할 수 있습니다.`,
  },
  dialog: {
    folderTitle: "폴더 증거 등록",
    imageTitle: "이미지 증거 등록",
    description:
      "원본은 읽기 전용으로 열리며 수정되지 않습니다. 등록과 해시 계산은 작업 목록에서 진행 상황을 볼 수 있습니다.",
    submit: "증거 등록",
    displayName: "표시 이름",
    hashAfter: "등록 후 무결성 해시",
  },
};
