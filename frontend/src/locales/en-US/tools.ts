import type { Messages } from "../ko-KR";

export const tools: Messages["tools"] = {
  forensic: {
    strip: "More analysis",
    open: "Recovery · Carving · OCR · ADS",
    openTitle:
      "Deleted file recovery, signature carving, OCR, alternate data streams (ADS)",
    title: "More forensic analysis",
    close: "Close more analysis",
    subject: (name: string) => `${name} · The source stays read-only.`,
    selectedEvidence: "Selected evidence",
    recover: {
      title: "Recover deleted files",
      body: "Creates a derived file from the recorded data locations. Recovery is not guaranteed for overwritten data or missing ranges.",
      action: "Recover the selected deleted file",
    },
    streams: {
      title: "NTFS data streams (ADS)",
      list: "List data streams",
      stream: "Stream",
      streamLabel: "Data stream",
      defaultStream: "Default stream",
      option: (name: string, size: number) => `${name} · ${size} bytes`,
      offset: "Stream offset",
      read: "Read stream",
      export: "Export stream",
    },
    machine: {
      title: "OCR and speech recognition",
      body: "Choose the local analyzer and model in Settings. Review the results on the machine-extracted candidates screen.",
      language: "Language",
      ocrEng: "English OCR",
      ocrKorEng: "Korean and English OCR",
      sttKo: "Korean speech",
      sttEn: "English speech",
      sttAuto: "Detect speech language",
      runOcr: "Extract text from the selected file",
      runStt: "Recognize speech in the selected file",
    },
    carve: {
      title: "File signature carving",
      body: "Finds contiguous bytes of PNG, JPEG, PDF, ZIP and GIF files. Results are review candidates whose original names are unknown.",
      scope: "Scan scope",
      unallocated: "Unallocated space",
      wholeImage: "Whole image",
      budget: "Scan size per task (MiB)",
      startOffset: "Scan start offset",
      start: "Start carving",
      resume:
        "When the limit is reached, you can continue from next_offset in the task result.",
    },
    taskRegistered: "The task was registered",
    result: "Analysis result",
    openFolder: "Open recovery and extraction results folder",
  },
  image: {
    open: "Image view · Bit analysis",
    intro:
      "Read-only derived analysis · Uses the stored pixels of the first frame. EXIF rotation is not applied.",
    display: {
      legend: "Image display",
      channel: "Display channel",
      bitPlane: "Bit plane",
      allValues: "All values",
      maxSize: "Max display size",
      show: "Show image",
      zoom: "Zoom",
    },
    resized: (width: number, height: number) =>
      ` · reduced preview ${width} × ${height}`,
    original: " · original resolution",
    alt: (detail: string) => `Evidence image · ${detail}`,
    sourceHash: (hash: string) => `Source SHA-256: ${hash}`,
    extract: {
      legend: "Pixel bit extraction",
      channelOrder: "Channel order",
      bit: "Bit to extract",
      byteOrder: "Byte assembly",
      msbFirst: "Most significant bit first (MSB)",
      lsbFirst: "Least significant bit first (LSB)",
      startPixel: "Start pixel",
      maxBytes: "Max bytes to extract",
      run: "Extract bits",
    },
    hint: "Specify channels from R, G, B and A without repeats. Pixels converted to 8-bit RGBA are read in row order from the top left. Extraction never uses the reduced preview.",
    result: {
      label: "Bit extraction result",
      title: "Extraction result",
      summary: (
        channels: string,
        bit: number,
        order: string,
        pixel: number,
        returned: number,
        available: number,
        tail: string,
      ) =>
        `${channels} · bit ${bit} · ${order} · start pixel ${pixel} · ${returned} / ${available} bytes${tail}`,
      msb: "MSB first",
      lsb: "LSB first",
      more: " · more data available",
      end: " · end",
      text: "Extracted text (UTF-8)",
      controlNote:
        "Control characters are shown as · and invalid UTF-8 as �. Check the exact bytes in the hex and the saved JSON.",
      hex: "Extracted hex",
      conditions: "Analysis conditions · Provenance · Hashes",
      saved: (path: string) =>
        `The analysis conditions, source hash and result were saved as JSON: ${path}`,
      openFolder: "Open results folder",
    },
  },
  video: {
    open: "Video frame viewer",
    intro:
      "Reads one frame from a local copy of the video. The source is not changed and nothing is sent externally.",
    limits:
      "Up to 512 MiB · 15-second decoding limit · up to 1536 px preview. The frame is the one decoded after the given time. The original frame number is not guaranteed.",
    seconds: "Requested time (seconds)",
    read: "Read frame",
    requested: (seconds: number) =>
      `Requested time: ${seconds} s · Derived analysis`,
    alt: "Video frame at the selected time",
    details: "Video information · Provenance · Hashes",
  },
};
