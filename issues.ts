import { blue, cyan, dim, magenta, red, yellow } from "./deps/std/fmt.ts";

import { Issue } from "./types.ts";

const LIST_BULLET = "—";

export const ISSUE_TITLES: Record<Issue["type"], string> = {
  empty_dom: "Empty DOM contents",
  redirected: "Redirections",
  no_response: "Empty responses",
  empty_anchor: "Empty anchors",
  missing_anchor: "Missing anchors",
  not_ok_response: "Non-OK response",
  wrong_extension: "Wrong extension",
  disallow_extension: "Disallowed extension",
  unknown_link_format: "Unknown link type",
  linked_file_not_found: "Missing file",
};

const MAX_TITLE_LENGTH = Object.values(ISSUE_TITLES)
  .reduce((prevLength, title) => title.length > prevLength ? title.length : prevLength, 0) + 1;

export function makeIssueMessage(issue: Issue) {
  switch (issue.type) {
    case "unknown_link_format":
      return `The link ${cyan(decodeURI(issue.reference))} seems to be a unknown type of link.\n` +
        yellow("Please open an issue about this here: https://github.com/grammyjs/link-checker/issues/new.");
    case "empty_dom":
      return `The document at ${cyan(decodeURI(issue.reference))} can't seem to be properly parsed.`;
    case "not_ok_response":
      return `The link at ${cyan(issue.reference)} responded with a not OK status code ${red(`${issue.status}`)}.` +
        (issue.statusText ? ` It says "${issue.statusText}"` : "");
    case "wrong_extension":
      return `${cyan(decodeURI(issue.reference))} is ending with the extension ${yellow(issue.actual)} instead of ${
        yellow(issue.expected)
      }.`;
    case "linked_file_not_found":
      return `The linked file ${magenta(issue.filepath)} does not exist.`;
    case "redirected":
      return `The link ${cyan(decodeURI(issue.from))} was redirected to ${cyan(decodeURI(issue.to))}.`;
    case "missing_anchor":
      return `The webpage at ${cyan(decodeURI(issue.reference))} doesn't seem to be have the anchor ${
        blue(decodeURI(issue.anchor))
      }`;
    case "empty_anchor":
      return `The page ${cyan(decodeURI(issue.reference))} seems to be linked with an empty anchor.`;
    case "no_response":
      return `There was no response from ${cyan(decodeURI(issue.reference))}.`;
    case "disallow_extension":
      return `The ${yellow(issue.extension)} extension is disallowed at here: ${magenta(decodeURI(issue.reference))}.`;
    default:
      throw new Error("Invalid type of issue! This shouldn't be happening.");
  }
}

export function prettySummary(issues: Record<string, Issue[]>) {
  const counts: Record<Issue["type"], number> = {
    empty_dom: 0,
    redirected: 0,
    no_response: 0,
    empty_anchor: 0,
    missing_anchor: 0,
    not_ok_response: 0,
    wrong_extension: 0,
    disallow_extension: 0,
    unknown_link_format: 0,
    linked_file_not_found: 0,
  };

  for (const filepath in issues) {
    for (const issue of issues[filepath]) {
      counts[issue.type]++;
    }
  }

  const totalIssues = Object.values(counts).reduce((p, c) => p + c, 0);
  const maxCountLength = totalIssues.toString().length;

  let summary = "";
  for (const type_ in counts) {
    const type = type_ as Issue["type"];
    if (counts[type] === 0) continue;
    const title = ISSUE_TITLES[type].padStart(MAX_TITLE_LENGTH, " ");
    const count = counts[type].toString().padStart(maxCountLength, " ");
    summary += `│ ${title} │ ${count} │\n`;
  }

  const maxLineLength = summary.split("\n").reduce((p, c) => c.length > p ? c.length : p, 0);

  if (totalIssues > 0) {
    return {
      totalIssues,
      summary: `┌${"─".repeat(maxLineLength - maxCountLength - 5)}┬${"─".repeat(maxCountLength + 2)}┐\n` +
        `${summary}` +
        `├${"─".repeat(MAX_TITLE_LENGTH + 2)}┼${"─".repeat(maxCountLength + 2)}┤\n` +
        `│ ${"Total".padStart(MAX_TITLE_LENGTH, " ")} │ ${totalIssues} │\n` +
        `└${"─".repeat(MAX_TITLE_LENGTH + 2)}┴${"─".repeat(maxCountLength + 2)}┘`,
    };
  } else {
    return { totalIssues, summary: "" };
  }
}

export function generateIssueList(issues: Issue[]) {
  return issues.map((issue) => dim(LIST_BULLET) + " " + makeIssueMessage(issue)).join("\n");
}
