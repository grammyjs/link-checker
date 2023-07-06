import type { MarkdownIt } from "./deps/markdown-it/mod.ts";

type MarkdownItToken = ReturnType<
  InstanceType<typeof MarkdownIt>["parse"]
>[number];

interface BaseIssue {
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
}
interface RedirectedIssue {
  type: "redirected";
  from: string;
  to: string;
}
interface MissingAnchorIssue extends BaseIssue {
  type: "missing_anchor";
  anchor: string;
}

type ExternalLinkIssue =
  | RedirectedIssue
  | NotOKResponseIssue
  | NoResponseIssue
  | EmptyDOMIssue;

type Issue =
  | ExternalLinkIssue
  | DisallowExtensionIssue
  | WrongExtensionIssue
  | LinkedFileNotFoundIssue
  | MissingAnchorIssue
  | UnknownLinkFormatIssue
  | EmptyAnchorIssue;

export type { ExternalLinkIssue, Issue, MarkdownItToken, MissingAnchorIssue };
