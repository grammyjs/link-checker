import { yellow } from "./deps/std/fmt.ts";
import { equal } from "./deps/std/assert.ts";

import { findStringLocations } from "./utilities.ts";
import { Issue, IssueWithStack } from "./types.ts";
import { SEARCH_PANIC_MESSAGE } from "./constants.ts";

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
                const stack = issue.filepaths.sort((a, b) => a.localeCompare(b)).map(async (filepath) => {
                    const locations = await findStringLocations(filepath, getSearchString(issue.details));
                    if (locations.length == 0) {
                        console.error(filepath, getSearchString(issue.details), issue);
                        console.error(yellow(SEARCH_PANIC_MESSAGE));
                    }
                    return { filepath, locations: locations.map(([line, columns]) => ({ line, columns })) };
                });
                return { ...issue.details, stack: await Promise.all(stack) };
            }),
    )).reduce((grouped, issue) => {
        grouped[issue.type] ??= [];
        grouped[issue.type].push(issue);
        return grouped;
    }, {} as Record<Issue["type"], IssueWithStack[]>);
}
