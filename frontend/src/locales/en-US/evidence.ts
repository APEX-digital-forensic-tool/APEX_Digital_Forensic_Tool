import type { Messages } from "../ko-KR";

export const evidence: Messages["evidence"] = {
  readers: {
    "e01-libewf": "Read E01 images",
    "vhd-libvhdi": "Read VHD images",
    "vhdx-qemu-img": "Read VHDX images",
    "raw-dd-img": "Read RAW/DD images",
    pytsk3: "Interpret disk image file systems",
    "filesystem-provider": "Read folders",
  },
  hashRecommended: (name: string) => `${name} (recommended)`,
  hashNone: "Do not compute now",
  hashing: "Hashing",
  hashPending: "Not hashed yet",
  subject: {
    folder: "Folder",
    imageWithExtension: (extension: string) =>
      `Image file · extension .${extension}`,
    image: "Image file",
    formatNote: "· The engine confirms the format at registration.",
    missing: (reader: string, id: string, reason: string) =>
      `The ${reader} component (${id}) is not available on this PC${reason}. Registration may fail, or files inside may not be readable.`,
  },
  dialog: {
    folderTitle: "Add folder evidence",
    imageTitle: "Add image evidence",
    description:
      "The source is opened read-only and is not modified. You can follow registration and hashing in the task list.",
    submit: "Add evidence",
    displayName: "Display name",
    hashAfter: "Integrity hash after registration",
  },
};
