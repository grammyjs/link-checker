import { parseArgs } from "./deps/std/cli.ts";
import { generateReport } from "./issues.ts";
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
