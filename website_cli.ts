import { FIXABLE_ISSUE_TYPES, ISSUE_DESCRIPTIONS, ISSUE_TITLES, WARNING_ISSUE_TYPES } from "./constants.ts";
import { parse, stringify } from "./deps/oson.ts";
import { parseArgs, Spinner } from "./deps/std/cli.ts";
import { blue, bold, cyan, green, red, yellow } from "./deps/std/fmt.ts";
import { join, resolve } from "./deps/std/path.ts";

import { makePrettyDetails, processIssues } from "./issues.ts";
import { FixableIssue, Issue, IssueWithStack, Stack } from "./types.ts";
import { execute, getPossibleMatches, indentText, parseLink } from "./utilities.ts";
import { readMarkdownFiles } from "./website.ts";

const args = parseArgs(Deno.args, {
    boolean: ["clean-url", "allow-ext-html", "fix", "include-ref", "ignore-warnings"],
    string: ["index-file"],
    default: {
        "index-file": "README.md",
        "allow-ext-html": false,
        "include-ref": false,
        "ignore-warnings": false,
    },
});

if (args._.length > 1) {
    console.log("Multiple directories were specified. Ignoring everything except the first one.");
}

const rootDirectory = (args._[0] ?? ".").toString();
const cacheFile = join(rootDirectory, ".link-checker");

try {
    const result = await Deno.lstat(join(rootDirectory, "ref"));
    if (!result.isDirectory) throw new Deno.errors.NotFound();
} catch (error) {
    if (error instanceof Deno.errors.NotFound) {
        console.log("Generating /ref directory");
        const proc = execute(["deno", "task", "docs:genapi"], { cwd: rootDirectory }).spawn();
        if (!(await proc.status).success) {
            console.log("failed to generate API reference documentation. try again");
            Deno.exit(1);
        }
    }
}

if (args.fix) {
    console.warn(
        "%c| %cNote%c: You have specified the --fix argument. This will try to fix all the issues this tool can fix.\n",
        "font-weight: bold",
        "color: orange",
        "color: none",
    );
}

let grouped: Record<Issue["type"], IssueWithStack[]>;

if (Deno.env.get("DEBUG") != null) {
    console.log("=== DEBUGGING MODE ===");
    try {
        console.log("reading the cache file");
        grouped = parse(await Deno.readTextFile(cacheFile));
    } catch (_error) {
        console.log("failed to read the cache file");
        const issues = await getIssues();
        grouped = await processIssues(issues);
        await Deno.writeTextFile(cacheFile, stringify(grouped));
        console.log("cache file created and will be used next time debugging");
    }
} else {
    console.log("Reading files and checking for bad links...");
    const issues = await getIssues();
    grouped = await processIssues(issues);
}

const getIssueTypes = () => (Object.keys(grouped) as Issue["type"][]);
//       .filter((type) => !(WARNING_ISSUE_TYPES.includes(type) && args["ignore-warnings"]));

const getTotal = () =>
    getIssueTypes()
        .filter((type) => !WARNING_ISSUE_TYPES.includes(type))
        .reduce((total, type) => total + grouped[type].length, 0);

if (args["ignore-warnings"]) {
    const count = WARNING_ISSUE_TYPES.reduce((p, type) => p + grouped[type].length, 0);
    console.log(yellow("--ignore-warnings:"), `ignoring ${count} warnings`);
}

if (getIssueTypes().length === 0) {
    console.log(green("Found no issues with links in the documentation!"));
    Deno.exit(0);
}

const initial = getTotal();
console.log("\n" + red(bold(`Found ${initial} issues across the documentation:`)));

let totalPlaces = 0, fixed = 0;

if (args.fix) {
    console.log(blue("note:"), "--fix was specified. trying to fix fixable issues...");
    const spinner = new Spinner({ message: "fixing issues..." });
    spinner.start();

    let fixesMadeThisRound: number, round = 1;
    do {
        fixesMadeThisRound = 0;
        spinner.message = `fixing: round ${round++}`;

        for (const type of getIssueTypes()) {
            if (!isFixableIssueType(type)) continue;
            spinner.message = `fixing ${ISSUE_TITLES[type]} issues (${grouped[type].length})...`;

            const groupLength = grouped[type].length;
            let issueCount = 0;
            for (let i = 0; issueCount < groupLength; i++, issueCount++) {
                const issue = grouped[type][i];
                totalPlaces += issue.stack.length;

                const fixStrings = getFixedString(issue);
                if (fixStrings == null) {
                    spinner.message = `(${issueCount}/${groupLength}) skipped: no fix available`;
                    continue;
                }

                const stackLength = grouped[type][i].stack.length;
                const fixedPlaces = new Set<string>();

                if (grouped[type][i].stack.length != 0) {
                    spinner.message = `(${issueCount}/${groupLength}) fixing...`;
                }

                // Fix all occurrences
                for (let j = 0, stackCount = 1; stackCount <= stackLength; stackCount++, j++) {
                    const stack = grouped[type][i].stack[j];
                    if (stack.filepath.startsWith("ref/")) continue; // do not fix /ref stuff, just report it.
                    fixedPlaces.add(stack.filepath);
                    const content = await Deno.readTextFile(stack.filepath);
                    await Deno.writeTextFile(stack.filepath, content.replaceAll(fixStrings[0], fixStrings[1]));
                    grouped[type][i].stack.splice(j, 1), j--;
                    spinner.message = `(${issueCount}/${groupLength}): ${stack.filepath}`;
                    fixesMadeThisRound++;
                }

                // All occurrences were fixed, no use keeping the issue in accounts now.
                if (grouped[type][i].stack.length == 0) {
                    grouped[type].splice(i--, 1);
                    spinner.message = `(${issueCount}/${groupLength}) fixed`;
                }

                // Update all issues with same references
                spinner.message = "updating references...";
                for (const type of getIssueTypes()) {
                    for (const issue of grouped[type]) {
                        if (!isFixableIssueType(issue.type)) break;
                        // Only update the reference if all the files have been updated:
                        if (issue.stack.some(({ filepath }) => !fixedPlaces.has(filepath))) continue;
                        switch (issue.type) {
                            case "redirected":
                                issue.from = issue.from.replace(fixStrings[0], fixStrings[1]);
                                break;
                            case "empty_anchor":
                            case "missing_anchor":
                            case "disallow_extension":
                            case "wrong_extension":
                                issue.reference = issue.reference.replace(fixStrings[0], fixStrings[1]);
                                break;
                        }
                    }
                }
            }

            if (groupLength - grouped[type].length > 0) {
                spinner.stop();
                console.log(
                    green("fixed"),
                    `${groupLength - grouped[type].length} of ${groupLength} ${ISSUE_TITLES[type]} issues`,
                );
                spinner.start();
            }

            // No issues left in this group
            if (grouped[type].length == 0) delete grouped[type];

            fixed += fixesMadeThisRound;
        }
    } while (fixesMadeThisRound != 0);

    spinner.stop();
    console.log(green("done"), `resolved ${initial - getTotal()} issues completely and fixed problems in ${fixed} places.`);

    if (fixed > 0) {
        await Deno.writeTextFile(cacheFile, stringify(grouped));
        console.log("cache file was updated to reflect the changes made by --fix");
    }
}

console.log();

const warningIssueTypes = getIssueTypes()
    .filter((type) => WARNING_ISSUE_TYPES.includes(type));

if (warningIssueTypes.length !== 0) {
    console.log(yellow(bold("--------- WARNINGS ---------")));
    console.log(warningIssueTypes.map((type) => getIssueTypeSummary(type)).join("\n") + "\n");
}

const issueTypes = getIssueTypes()
    .filter((type) => !WARNING_ISSUE_TYPES.includes(type));

if (issueTypes.length > 0) {
    console.log(red(bold("---------- ISSUES ----------")));
    console.log(issueTypes.map((type) => getIssueTypeSummary(type)).join("\n") + "\n");
}

const current = getTotal();
console.log(`Checking completed and found ${bold(current.toString())} issues.`);
if (args.fix) console.log(`Fixed issues in ${bold(fixed.toString())} places.`);

if (current == 0 || getIssueTypes().every((type) => WARNING_ISSUE_TYPES.includes(type))) {
    Deno.exit(0); // print the warnings but exit successfully, dont fail the check
}

Deno.exit(1);

function getIssues() {
    return readMarkdownFiles(rootDirectory, {
        isCleanUrl: args["clean-url"],
        indexFile: args["index-file"],
        allowHtmlExtension: args["allow-ext-html"],
        includeRefDirectory: args["include-ref"],
    });
}

function getIssueTypeSummary(type: Issue["type"]): string {
    const title = `${bold(ISSUE_TITLES[type])} (${grouped[type].length})`;
    const description = ISSUE_DESCRIPTIONS[type];
    const issueInfo = grouped[type].map((issue) => {
        return [
            indentText(makePrettyDetails(issue), 1),
            indentText(generateStackTrace(issue.stack), 4),
        ].join("\n");
    }).join("\n\n");
    return `\n${title}\n${description}\n\n${issueInfo}`;
}

/** Generate stacktrace for the report */
function generateStackTrace(stacktrace: Stack[]) {
    return stacktrace.map((stack) =>
        stack.locations.map((location) =>
            location.columns.map((column) =>
                `at ${cyan(resolve(stack.filepath))}:${yellow(location.line.toString())}:${yellow(column.toString())}`
            )
        ).flat()
    ).flat().join("\n");
}

/**
 * Returns original search string and replaceable string if the issue can be fixed,
 * otherwise returns undefined.
 */
function getFixedString(issue: IssueWithStack): [string, string] | undefined {
    switch (issue.type) {
        case "redirected":
            return [issue.from, issue.to];
        case "missing_anchor": {
            const { root } = parseLink(decodeURIComponent(issue.reference));
            const possible = getPossibleMatches(issue.anchor, issue.allAnchors)[0];
            return possible == null ? undefined : [issue.reference, root + "#" + possible];
        }
        case "empty_anchor":
            return [issue.reference, issue.reference.slice(0, -1)];
        case "wrong_extension": {
            const { root } = parseLink(issue.reference);
            return [root, root.slice(0, -issue.actual.length) + issue.expected];
        }
        case "disallow_extension": {
            const { root } = parseLink(issue.reference);
            return [root, root.slice(0, -(issue.extension.length + 1))];
        }
        default:
            throw new Error("Invalid fixable type");
    }
}

function isFixableIssueType(type: Issue["type"]): type is FixableIssue["type"] {
    return FIXABLE_ISSUE_TYPES.includes(type);
}
