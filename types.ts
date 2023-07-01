import type { MarkdownIt } from "./deps.ts";

type MarkdownItToken = ReturnType<
  InstanceType<typeof MarkdownIt>["parse"]
>[number];

interface ParsedMarkdown {
  /** Available anchors in the document */
  anchors: Set<string>;
  /** Links used in the markdown document */
  links: Set<string>;
}

interface MarkdownFile {
  /** Available anchors in the document */
  anchors: {
    all: Set<string>;
    used: Set<string>;
  };
  /** Links used in the markdown document */
  links: {
    external: Set<string>;
    local: Set<string>;
  };
  /** Issues in the file */
  issues: Issue[];
}

interface CommonIssue {
  type: "unknown_link_format" | "empty_dom" | "empty_anchor" | "no_response";
  reference: string;
}

interface NotOKResponseIssue {
  type: "not_ok_response";
  reference: string;
  status: number;
  statusText: string;
}

interface WrongExtensionIssue {
  type: "wrong_extension";
  actual: string;
  expected: string;
  reference: string;
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

interface MissingAnchorIssue {
  type: "missing_anchor";
  reference: string;
  anchor: string;
}

interface UnknownSymbolIssue {
  type: "unknown_symbol";
  reference: string;
  symbol: string;
}

type Issue =
  | CommonIssue
  | NotOKResponseIssue
  | WrongExtensionIssue
  | LinkedFileNotFoundIssue
  | RedirectedIssue
  | MissingAnchorIssue
  | UnknownSymbolIssue;

export type { Issue, MarkdownFile, MarkdownItToken, MissingAnchorIssue, ParsedMarkdown, UnknownSymbolIssue };
