import { parseArgs } from "./deps/std/cli.ts";
import { bold, cyan, dim, green, red, strikethrough, underline, yellow } from "./deps/std/fmt.ts";
import { extname, resolve } from "./deps/std/path.ts";

import { ISSUE_DESCRIPTIONS, ISSUE_TITLES, processIssues } from "./issues.ts";
import { Issue, Stack } from "./types.ts";
import { getPossibleMatches, indentText, parseLink } from "./utilities.ts";
import { readMarkdownFiles } from "./website.ts";

const args = parseArgs(Deno.args, {
  boolean: ["clean-url", "allow-ext-html"],
  string: ["index-file"],
  default: {
    "index-file": "README.md",
    "allow-ext-html": false,
  },
});

if (args._.length > 1) {
  console.log("Multiple directories were specified. Ignoring everything except the first one.");
}

const ROOT_DIRECTORY = (args._[0] ?? ".").toString();

console.log("Reading files and checking for bad links...");

const issues = await readMarkdownFiles(ROOT_DIRECTORY, {
  isCleanUrl: args["clean-url"],
  indexFile: args["index-file"],
  allowHtmlExtension: args["allow-ext-html"],
});

const { report } = await generateReport(issues);
console.log(report);

Deno.exit(1);

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
      return `${dim(red(issue.reference))} (${yellow("path")}: ${issue.filepath})`;
    case "redirected":
      return `${underline(yellow(issue.from))} --> ${underline(green(issue.to))}`;
    case "missing_anchor": {
      const { root } = parseLink(issue.reference);
      const possible = getPossibleMatches(issue.anchor, issue.allAnchors);
      return `${underline(root)}${red(bold("#" + issue.anchor))}` +
        (possible.length
          ? `\n${yellow("possible fix" + (possible.length > 1 ? "es" : ""))}: ${possible.map((match) => match).join(dim(", "))}`
          : "");
    }
    case "empty_anchor":
      return `${underline(issue.reference)}${red(bold("#"))}`;
    case "no_response":
      return `${underline(issue.reference)}`;
    case "disallow_extension": {
      const { root, anchor } = parseLink(issue.reference);
      return `${root.slice(0, -extname(root).length)}\
${bold(strikethrough(red("." + issue.extension)))}${anchor ? dim("#" + anchor) : ""}`;
    }
    case "local_alt_available":
      return `${cyan(issue.reference)}\n${issue.reason}`;
    default:
      throw new Error("Invalid type of issue! This shouldn't be happening.");
  }
}

function generateStackTrace(stacktrace: Stack[]) {
  return stacktrace.map((stack) =>
    stack.locations.map((location) =>
      location.columns.map((column) =>
        `at ${cyan(resolve(stack.filepath))}:${yellow(location.line.toString())}:${yellow(column.toString())}`
      )
    ).flat()
  ).flat().join("\n");
}

async function generateReport(issues: Record<string, Issue[]>) {
  if (Object.keys(issues).length === 0) {
    return { total: 0, report: green("Found no issues with links in the documentation!") };
  }
  const grouped = await processIssues(issues);
  let report = "", total = 0;
  const issueTypes = Object.keys(grouped) as Issue["type"][];
  for (const type of issueTypes) {
    const title = ISSUE_TITLES[type];
    report += "\n" + bold(title) + " (" + grouped[type].length + ")\n";
    report += ISSUE_DESCRIPTIONS[type];
    for (const { stack, ...details } of grouped[type]) {
      report += "\n\n";
      report += indentText(makePrettyDetails(details), 1);
      report += "\n" + indentText(generateStackTrace(stack), 4);
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
