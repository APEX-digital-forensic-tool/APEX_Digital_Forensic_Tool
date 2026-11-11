import type { Messages } from "../ko-KR";

export const ai: Messages["ai"] = {
  intro:
    "Analysis runs after checking the selected material against the case policy. For content analysis, review the excerpt to be sent first.",
  mode: "Analysis mode",
  structure: "Structure summary",
  content: "Evidence content excerpt analysis",
  prepare: "Prepare excerpt to send",
  excerpt: "Excerpt to send",
  redactionNotice:
    "Automatic redaction cannot find every secret. Review the excerpt before sending.",
  truncated: "This excerpt contains only part of the content.",
  consent:
    "I reviewed the excerpt and agree to request analysis of this content.",
  request: "Request analysis of the current selection",
  configRequired:
    "The analysis request was saved. An AI provider connection needs to be set up.",
  policyDenied:
    "The case's AI data policy did not allow sending. Check the evaluation reason in Settings.",
  policyEvaluation: "Data policy evaluation",
  resultTitle: "AI analysis result",
  contentDisclaimer:
    "This is an AI interpretation of the excerpt you reviewed. It is not an analysis of the whole source, and its basis must be checked.",
  structureDisclaimer:
    "This is an AI summary of structural information. It is not an analysis of the source content or a verified observed fact.",
  sources: "Sources of the selected material",
  savedRequest: "Saved request",
};
