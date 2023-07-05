import { colors, parse } from "./deps.ts";
import { generateIssueList, prettySummary } from "./issues.ts";
import { readMarkdownFiles } from "./website.ts";

const args = parse(Deno.args, { boolean: ["clean-url"] });
if (args._.length > 1) {
  console.log("Multiple directories were specified. Ignoring everything except the first one.");
}
const ROOT_DIRECTORY = (args._[0] ?? ".").toString();

const issues = await readMarkdownFiles(ROOT_DIRECTORY, {
  isCleanUrl: args["clean-url"],
});

const { totalIssues, summary } = prettySummary(issues);

if (totalIssues === 0) {
  console.log(colors.green("You're good to go! No issues were found!"));
  Deno.exit(0);
}

console.log(colors.red(`Found ${totalIssues} issues in the documentation:\n`));
console.log(summary);

for (const filepath of Object.keys(issues).sort((a, b) => a.localeCompare(b))) {
  console.log(filepath, `(${issues[filepath].length})`);
  console.log(generateIssueList(issues[filepath]));
}

Deno.exit(1);
