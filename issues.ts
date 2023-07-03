import { colors } from "./deps.ts";
import { Issue } from "./types.ts";

const { red, cyan, dim, brightBlue, brightMagenta, yellow } = colors;

const LIST_BULLET = "—";

function makeIssueMessage(issue: Issue) {
  switch (issue.type) {
    case "unknown_link_format":
      return `The link ${cyan(issue.reference)} seems to be a unknown type of link.\n` +
        yellow("Please open an issue about this here: https://github.com/grammyjs/link-checker/issues/new.");
    case "empty_dom":
      return `The document at ${cyan(issue.reference)} can't seem to be properly parsed.`;
    case "not_ok_response":
      return `The link at ${cyan(issue.reference)} responded with a not OK status code ${red(`${issue.status}`)}.` +
        (issue.statusText ? ` It says "${issue.statusText}"` : "");
    case "wrong_extension":
      return `${cyan(issue.reference)} is ending with the extension ${yellow(issue.actual)} instead of ${
        yellow(issue.expected)
      }.`;
    case "linked_file_not_found":
      return `The linked file ${brightMagenta(issue.filepath)} does not exist.`;
    case "redirected":
      return `The link ${cyan(issue.from)} was redirected to ${cyan(issue.to)}.`;
    case "missing_anchor":
      return `The webpage at ${cyan(issue.reference)} doesn't seem to be have the anchor ${brightBlue(issue.anchor)}`;
    case "empty_anchor":
      return `The page ${cyan(issue.reference)} seems to be linked with an empty anchor.`;
    case "no_response":
      return `There was no response from ${cyan(issue.reference)}.`;
    default:
      throw new Error("Invalid type of issue! This shouldn't be happening.");
  }
}

export function generateIssueList(issues: Issue[]) {
  return issues.map((issue) => dim(LIST_BULLET) + " " + makeIssueMessage(issue)).join("\n");
}
