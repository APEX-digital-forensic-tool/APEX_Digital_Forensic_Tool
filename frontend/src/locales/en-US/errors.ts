import type { Messages } from "../ko-KR";

export const errors: Messages["errors"] = {
  TASK_RECEIPT_NOT_SAVED:
    "The task result is kept, but its history could not be saved to disk. After you quit the app, the previous state may be shown. Check free space and permissions, then retry saving the record. The analysis will not run again.",
  AI_CONNECTION_INVALID:
    "Check the base URL, model name and API key. The base URL must start with https:// (except local addresses).",
  AI_KEY_STORAGE_UNAVAILABLE:
    "This computer cannot encrypt the key, so it is not stored in the app.",
  AI_CONNECTION_MANAGED:
    "Managed by the APEX_DESKTOP_AI_CONFIG environment variable. Change it in the runtime environment.",
  AI_CONFIGURATION_INVALID:
    "The AI connection settings are invalid. Check the AI connection in Settings or APEX_DESKTOP_AI_CONFIG in the runtime environment. Local analysis remains available.",
  VIDEO_LIMIT_EXCEEDED:
    "The video frame exceeds the resolution limit. Up to 33,177,600 pixels (8K UHD) is supported.",
  VIDEO_FRAME_FAILED:
    "The video frame could not be read. Check that the time is within the video's duration. The file may be damaged, use an unsupported codec, or exceed the decoding time or size limit.",
  STT_MODEL_INVALID:
    "The speech model setup is invalid. For Faster Whisper, select the whole folder containing model.bin, config.json, tokenizer.json and the vocabulary file. For whisper.cpp, select the model file.",
  STT_LANGUAGE_UNSUPPORTED:
    "This model is English-only. Select a multilingual model to recognize Korean speech.",
  MACHINE_SETTINGS_INVALID:
    "The saved analyzer settings could not be read, so OCR and STT did not run. In Settings, preserve the damaged settings and restore the defaults.",
  MACHINE_SETTINGS_MANAGED:
    "These analyzer settings are managed by an environment variable. Change APEX_DESKTOP_MACHINE_CONFIG in the runtime environment.",
  AI_TEXT_EXTRACTION_REQUIRED:
    "This file cannot be read as text. For images and audio, run OCR or STT, then request analysis from the extracted candidates.",
  ARCHIVE_REQUIRES_EXTRACTION:
    "This file is an archive. Keep the original, extract it into a separate folder, then import that folder with ‘Add folder’. File system analysis inside archives is not supported.",
  MEDIA_LIMIT_EXCEEDED:
    "The image exceeds the analysis limit. Up to 64 MiB and 25 million pixels are supported. Try again with a smaller preview size.",
  MEDIA_SOURCE_CHANGED:
    "The current media hash differs from the registered analysis result. Check the source, then analyze the media again.",
  MEDIA_SOURCE_UNAVAILABLE:
    "The media source cannot be read. Check the linked evidence and that the file is readable. Links and deleted files cannot be analyzed directly.",
  MEDIA_DECODE_FAILED:
    "The image could not be decoded. Check whether the file is damaged or in an unsupported image format.",
  MEDIA_FORMAT_UNSUPPORTED:
    "Select a PNG, JPEG, GIF, TIFF, BMP or WebP image file.",
  MEDIA_OFFSET_OUT_OF_RANGE: "The start pixel is outside the image.",
  DESKTOP_REQUIRED: "Analysis runs in the Windows or macOS desktop app.",
  SERVICE_NOT_READY: "Starting the local analysis engine.",
  PYTHON_RUNTIME_MISSING:
    "The analysis runtime is missing. Check the development environment or the installer.",
  BACKEND_START_FAILED: "The local analysis engine could not start.",
  BACKEND_STOPPED: "The analysis engine has stopped. Restart the app.",
  DESKTOP_CONNECTION_FAILED:
    "Cannot connect to the analysis engine. Check the task status, then try again.",
  CAPABILITY_UNAVAILABLE:
    "This feature is not available in the current environment. Check its support status in Settings.",
  VALIDATION_ERROR: "Check the input values and selected options.",
  CONTRACT_MISMATCH: "The engine response does not match the data contract.",
  CONTEXT_REVISION_CONFLICT:
    "The selection was changed by another task. Check the latest state, then apply again.",
  CONTEXT_EXPIRED: "The analysis session expired. Creating a new session.",
  CONTEXT_SCOPE_MISMATCH:
    "The selected item does not belong to the current case or evidence.",
  REPORT_NOT_APPROVED: "The report can be exported after it is approved.",
  REPORT_REVIEW_REVISION_CONFLICT:
    "The review state changed. Your content was kept and the latest state was loaded.",
  REPORT_REVIEW_REQUIRED:
    "Accept every required section to complete the review. Check the sections that are not accepted.",
  REPORT_REVIEW_TRANSITION_INVALID:
    "This action is not available at the current review stage. Check the next step in the latest state.",
  REPORT_APPROVAL_REVIEW_INCOMPLETE:
    "Approval requires a completed review and a verified chain of custody. Check that the evidence's custody history is not empty or broken.",
  REPORT_APPROVAL_TRANSITION_INVALID:
    "The approval state changed, or this action is not allowed at this stage. Check the latest state.",
  REPORT_APPROVAL_FINGERPRINT_MISMATCH:
    "The report content changed after approval. Only a version that matches the approved content can be exported.",
  WORK_QUEUE_FULL:
    "The task queue is full. Try again after a running task finishes.",
  PROFILE_REVISION_CONFLICT:
    "The analysis settings changed, so this cannot resume. Start a new analysis.",
  KEYWORD_NOT_APPROVED: "Only keywords approved by the examiner can be run.",
  CUSTODY_CHAIN_CONFLICT:
    "The chain of custody changed. Check the latest history, then try again.",
  RESOURCE_LIMIT_EXCEEDED:
    "The scope to process exceeds the limit. Narrow the scope or reduce the number of results.",
  TIMEZONE_INVALID:
    "Unknown time zone name. Pick one from the list or enter an IANA name such as Asia/Seoul or UTC.",
  TIMEZONE_AMBIGUOUS:
    "The time zone of this time cannot be determined. Check the original time and its time zone information.",
  DEMO_READ_ONLY:
    "This preview shows mock data. Run real analysis in the desktop app.",
  DEMO_SEARCH_MODE_UNSUPPORTED:
    "Search on mock data supports TERM, PHRASE, PREFIX and EXACT. Regular expression search is available in the real desktop engine.",
  STATE_CONFLICT:
    "The request conflicts with the latest state. Refresh and check again.",
  RAW_READ_LIMIT_EXCEEDED:
    "The size limit for raw reads or analysis copies was exceeded. Narrow the range or check the file size limit for this feature.",
  RAW_SOURCE_CHANGED:
    "The source file changed after indexing or while being read. Verify evidence integrity and index again.",
  RAW_SOURCE_UNAVAILABLE:
    "The source file cannot be read. Check the evidence path and permissions.",
  RAW_RANGE_NOT_SATISFIABLE: "The range is outside the source data.",
  AUTH_LOGIN_FAILED: "Check the email, password, or tenant ID.",
  AUTH_ORIGIN_INVALID:
    "The authentication server address must be an HTTPS address or a local HTTP address.",
  AUTH_SERVER_UNAVAILABLE:
    "Cannot connect to the authentication server. Local analysis remains available.",
  PICKER_REFERENCE_REQUIRED: "Select the evidence file again.",
};
