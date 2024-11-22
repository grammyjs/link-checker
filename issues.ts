import { bold, cyan, dim, green, italic, red, strikethrough, underline, yellow } from "./deps/std/fmt.ts";
import { equal } from "./deps/std/assert.ts";

import { findStringLocations, getPossibleMatches, parseLink } from "./utilities.ts";
import { Issue, IssueWithStack } from "./types.ts";
import { SEARCH_PANIC_MESSAGE } from "./constants.ts";
import { extname } from "./deps/std/path.ts";

export function getSearchString(issue: Issue) {
    switch (issue.type) {
        case "redirected":
            return `${issue.from}`;
        case "not_ok_response":
        case "no_response":
        case "missing_anchor":
        case "empty_dom":
        case "disallow_extension":
        case "wrong_extension":
        case "linked_file_not_found":
        case "unknown_link_format":
        case "empty_anchor":
        case "local_alt_available":
        case "inaccessible":
            return `${issue.reference}`;
    }
}

// Group, find occurrences in files, etc.
export async function processIssues(issues: Record<string, Issue[]>) {
    return (await Promise.all(
        Object.entries(issues)
            .map(([filepath, issues]) => issues.map((issue) => ({ filepath, issue }))).flat()
            .reduce((deduped, current) => {
                const alreadyDeduped = deduped.find((issue) => equal(current.issue, issue.details));
                if (alreadyDeduped == null) return deduped.concat({ details: current.issue, filepaths: [current.filepath] });
                alreadyDeduped.filepaths.push(current.filepath);
                return deduped;
            }, [] as { details: Issue; filepaths: string[] }[])
            .map(async (issue) => {
                const stack = issue.filepaths
                    .filter((filepath, i, arr) => i === arr.lastIndexOf(filepath))
                    .sort((a, b) => a.localeCompare(b))
                    .map(async (filepath) => {
                        const searchString = getSearchString(issue.details);
                        if (searchString.length > 0) {
                            const locations = await findStringLocations(filepath, getSearchString(issue.details));
                            if (locations.length == 0) {
                                console.error(filepath, getSearchString(issue.details), issue);
                                console.error(yellow(SEARCH_PANIC_MESSAGE));
                            }
                            return { filepath, locations: locations.map(([line, columns]) => ({ line, columns })) };
                        }

                        console.error(
                            yellow(`Searching for <empty search string> in the file ${filepath}. Details: `),
                            issue.details,
                        );
                        return {
                            filepath,
                            /* FIXME: this definitely sucks, but this is for compat */
                            locations: [{ line: -1, columns: [-1] }],
                        };
                    });
                return { ...issue.details, stack: await Promise.all(stack) };
            }),
    )).reduce((grouped, issue) => {
        grouped[issue.type] ??= [];
        grouped[issue.type].push(issue);
        return grouped;
    }, {} as Record<Issue["type"], IssueWithStack[]>);
}

export function makePrettyDetails(issue: Issue) {
    if ("reference" in issue) {
        issue.reference = decodeURI(issue.reference);
        if (issue.reference.trim() === "") {
            issue.reference = italic("<empty string>");
        }
    }
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
                    ? `\n${yellow("possible fix" + (possible.length > 1 ? "es" : ""))}: ${
                        possible.map((match) => match).join(dim(", "))
                    }`
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
        case "inaccessible":
            return `${cyan(issue.reference)}\n${issue.reason}`;
        default:
            throw new Error("Invalid type of issue! This shouldn't be happening.");
    }
}
