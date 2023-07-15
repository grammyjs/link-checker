import { error } from "./deps/common.ts";
import { parseArgs } from "./deps/std/flags.ts";
import { bold, green, red, yellow } from "./deps/std/fmt.ts";

import { generateIssueList, prettySummary } from "./issues.ts";
import { findIssues, TSDocLink, TSDocLinkIssue } from "./tsdoc.ts";

const args = parseArgs(Deno.args, {
  string: ["module"],
  unknown: (arg) => {
    error(`Unknown argument ${arg}.`);
    Deno.exit(1);
  },
});

if (args.module == null) {
  error("Specify a module using --module.");
  Deno.exit(1);
}

const isAbsoluteUrl = URL.canParse(args.module);

if (!isAbsoluteUrl && args.module[0] !== "/" && !args.module.startsWith("./") && !args.module.startsWith("../")) {
  error("Module path must be a relative path or an absolute local or remote URL.");
  Deno.exit(1);
}

if (!isAbsoluteUrl && !Deno.lstatSync(args.module).isFile) {
  error("The specified module must be a TypeScript/JavaScript file.");
  Deno.exit(1);
}

const module = isAbsoluteUrl ? args.module : import.meta.resolve(args.module);
const issues = await findIssues(module);

if (issues.length === 0) {
  console.log(green("No broken links were found in any of the TSDocs!"));
  Deno.exit(0);
}

console.log("\n" + red(`Found ${issues.length} issues in TSDocs of the module.\n`));

const mappedIssues = issues.reduce<Record<string, TSDocLinkIssue[]>>((prev, issue) => {
  const location = issue.loc instanceof Set ? Array.from(issue.loc).map(prettyLocation).join("\n") : prettyLocation(issue.loc);
  prev[location] ??= [];
  prev[location].push(issue);
  return prev;
}, {});

console.log(prettySummary(mappedIssues).summary);

for (const location of Object.keys(mappedIssues).sort((a, b) => a.localeCompare(b))) {
  console.log(`\n${location}`);
  console.log(generateIssueList(mappedIssues[location]));
}

function prettyLocation({ location, tag, name }: TSDocLink) {
  return `${bold(location.filename)}:${location.line}:${location.col}` +
    (tag == null ? "" : ` in ${red("@" + tag)}`) +
    (name == null ? "" : ` ${yellow(name)}`);
}
