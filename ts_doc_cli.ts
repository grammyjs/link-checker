import { colors, overwrite, parse } from "./deps.ts";
import { generateIssueList, prettySummary } from "./issues.ts";
import { findLinks, Link } from "./ts_doc.ts";
import type { ExternalLinkIssue, Issue } from "./types.ts";
import { checkExternalLink } from "./utilities.ts";

type TSDocLinkIssue = (Issue & { loc: Link }) | (ExternalLinkIssue & { loc: Set<Link> });
const args = parse(Deno.args, { string: ["module"] });

if (args.module == null) {
  console.error("Specify a module using --module.");
  Deno.exit(1);
}

function prettyLocation({ location, tag, name }: Link) {
  return `${colors.bold(location.filename)}:${location.line}:${location.col}` +
    (tag == null ? "" : ` in ${colors.red("@" + tag)}`) +
    (name == null ? "" : ` ${colors.yellow(name)}`);
}

const allIssues: TSDocLinkIssue[] = [];
const links = await findLinks(args.module);

for (const root in links) {
  overwrite(colors.brightMagenta("fetch"), root);
  const checked = await checkExternalLink(root);
  if (checked == null) {
    allIssues.push({ type: "no_response", reference: root, loc: links[root] });
    continue;
  }
  allIssues.push(...checked.issues.map((issue) => ({ ...issue, loc: links[root] })));
  if (checked.anchors == null) {
    delete links[root];
    continue;
  }
  for (const loc of links[root]) {
    if (loc.anchor == null || checked.anchors.has(loc.anchor)) continue;
    allIssues.push({ type: "missing_anchor", anchor: loc.anchor, reference: root, loc });
  }
}

if (allIssues.length === 0) {
  console.log(colors.green("No broken links were found in any of the TS Docs!"));
  Deno.exit(0);
}

console.log(colors.red(`Found ${allIssues.length} issues in TS Docs of the module.\n`));

const issues = allIssues.reduce<Record<string, TSDocLinkIssue[]>>((prev, issue) => {
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
