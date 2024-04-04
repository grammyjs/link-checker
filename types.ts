import type { MarkdownIt } from "./deps/markdown-it/mod.ts";

type MarkdownItToken = ReturnType<
  InstanceType<typeof MarkdownIt>["parse"]
>[number];

export const ISSUE_TYPES = [
  "unknown_link_format",
  "empty_dom",
  "empty_anchor",
  "no_response",
  "not_ok_response",
  "disallow_extension",
  "wrong_extension",
  "linked_file_not_found",
  "redirected",
  "missing_anchor",
  "local_alt_available",
] as const;

interface BaseIssue {
  type: typeof ISSUE_TYPES[number];
  reference: string;
}
interface UnknownLinkFormatIssue extends BaseIssue {
  type: "unknown_link_format";
}
interface EmptyDOMIssue extends BaseIssue {
  type: "empty_dom";
}
interface EmptyAnchorIssue extends BaseIssue {
  type: "empty_anchor";
}
interface NoResponseIssue extends BaseIssue {
  type: "no_response";
}
interface NotOKResponseIssue extends BaseIssue {
  type: "not_ok_response";
  status: number;
  statusText: string;
}
interface DisallowExtensionIssue extends BaseIssue {
  type: "disallow_extension";
  extension: "html" | "md";
}
interface WrongExtensionIssue extends BaseIssue {
  type: "wrong_extension";
  actual: string;
  expected: string;
}
interface LinkedFileNotFoundIssue {
  type: "linked_file_not_found";
  filepath: string;
  reference: string;
}
interface RedirectedIssue {
  type: "redirected";
  from: string;
  to: string;
}
interface MissingAnchorIssue extends BaseIssue {
  type: "missing_anchor";
  anchor: string;
  allAnchors: Set<string>;
}
interface PreferLocalLinkIssue extends BaseIssue {
  type: "local_alt_available";
  reference: string;
  reason: string;
}

type ExternalLinkIssue =
  | RedirectedIssue
  | NotOKResponseIssue
  | NoResponseIssue
  | MissingAnchorIssue
  | EmptyDOMIssue
  | PreferLocalLinkIssue;

type Issue =
  | ExternalLinkIssue
  | DisallowExtensionIssue
  | WrongExtensionIssue
  | LinkedFileNotFoundIssue
  | UnknownLinkFormatIssue
  | EmptyAnchorIssue;

interface ResponseInfo {
  response?: Response | null;
  redirected: boolean;
  redirectedUrl: string; // may become useful later.
}

export type { ExternalLinkIssue, Issue, MarkdownItToken, MissingAnchorIssue, ResponseInfo };
