import { ISSUE_TYPES } from "./constants.ts";
import type { MarkdownIt } from "./deps/markdown-it/mod.ts";

export type MarkdownItToken = ReturnType<
  InstanceType<typeof MarkdownIt>["parse"]
>[number];

export type FetchOptions = Parameters<typeof fetch>[1];

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
export interface MissingAnchorIssue extends BaseIssue {
  type: "missing_anchor";
  anchor: string;
  allAnchors: Set<string>;
}
interface PreferLocalLinkIssue extends BaseIssue {
  type: "local_alt_available";
  reference: string;
  reason: string;
}
interface InaccessibleLinkIssue extends BaseIssue {
  type: "inaccessible";
  reference: string;
  reason: string;
}

export type ExternalLinkIssue =
  | RedirectedIssue
  | NotOKResponseIssue
  | NoResponseIssue
  | MissingAnchorIssue
  | EmptyDOMIssue
  | PreferLocalLinkIssue
  | InaccessibleLinkIssue;

export type FixableIssue =
  | RedirectedIssue
  | EmptyAnchorIssue
  | MissingAnchorIssue
  | WrongExtensionIssue
  | DisallowExtensionIssue;

export type Issue =
  | ExternalLinkIssue
  | DisallowExtensionIssue
  | WrongExtensionIssue
  | LinkedFileNotFoundIssue
  | UnknownLinkFormatIssue
  | EmptyAnchorIssue;

export interface ResponseInfo {
  response?: Response | null;
  redirected: boolean;
  redirectedUrl: string; // may become useful later.
}

export interface Location {
  line: number;
  columns: number[];
}

export interface Stack {
  filepath: string;
  locations: Location[];
}

export type IssueWithStack = Issue & { stack: Stack[] };
