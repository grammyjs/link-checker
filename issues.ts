import { yellow } from "./deps/std/fmt.ts";
import { equal } from "./deps/std/assert.ts";

import { findStringLocations } from "./utilities.ts";
import { Issue, Stack } from "./types.ts";

export const ISSUE_TITLES: Record<Issue["type"], string> = {
  empty_dom: "Empty DOM content",
  redirected: "Redirections",
  no_response: "Empty responses",
  empty_anchor: "Empty anchors",
  missing_anchor: "Missing anchors",
  not_ok_response: "Non-OK responses",
  wrong_extension: "Wrong extensions",
  disallow_extension: "Disallowed extensions",
  unknown_link_format: "Unknown link type",
  linked_file_not_found: "Missing files",
  local_alt_available: "Local alternative available",
};

export const ISSUE_DESCRIPTIONS: Record<Issue["type"], string> = {
  unknown_link_format: `\
The links highlighted in red seems to be an invalid type of link. Please check the source
files and correct the hyperlinks involved. If you think this was a mistake, please open
an issue over about this here: https://github.com/grammyjs/link-checker/issues/new.`,
  empty_dom: `\
The HTML document returned by the request couldn't be parsed properly by the HTML parser used.
Either the request returned nothing, or it was an invalid type of content. This issue must be
investigated and the links should be updated accordingly.`,
  not_ok_response: `\
The following highlighted links returned documents with non-OK response status codes.
The corresponding non-OK status codes are provided with them.`,
  wrong_extension: `\
Local relative links to another file shouldn't be ending with an extension as configured.
All links that doesn't follow this strict limit is listed below.`,
  linked_file_not_found: `The files linked do not exist at the given paths.`,
  redirected: `The links were redirected to a newer page or some other page according to the responses.`,
  missing_anchor: `Some links were pinned with an anchor. But the linked document doesn't have such an anchor.`,
  empty_anchor: `Restricts linking pages with no anchor destination. In other words, just '#'.`,
  no_response: `\
The following links does not return any response (probably timed out). This could be a
network issue, an internal server issue, or the page doesn't exist at all for some reason.`,
  disallow_extension: `\
Some local files seems to be linked with extension, and the use of extensions while linking
local documents is prohibited. Remove the following extensions.`,
  local_alt_available: `\
There are local alternatives available for the following links, and they should be replaced
with the local alternatives.`,
};

export function getSearchString(issue: Issue) {
  switch (issue.type) {
    case "redirected":
      return `${issue.from}`;
    case "not_ok_response":
    case "no_response":
    case "missing_anchor":
    case "empty_dom":
    case "disallow_extension":
    case "wrong_extension":
    case "linked_file_not_found":
    case "unknown_link_format":
    case "empty_anchor":
    case "local_alt_available":
      return `${issue.reference}`;
  }
}

// Group, find occurrences in files, etc.
export async function processIssues(issues: Record<string, Issue[]>) {
  return (await Promise.all(
    Object.entries(issues)
      .map(([filepath, issues]) => issues.map((issue) => ({ filepath, issue }))).flat()
      .reduce((deduped, current) => {
        const alreadyDeduped = deduped.find((issue) => equal(current.issue, issue.details));
        if (alreadyDeduped == null) return deduped.concat({ details: current.issue, filepaths: [current.filepath] });
        alreadyDeduped.filepaths.push(current.filepath);
        return deduped;
      }, [] as { details: Issue; filepaths: string[] }[])
      .map(async (issue) => {
        const stack = issue.filepaths.sort((a, b) => a.localeCompare(b)).map(async (filepath) => {
          const locations = await findStringLocations(filepath, getSearchString(issue.details));
          if (locations.length == 0) {
            console.error(filepath, getSearchString(issue.details), issue);
            console.error(yellow(`\
====================================================================================
PANIK. This shouldn't be happening. The search strings are supposed to have at least
one occurrence in the corresponding file. Please report this issue with enough
information and context at: https://github.com/grammyjs/link-checker/issues/new.
====================================================================================`));
          }
          return { filepath, locations: locations.map(([line, columns]) => ({ line, columns })) };
        });
        return { ...issue.details, stack: await Promise.all(stack) };
      }),
  )).reduce((grouped, issue) => {
    grouped[issue.type] ??= [];
    grouped[issue.type].push(issue);
    return grouped;
  }, {} as Record<Issue["type"], (Issue & { stack: Stack[] })[]>);
}
