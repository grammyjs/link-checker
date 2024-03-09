import { bold, cyan, dim, green, red, strikethrough, underline, yellow } from "./deps/std/fmt.ts";
import { Issue } from "./types.ts";
import { parseLink } from "./utilities.ts";
import { extname, resolve } from "./deps/std/path.ts";
import { equal } from "./deps/std/assert.ts";

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
};

export const ISSUE_DESCRIPTIONS: Record<Issue["type"], string> = {
  "unknown_link_format": `\
The links highlighted in red seems to be an invalid type of link. Please check the source
files and correct the hyperlinks involved. If you think this was a mistake, please open
an issue over about this here: https://github.com/grammyjs/link-checker/issues/new.`,
  "empty_dom": `\
The HTML document returned by the request couldn't be parsed properly by the HTML parser used.
Either the request returned nothing, or it was an invalid type of content. This issue must be
investigated and the links should be updated accordingly.`,
  "not_ok_response": `\
The following highlighted links returned documents with non-OK response status codes.
The corresponding non-OK status codes are provided with them.`,
  "wrong_extension": `\
Local relative links to another file shouldn't be ending with an extension as configured.
All links that doesn't follow this strict limit is listed below.`,
  "linked_file_not_found": `The files linked do not exist at the given paths.`,
  "redirected": `The links were redirected to a newer page or some other page according to the responses.`,
  "missing_anchor": `Some links were pinned with an anchor. But the linked document doesn't have such an anchor.`,
  "empty_anchor": `Restricts linking pages with no anchor destination. In other words, just '#'.`,
  "no_response": `\
The following links does not return any response (probably timed out). This could be a
network issue, an internal server issue, or the page doesn't exist at all for some reason.`,
  "disallow_extension": `\
Some local files seems to be linked with extension, and the use of extensions while linking
local documents is prohibited. Remove the following extensions.`,
};

function makePrettyDetails(issue: Issue) {
  if ("reference" in issue) issue.reference = decodeURI(issue.reference);
  if ("to" in issue) issue.to = decodeURI(issue.to), issue.from = decodeURI(issue.from);

  switch (issue.type) {
    case "unknown_link_format":
      return `${underline(red(issue.reference))}`;
    case "empty_dom":
      return `${underline(red(issue.reference))}`;
    case "not_ok_response":
      return `[${red(issue.status.toString())}] ${underline(issue.reference)}`; // TODO: show issue.statusText
    case "wrong_extension": {
      const { root, anchor } = parseLink(issue.reference);
      return `${root.slice(0, -extname(root).length)}\
${bold(`${strikethrough(red(issue.actual))}${green(issue.expected)}`)}\
${anchor ? dim("#" + anchor) : ""}`;
    }
    case "linked_file_not_found":
      return `${dim(red(issue.filepath))} (not found)`;
    case "redirected":
      return `${underline(yellow(issue.from))} --> ${underline(green(issue.to))}`;
    case "missing_anchor":
      return `${underline(issue.reference)}${red(bold("#" + issue.anchor))}`;
    case "empty_anchor":
      return `${underline(issue.reference)}${red(bold("#"))}`;
    case "no_response":
      return `${underline(issue.reference)}`;
    case "disallow_extension": {
      const { root, anchor } = parseLink(issue.reference);
      return `${root.slice(0, -extname(root).length)}\
${bold(strikethrough(red(issue.extension)))}${anchor ? dim("#" + anchor) : ""}`;
    }
    default:
      throw new Error("Invalid type of issue! This shouldn't be happening.");
  }
}

export function getSearchString(issue: Issue) {
  switch (issue.type) {
    case "redirected":
      return `${issue.from}`;
    case "not_ok_response":
      return `${issue.reference}`;
    case "no_response":
      return `${issue.reference}`;
    case "missing_anchor":
      return `${issue.reference}#${issue.anchor}`;
    case "empty_dom":
      return `${issue.reference}`;
    case "disallow_extension":
      return `${issue.reference}`;
    case "wrong_extension":
      return `${issue.reference}`;
    case "linked_file_not_found":
      return `${issue.filepath}`;
    case "unknown_link_format":
      return `${issue.reference}`;
    case "empty_anchor":
      return `${issue.reference}`;
  }
}

function getColumns(haystack: string, needle: string) {
  const indices: number[] = [];
  while (haystack.includes(needle)) {
    const length = indices.push(haystack.indexOf(needle) + 1);
    haystack = haystack.slice(indices[length - 1]);
  }
  return indices;
}

// little grep (my own impl.)
export async function findStringLocations(
  filepath: string,
  searchString: string,
): Promise<[line: number, columns: number[], text: string][]> {
  using file = await Deno.open(filepath, { read: true });
  let tempLine = "";
  let currentLine = 1;
  const locations: [line: number, columns: number[], text: string][] = [];
  const decoder = new TextDecoder();
  for await (const chunk of file.readable) {
    const decodedChunk = decoder.decode(chunk);
    const lines = decodedChunk.split("\n");
    tempLine += lines.shift();
    if (lines.length <= 1) continue;
    if (tempLine.includes(searchString)) {
      locations.push([currentLine, getColumns(tempLine, searchString), tempLine]);
    }
    currentLine += 1;
    tempLine = lines.pop()!;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(searchString)) {
        locations.push([currentLine, getColumns(line, searchString), line]);
      }
      currentLine += 1;
    }
  }
  return locations;
}

async function generateStackTrace(filepaths: string[], searchString: string) {
  return (await Promise.all(
    filepaths.sort((a, b) => a.localeCompare(b)).map(async (filepath) => {
      const locations = await findStringLocations(filepath, searchString);
      if (locations.length == 0) {
        console.error(yellow(`\
====================================================================================
PANIK. This shouldn't be happening. The search strings are supposed to have at least
one occurrence in the corresponding file. Please report this issue with enough
information and context at: https://github.com/grammyjs/link-checker/issues/new.
====================================================================================`));
        return [];
      }
      return locations.map(([lineNumber, columns]) =>
        columns.map((column) => `at ${cyan(resolve(filepath))}:${yellow(lineNumber.toString())}:${yellow(column.toString())}`)
      ).flat();
    }),
  )).flat().join("\n");
}

function indentText(text: string, indentSize: number) {
  const indent = " ".repeat(indentSize);
  return text.includes("\n") ? text.split("\n").map((line) => indent + line).join("\n") : indent + text;
}

export async function generateReport(issues: Record<string, Issue[]>) {
  if (Object.keys(issues).length === 0) {
    return { total: 0, report: green("Found no issues with links in the documentation!") };
  }
  const grouped = Object.entries(issues).map(([filepath, issues]) => {
    return issues.map((issue) => ({ filepath, issue }));
  }).flat().reduce((deduped, current) => {
    const alreadyDeduped = deduped.find((x) => equal(current.issue, x.details));
    if (alreadyDeduped == null) return deduped.concat({ details: current.issue, stack: [current.filepath] });
    alreadyDeduped.stack.push(current.filepath);
    return deduped;
  }, [] as { details: Issue; stack: string[] }[]).reduce((grouped, issue) => {
    grouped[issue.details.type] ??= [];
    grouped[issue.details.type].push(issue);
    return grouped;
  }, {} as Record<Issue["type"], { details: Issue; stack: string[] }[]>);

  let report = "", total = 0;
  const issueTypes = Object.keys(grouped) as Issue["type"][];
  for (const type of issueTypes) {
    const title = ISSUE_TITLES[type];
    report += "\n" + bold(title) + " (" + grouped[type].length + ")\n";
    report += ISSUE_DESCRIPTIONS[type];
    for (const { details, stack } of grouped[type]) {
      report += "\n\n";
      report += indentText(makePrettyDetails(details), 1);
      const stackTrace = await generateStackTrace(stack, getSearchString(details));
      report += "\n" + indentText(stackTrace, 4);
    }
    report += "\n";
    total += grouped[type].length;
  }

  return {
    total,
    report: "\n" + red(bold(`Found ${total} issues across the documentation:`)) + "\n" + report +
      `\nChecking completed and found ${bold(total.toString())} issues.`,
  };
}
