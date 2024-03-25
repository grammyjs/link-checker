import { App } from "https://esm.sh/@octokit/app@14.0.2?dts";
import { readMarkdownFiles } from "../website.ts";
import { findStringLocations, getSearchString, ISSUE_DESCRIPTIONS, ISSUE_TITLES } from "../issues.ts";
import { Issue } from "../types.ts";
import { equal } from "../deps/std/assert.ts";
import { relative } from "https://deno.land/std@0.219.1/path/posix/relative.ts";
import { parseLink } from "../utilities.ts";
import { join } from "../deps/std/path.ts";
import { yellow } from "../deps/std/fmt.ts";

const env = getEnv("APP_ID", "INSTALLATION_ID", "PRIVATE_KEY", "DIR");

const REPO = { owner: "dcdunkan", repo: "website" };
await new Deno.Command("git", { args: ["clone", `https://github.com/${REPO.owner}/${REPO.repo}`] }).output();
const dir = join(env.DIR, "website", "site", "docs");

const app = new App({ appId: Number(env.APP_ID), privateKey: env.PRIVATE_KEY });
const octokit = await app.getInstallationOctokit(Number(env.INSTALLATION_ID));

const me = await app.octokit.request("GET /app");
const LOGIN = me.data.slug + "[bot]";

const COMMIT_SHA = new TextDecoder().decode(
  (await new Deno.Command("git", { args: ["rev-parse", "HEAD"], cwd: dir }).output()).stdout,
).trim();
const issues = await readMarkdownFiles(dir, {
  indexFile: "README.md",
  isCleanUrl: true,
  allowHtmlExtension: false,
});
const issueNumber = await findOpenIssue();

if (Object.keys(issues).length === 0) {
  console.log("Found no issues");
  if (issueNumber !== 0) {
    // the issues were fixed but the issue wasn't closed, so let's close it.
    await octokit.request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", {
      ...REPO,
      issue_number: issueNumber,
      state: "closed",
      state_reason: "completed",
    });
  }
  Deno.exit(0);
}

const reportBody = await generateReport(issues);
if (issueNumber == 0) await createIssue(reportBody);
else await updateIssue(issueNumber, reportBody);
console.log(`https://github.com/${REPO.owner}/${REPO.repo}/issues/${issueNumber}`);

async function findOpenIssue() {
  const res = await octokit.request("GET /repos/{owner}/{repo}/issues", { ...REPO, creator: LOGIN, state: "open" });
  if (res.status == 200) return res.data[0]?.number ?? 0;
  console.error(res);
  throw new Error("failed to fetch opened issues");
}

async function createIssue(body: string) {
  const res = await octokit.request("POST /repos/{owner}/{repo}/issues", { ...REPO, title: "Broken Links", body });
  if (res.status === 201) return res.data.number ?? 0;
  console.error(res);
  throw new Error("failed to create the issue");
}

async function updateIssue(number: number, body: string) {
  const res = await octokit.request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", { ...REPO, issue_number: number, body });
  return res.status === 200;
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
        columns.map((column) =>
          `- <samp>**${
            relative(dir, filepath)
          }**:${lineNumber}:${column} [[src](https://github.com/${REPO.owner}/${REPO.repo}/blob/${COMMIT_SHA}/${
            relative(dir, filepath)
          }?plain=1#L${lineNumber}C${column})]</samp>`
        )
      ).flat();
    }),
  )).flat().join("\n");
}

function indentText(text: string, indentSize: number) {
  const indent = " ".repeat(indentSize);
  return text.includes("\n") ? text.split("\n").map((line) => indent + line).join("\n") : indent + text;
}

export async function generateReport(issues: Record<string, Issue[]>) {
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

  let report = `\
This issue contains the details regarding the broken links in the documentation. \
Please review the report below and close this issue once the fixes are made.

> This is auto-generated and if the report seem broken please [open an issue](https://github.com/grammyjs/link-checker/issues/new).`;
  let total = 0;
  const issueTypes = Object.keys(grouped) as Issue["type"][];
  for (const type of issueTypes.sort((a, b) => a.localeCompare(b))) {
    const title = ISSUE_TITLES[type];
    report += "\n\n### " + title + " (" + grouped[type].length + ")\n\n";
    report += "> " + ISSUE_DESCRIPTIONS[type].split("\n").join(" ");
    report += "\n\n<details><summary>Show the issues</summary>";
    for (const { details, stack } of grouped[type]) {
      report += "\n\n";
      report += "- [ ] " + makePrettyDetails(details);
      const stackTrace = await generateStackTrace(stack, getSearchString(details));
      report += "\n\n" + indentText(stackTrace, 5);
    }
    report += "\n</details>\n";
    total += grouped[type].length;
  }
  return "\n" + `**Found ${total} issues across the documentation (commit: ${COMMIT_SHA}).**` + "\n\n" + report +
    `\n\n<div align="center">\n\n> Generated by [grammyjs/link-checker](https://github.com/grammyjs/link-checker).\n</div>`;
}

// Make sure the strings returned are ONE LINERS
function makePrettyDetails(issue: Issue) {
  if ("reference" in issue) issue.reference = decodeURI(issue.reference);
  if ("to" in issue) issue.to = decodeURI(issue.to), issue.from = decodeURI(issue.from);

  switch (issue.type) {
    case "unknown_link_format":
      return `${issue.reference}`;
    case "empty_dom":
      return `${issue.reference}`;
    case "not_ok_response":
      return `(${issue.status}) ${issue.reference}`; // TODO: show issue.statusText
    case "wrong_extension": {
      const { root, anchor } = parseLink(issue.reference);
      const anchorText = `${anchor ? "#" + anchor : ""}`;
      return `Expected \`${issue.expected}\` as the file extension instead of \`${issue.actual}\` in ${root}${anchorText}`;
    }
    case "linked_file_not_found":
      return `\`${issue.filepath}\` (not found)`;
    case "redirected":
      return `${issue.from} → ${issue.to}`;
    case "missing_anchor":
      return `${issue.reference}${"#" + issue.anchor}`;
    case "empty_anchor":
      return `${issue.reference}#`;
    case "no_response":
      return `${issue.reference}`;
    case "disallow_extension": {
      const { root, anchor } = parseLink(issue.reference);
      const anchorText = anchor ? "#" + anchor : "";
      return `Omit the extension \`${issue.extension}\` from \`${root}${anchorText}\``;
    }
    default:
      throw new Error("Invalid type of issue! This shouldn't be happening.");
  }
}

function getEnv<T extends string>(...vars: T[]) {
  return vars.reduce((result, variable): Record<T, string> => {
    const value = Deno.env.get(variable);
    if (value == null) throw new Error("Missing env var: " + variable);
    return { ...result, [variable]: value };
  }, {} as Record<T, string>);
}
