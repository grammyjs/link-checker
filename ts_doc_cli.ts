import { parseArgs } from "./deps/std/flags.ts";
import { bold, green, red, yellow } from "./deps/std/fmt.ts";
import { generateIssueList, prettySummary } from "./issues.ts";
import { findIssues, TSDocLink, TSDocLinkIssue } from "./ts_doc.ts";

const args = parseArgs(Deno.args, { string: ["module"] });

if (args.module == null) {
  console.error("Specify a module using --module.");
  Deno.exit(1);
}

function prettyLocation({ location, tag, name }: TSDocLink) {
  return `${bold(location.filename)}:${location.line}:${location.col}` +
    (tag == null ? "" : ` in ${red("@" + tag)}`) +
    (name == null ? "" : ` ${yellow(name)}`);
}

const allIssues = await findIssues(args.module);

if (allIssues.length === 0) {
  console.log(green("No broken links were found in any of the TS Docs!"));
  Deno.exit(0);
}

console.log(red(`Found ${allIssues.length} issues in TS Docs of the module.\n`));

const issues = allIssues.reduce<
  Record<string, TSDocLinkIssue[]>
>((prev, issue) => {
  if (issue.loc instanceof Set) {
    const locations: string[] = [];
    for (const loc of issue.loc) {
      locations.push(prettyLocation(loc));
    }
    const location = locations.join("\n");
    prev[location] ??= [];
    prev[location].push(issue);
  } else {
    const location = prettyLocation(issue.loc);
    prev[location] ??= [];
    prev[location].push(issue);
  }
  return prev;
}, {});

console.log(prettySummary(issues).summary);

for (const location of Object.keys(issues).sort((a, b) => a.localeCompare(b))) {
  console.log(`\n${location}`);
  console.log(generateIssueList(issues[location]));
}
