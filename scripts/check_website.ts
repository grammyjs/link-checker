import { App } from "../deps/octokit_app.ts";
import { join, relative, resolve } from "../deps/std/path.ts";
import { parse, stringify } from "../deps/oson.ts";

import { readMarkdownFiles } from "../website.ts";
import { processIssues } from "../issues.ts";
import { Issue, IssueWithStack, Stack } from "../types.ts";
import { ISSUE_DESCRIPTIONS, ISSUE_TITLES, WARNING_ISSUE_TYPES } from "../constants.ts";
import { execute, getCommitSha, getEnv, getPossibleMatches, parseLink } from "../utilities.ts";

const env = getEnv(false, "APP_ID", "INSTALLATION_ID", "PRIVATE_KEY", "DIR");
const REPO = { owner: "dcdunkan", repo: "website" };
await (execute(["git", "clone", `https://github.com/${REPO.owner}/${REPO.repo}`]).spawn()).status;
const dir = resolve(join(env.DIR, "website", "site", "docs"));

try {
    const result = await Deno.lstat(join(dir, "ref"));
    if (!result.isDirectory) throw new Deno.errors.NotFound();
} catch (error) {
    if (error instanceof Deno.errors.NotFound) {
        console.log("Generating /ref directory");
        const proc = execute(["deno", "task", "docs:genapi"], { cwd: dir }).spawn();
        if (!(await proc.status).success) {
            console.log("failed to generate API reference documentation. try again");
            Deno.exit(1);
        }
    }
}

const app = new App({ appId: Number(env.APP_ID), privateKey: env.PRIVATE_KEY });
const octokit = await app.getInstallationOctokit(Number(env.INSTALLATION_ID));

const me = await app.octokit.request("GET /app");
if (!me.data) throw new Error(`Could not GET /app, returned ${me.data}`);
const LOGIN = me.data.slug + "[bot]";

const COMMIT_SHA = await getCommitSha(dir);

let issues: Record<string, Issue[]> = {};
if (Deno.env.get("DEBUG") != null) {
    console.log("=== DEBUGGING MODE ===");
    try {
        console.log("reading the cache file");
        issues = parse(await Deno.readTextFile("./.link-checker"));
    } catch (_error) {
        console.log("failed to read the cache file");
        issues = await getIssues();
        await Deno.writeTextFile("./.link-checker", stringify(issues));
        console.log("cache file created and will be used next time debugging");
    }
} else {
    console.log("Reading files and checking for bad links...");
    issues = await getIssues();
}

const processed = await processIssues(issues);
const issueNumber = await findOpenIssue();

if (
    Object.keys(issues).length === 0 ||
    !Object.values(processed).flat().some((issue) => !WARNING_ISSUE_TYPES.includes(issue.type))
) {
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

// if we only have issues of sub-type 'warning', don't care making a new issue.
const reportBody = generateReport(processed);
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
    const res = await octokit.request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", {
        ...REPO,
        issue_number: number,
        body,
    });
    return res.status === 200;
}

function generateStackTrace(stacktrace: Stack[]): string {
    return stacktrace.map((stack) =>
        stack.locations.map((location) =>
            location.columns.map((column) => {
                const path = relative(join(env.DIR, "website"), stack.filepath);
                return `- <samp>**${path}**:${location.line}:${column} ` + (
                    path.split("/")[2] !== "ref"
                        ? `[[src](https://github.com/${REPO.owner}/${REPO.repo}/blob/${COMMIT_SHA}/${path}?plain=1#L${location.line}C${column})]</samp>`
                        : `[[original source](https://github.com/grammyjs/${getGithubRepoName(path)})]` // redundant, ik.
                );
            })
        ).flat()
    ).flat().join("\n");
}

function indentText(text: string, indentSize: number) {
    const indent = " ".repeat(indentSize);
    return text.includes("\n") ? text.split("\n").map((line) => indent + line).join("\n") : indent + text;
}

export function generateReport(grouped: Record<Issue["type"], IssueWithStack[]>) {
    let report = `\
This issue contains the details regarding few broken links in the documentation. \
Please review the report below and close this issue once the fixes are made.

<sup>This is auto-generated and if the report seem broken, please open an issue [here](https://github.com/grammyjs/link-checker/issues/new).</sup>\n\n`;
    let total = 0;
    const issueTypes = Object.keys(grouped) as Issue["type"][];
    for (const type of issueTypes.sort((a, b) => a.localeCompare(b))) {
        const title = ISSUE_TITLES[type];
        report += "### " + title + " (" + grouped[type].length + ")\n\n";
        report += ISSUE_DESCRIPTIONS[type].split("\n").join(" ");
        report += "\n\n<details><summary>Show the issues</summary>";
        const sorted = grouped[type].map(({ stack, ...details }) => {
            const pretty = makePrettyDetails(details);
            const stacktrace = generateStackTrace(stack);
            return { details: pretty, stacktrace };
        }).sort((a, b) => a.details.localeCompare(b.details));
        for (const { details, stacktrace } of sorted) {
            report += "\n\n";
            report += "- [ ] " + indentText(details, 5).slice(5);
            report += "\n\n" + indentText(stacktrace, 5);
        }
        report += "\n</details>\n\n";
        total += grouped[type].length;
    }
    return "\n" + `**Found ${total} issues across the documentation (commit: ${COMMIT_SHA})**` + "\n\n" + report +
        `\n\n<div align="center">\n\n<sub>Generated by [grammyjs/link-checker](https://github.com/grammyjs/link-checker)</sub>\n</div>`;
}

// Make sure the strings returned are ONE LINERS
function makePrettyDetails(issue: Issue): string {
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
            return `The file at \`${issue.filepath}\` referenced as \`${issue.reference}\` was not found`;
        case "redirected":
            return `${issue.from} → ${issue.to}`;
        case "missing_anchor": {
            const possible = getPossibleMatches(issue.anchor, issue.allAnchors);
            return issue.reference + "\n\n" +
                (possible.length
                    ? "Possible fix" + (possible.length > 1 ? "es" : "") + ": " +
                        possible.map((anchor) => `\`${anchor}\``).join(", ")
                    : "");
        }
        case "empty_anchor":
            return `${issue.reference}#`;
        case "no_response":
            return `${issue.reference}`;
        case "disallow_extension": {
            const { root, anchor } = parseLink(issue.reference);
            const anchorText = anchor ? "#" + anchor : "";
            return `Omit the extension \`${issue.extension}\` from \`${root}${anchorText}\``;
        }
        case "local_alt_available":
            return `${issue.reference}\n\n${issue.reason}`;
        case "inaccessible":
            return `${issue.reference}\n\n${issue.reason}`;
        default:
            throw new Error("Invalid type of issue! This shouldn't be happening.");
    }
}

function getIssues() {
    return readMarkdownFiles(dir, {
        indexFile: "README.md",
        isCleanUrl: true,
        allowHtmlExtension: false,
        includeRefDirectory: false,
    });
}

function getGithubRepoName(path: string) {
    const name = path.split("/")[3];
    return name === "core" ? "grammY" : name;
}
