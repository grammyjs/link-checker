import { globToRegExp } from "./deps/std/path.ts";

export const FIXABLE_ISSUE_TYPES = ["redirected", "missing_anchor", "empty_anchor", "wrong_extension", "disallow_extension"];

export const ISSUE_TYPES = [
    "unknown_link_format",
    "empty_dom",
    "empty_anchor",
    "no_response",
    "not_ok_response",
    "disallow_extension",
    "wrong_extension",
    "linked_file_not_found",
    "redirected",
    "missing_anchor",
    "missing_github_comment",
    "local_alt_available",
    "inaccessible",
] as const;

type IssueType = (typeof ISSUE_TYPES)[number];

export const WARNING_ISSUE_TYPES: IssueType[] = [
    "inaccessible",
];

export const ACCEPTABLE_NOT_OK_STATUS: Record<string, number> = {
    "https://dash.cloudflare.com/login": 403,
    "https://dash.cloudflare.com/?account=workers": 403,
    "https://api.telegram.org/file/bot": 404,
};

export const VALID_REDIRECTIONS: Record<string, string> = {
    "https://localtunnel.me/": "https://theboroer.github.io/localtunnel-www/",
    "https://nodejs.org/": "https://nodejs.org/en",
    "https://api.telegram.org/": "https://core.telegram.org/bots",
    "https://telegram.me/name-of-your-bot?start=custom-payload": "https://telegram.org/",
    "http://telegram.me/addstickers/": "https://telegram.org/",
};

export const MANUAL_REDIRECTIONS: string[] = [
    "https://accounts.google.com/signup",
];

/** Websites protected by Cloudflare's DDos Protection Services */
export const CLOUDFLARE_PROTECTED_HOSTNAMES = [
    "*.cloudflare.com",
    // "www.scaleway.com",
].map((origin) => globToRegExp(origin));

export const FETCH_OPTIONS = {
    method: "GET",
    mode: "cors",
} as const;

export const DEFAULT_GITHUB_API_ROOT = "https://api.github.com";

export const SEARCH_PANIC_MESSAGE = `\
====================================================================================
PANIC. This shouldn't be happening. The search strings are supposed to have at least
one occurrence in the corresponding file. Please report this issue with enough
information and context at: https://github.com/grammyjs/link-checker/issues/new.
====================================================================================`;

export const IGNORED_DIRECTORIES: string[] = [
    "node_modules", // avoiding potential node_modules
];

export const ISSUE_TITLES: Record<IssueType, string> = {
    empty_dom: "Empty DOM content",
    redirected: "Redirections",
    no_response: "Empty responses",
    empty_anchor: "Empty anchors",
    missing_anchor: "Missing anchors",
    missing_github_comment: "Missing GitHub comments",
    not_ok_response: "Non-OK responses",
    wrong_extension: "Wrong extensions",
    disallow_extension: "Disallowed extensions",
    unknown_link_format: "Unknown link type",
    linked_file_not_found: "Missing files",
    local_alt_available: "Local alternative available",
    inaccessible: "Inaccessible website",
};

export const ISSUE_DESCRIPTIONS: Record<IssueType, string> = {
    unknown_link_format: `\
The links highlighted in red seems to be an invalid type of link. Please check the source
files and correct the hyperlinks involved. If you think this was a mistake, please open
an issue over about this here: https://github.com/grammyjs/link-checker/issues/new.`,
    empty_dom: `\
The HTML document returned by the request couldn't be parsed properly by the HTML parser used.
Either the request returned nothing, or it was an invalid type of content. This issue must be
investigated and the links should be updated accordingly.`,
    not_ok_response: `\
The following highlighted links returned documents with non-OK response status codes.
The corresponding non-OK status codes are provided with them.`,
    wrong_extension: `\
Local relative links to another file shouldn't be ending with an extension as configured.
All links that doesn't follow this strict limit is listed below.`,
    linked_file_not_found: `The files linked do not exist at the given paths.`,
    redirected: `The links were redirected to a newer page or some other page according to the responses.`,
    missing_anchor: `Some links were pinned with an anchor. But the linked document doesn't have such an anchor.`,
    missing_github_comment:
        `Some links reference a specific GitHub issue comment by its anchor (issuecomment-<id>). That comment no longer exists or is not returned by the GitHub API. Update or remove these links.`,
    empty_anchor: `Restricts linking pages with no anchor destination. In other words, just '#'.`,
    no_response: `\
The following links does not return any response (probably timed out). This could be a
network issue, an internal server issue, or the page doesn't exist at all for some reason.`,
    disallow_extension: `\
Some local files seems to be linked with extension, and the use of extensions while linking
local documents is prohibited. Remove the following extensions.`,
    local_alt_available: `\
There are local alternatives available for the following links, and they should be replaced
with the local alternatives.`,
    inaccessible: `\
The external link is inaccessible to the tool. It is advised to check out the site manually
and take actions if necessary.`,
};
