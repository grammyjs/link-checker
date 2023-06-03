interface GeneralIssue {
  type:
    | "htmlInsteadOfMd"
    | "fileNotFound"
    | "notOk"
    | "domParseFailure"
    | "unknownLinkType";
  reference: string;
}

interface RedirectedIssue {
  type: "redirected";
  from: string;
  to: string;
}

interface MissingAnchorIssue {
  type: "missingAnchor";
  root: string;
  anchor: string;
}

export type Issue = GeneralIssue | RedirectedIssue | MissingAnchorIssue;

export type FetchOptions = Parameters<typeof fetch>[1];
