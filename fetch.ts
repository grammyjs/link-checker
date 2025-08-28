import { CLOUDFLARE_PROTECTED_HOSTNAMES } from "./constants.ts";
import { ACCEPTABLE_NOT_OK_STATUS, MANUAL_REDIRECTIONS, VALID_REDIRECTIONS } from "./constants.ts";
import { DOMParser } from "./deps/deno_dom.ts";
import { blue, bold, magenta, red } from "./deps/std/fmt.ts";

import { ExternalLinkIssue, FetchOptions, type ResponseInfo } from "./types.ts";
import { fetchWithRetries, getAnchors, sleep } from "./utilities.ts";

export function getFetchWithRetries(retryOnFail: boolean, maxRetries: number, fetchOptions: FetchOptions) {
    return async function (url: string, options = fetchOptions): Promise<ResponseInfo> {
        let retries = 0;
        const retryDelay = 3_000;
        const timeout = 30_000;

        const info: ResponseInfo = { redirected: false, redirectedUrl: "" };
        let error: unknown;

        do {
            if (retries > 0) {
                console.log(`Retrying (${retries}) after ${retryDelay}ms`);
                await sleep(retryDelay);
            }

            try {
                const signal = AbortSignal.timeout(timeout);
                if (MANUAL_REDIRECTIONS.includes(url)) {
                    info.response = await fetch(url, { ...options, signal, redirect: "manual" });
                    info.redirected = info.response.status >= 300 && info.response.status < 400; // to make sure
                    const locationHeader = info.response.headers.get("Location");
                    info.redirectedUrl = info.redirected && locationHeader != null ? locationHeader : info.response.url;
                } else {
                    info.response = await fetch(url, { ...options, signal });
                    info.redirected = info.response.redirected;
                    info.redirectedUrl = info.response.url;
                }
            } catch (err) {
                error = err;
                if (!retryOnFail || !(err instanceof Error)) break;
                if (err.name === "TimeoutError") console.error(`Timeout of ${timeout}ms reached`);
            }

            // Retry only if there is not response and if the request naturally
            // timed out or if its Internal Server Errors (5xx).
            if (
                retries <= maxRetries && info.response != null &&
                (info.response.status === 408 || info.response.status >= 500)
            ) info.response = null; // to satisfy the condition for retrying.
        } while (retries++ < maxRetries && info.response == null);

        if (info.response == null) {
            console.error("Couldn't get a proper response");
            console.error(error);
        }

        return info;
    };
}

export function transformURL(link: string) {
    const url = new URL(link);
    if (url.hostname === "t.me") { // Some ISPs have blocked t.me
        url.hostname = "telegram.me";
    }
    return url.toString();
}

/** Some redirections are okay, so we ignore those changes */
export function isValidRedirection(from: URL, to: URL) {
    // --- Known cases ---
    if (VALID_REDIRECTIONS[from.href] === to.href) return true;

    // --- General cases ---

    const general = (from: URL, to: URL) => {
        const segments = { from: from.pathname.split("/"), to: to.pathname.split("/") };
        return (
            // For www and https checks' general calls.
            (from.href === to.href) ||
            // A third-party Deno module, supposed to be redirected to the latest
            // version, and it does get redirected to the latest version.
            (from.hostname === "deno.land" && to.hostname === "deno.land" &&
                (
                    (from.pathname.startsWith("/x/") && segments.from[2] != null && !segments.from[2].includes("@") &&
                        to.pathname.startsWith("/x/") && segments.to[2] != null && segments.to[2].includes("@")) ||
                    (from.pathname.startsWith("/std/") && to.pathname.startsWith("/std@"))
                )) ||
            // Shortened https://youtu.be/{id} links redirecting to https://youtube.com/watch?v={id} links.
            (from.hostname === "youtu.be" && to.hostname === "www.youtube.com" && to.pathname === "/watch" &&
                to.searchParams.get("v") === from.pathname.substring(1)) ||
            // Maybe some search params was appended: like a language code or something.
            (from.host === to.host && from.pathname === to.pathname && from.searchParams.size !== to.searchParams.size) ||
            // Login redirections; e.g., Firebase Console -> Google Account Login
            (
                (to.hostname === "accounts.google.com" && (segments.to.includes("signin") || segments.to.includes("signup"))) || // Google
                (to.hostname === "github.com" && to.pathname.startsWith("/login")) // Github
            )
        );
    };

    // --- Special Cases ---

    // (1) Added a www to the domain and any of the above. It's okay I guess.
    const www = from.host.replace(/^/, "www.") === to.host &&
        general(new URL(from.href.replace("://", "://www.")), to);

    // (2) Protocol changed to "https" from "http": (I think thats ignorable?)
    const https = from.protocol === "http:" && to.protocol === "https:" &&
        general(new URL(from.href.replace("http", "https")), to);

    return general(from, to) || www || https;
}

/** Some anchors might be missing due to how the content is loaded in the website */
export function isValidAnchor(all: Set<string>, url: string, anchor: string) {
    const decodedAnchor = decodeURIComponent(anchor);
    if (all.has(anchor) || all.has(decodedAnchor)) return true;
    if (!URL.canParse(url)) return false; // Has to be a local URL.

    const { hostname, pathname } = new URL(url);

    // Firebase's (generally Google's) Documentation sometimes messes up the HTML response
    // from the fetch as the contents are lazy loaded. So, the following is a hack (not reliable):
    if (hostname === "firebase.google.com" && pathname.startsWith("/docs")) {
        for (let i = 1; i < 10; i++) { // It doesn't go up to 10 usually.
            const suffix = "_" + i;
            if (all.has(anchor + suffix) || all.has(decodedAnchor + suffix)) {
                return true;
            }
        }
    }

    return false;
}

function isProtectedByCloudflare(response: Response) {
    return response.status === 403 && (response.headers.has("cf-ray") || response.headers.has("cf-mitigated") ||
        response.headers.get("server") === "cloudflare");
}

const knownProtectionMemo = new Map<string, boolean>();

function isCloudlfareProtectionKnown(hostname: string) {
    const cached = knownProtectionMemo.get(hostname);
    if (cached != null) return cached;
    const isKnown = CLOUDFLARE_PROTECTED_HOSTNAMES
        .some((rule) => rule.test(hostname));
    knownProtectionMemo.set(hostname, isKnown);
    return isKnown;
}

// Octokit instance injected by caller (optional). We avoid hard dependency so library users aren't forced to provide it.
let _octokit: unknown | undefined;
export function setOctokit(octokit: unknown) {
    _octokit = octokit;
}

async function getGithubIssueCommentAnchors(owner: string, repo: string, issueNumber: number) {
    if (
        _octokit == null || typeof _octokit !== "object" || _octokit === null ||
        typeof (_octokit as { request?: unknown }).request !== "function"
    ) {
        throw new TypeError("setOctokit has not been called with a valid value");
    }
    try {
        console.log(blue("listing"), `${owner}/${repo}#${issueNumber}`);
        const res = await (_octokit as {
            request: (route: string, params: Record<string, unknown>) => Promise<{ status: number; data: { id?: number }[] }>;
        }).request("GET /repos/{owner}/{repo}/issues/{issue_number}/comments", {
            owner,
            repo,
            issue_number: issueNumber,
            per_page: 100,
        });
        if (res.status !== 200) return { anchors: new Set<string>(), comments: new Set<string>() };
        const anchors = new Set<string>();
        const comments = new Set<string>();
        for (const comment of res.data) {
            // Anchor format used by GitHub for issue comments: issuecomment-<id>
            if (comment.id != null) {
                const anchor = `issuecomment-${comment.id}`;
                anchors.add(anchor);
                comments.add(String(comment.id));
            }
        }
        return { anchors, comments };
    } catch (_err) {
        // Silently ignore API failures; fall back to normal behavior.
        return { anchors: new Set<string>(), comments: new Set<string>() };
    }
}

export async function checkExternalUrl(url: string, utils: { domParser: DOMParser }) {
    const issues: ExternalLinkIssue[] = [];
    const transformed = transformURL(url);
    const headers = new Headers({ "Accept": "text/html" });
    const { response, redirected, redirectedUrl } = await fetchWithRetries(transformed, { headers });

    if (response == null) {
        issues.push({ type: "no_response", reference: url });
        return { issues };
    }

    const { hostname } = new URL(url);
    if (isProtectedByCloudflare(response)) {
        issues.push({
            type: "inaccessible",
            reference: url,
            reason: "The website is protected by Cloudflare DDoS Protection Services." +
                (!isCloudlfareProtectionKnown(hostname)
                    ? ` \
The site seems to satisfy the checks for a site with Cloudflare DDoS Protection Services enabled, but the site ${bold(hostname)} \
isn't included in the list of acknowledged Cloudflare protected list. Please add this to the list by opening a pull request.`
                    : ""),
        });
        return { issues };
    }
    // else if (isCloudflareProtectionKnown(hostname))
    // No signs of cloudflare protection but still included in the list.
    // And since its accessible now, and can be checked, don't return rn,
    // or make an issue as this is probably covered by a wildcard.

    if (redirected && MANUAL_REDIRECTIONS.includes(transformed)) {
        return { issues };
    }

    if (redirected && !isValidRedirection(new URL(transformed), new URL(redirectedUrl))) {
        issues.push({ type: "redirected", from: url, to: response.url });
    }

    if (!response.ok && ACCEPTABLE_NOT_OK_STATUS[url] !== response.status) {
        issues.push({ type: "not_ok_response", reference: url, status: response.status, statusText: response.statusText });
        console.log(red("not OK"), response.status, response.statusText);
        return { issues };
    }

    const contentType = response.headers.get("content-type");
    if (contentType == null) {
        console.log(magenta("No Content-Type header was found in the response. Continuing anyway"));
    } else if (!contentType.includes("text/html")) {
        console.log(magenta(`Content-Type header is ${contentType}; continuing with HTML anyway`));
    }

    try {
        const content = await response.text();
        const document = utils.domParser.parseFromString(content, "text/html");
        if (document == null) throw new Error("Failed to parse the webpage: skipping");
        const anchors = getAnchors(document, { includeHref: true });

        // GitHub issue comment support: if URL points to /{owner}/{repo}/issues/{number}
        // augment anchors with issuecomment-<id> list from API so we can verify anchors referencing comments.
        // Pattern: https://github.com/:owner/:repo/issues/:number
        try {
            const gh = new URL(url);
            if (gh.hostname === "github.com") {
                const parts = gh.pathname.split("/").filter(Boolean); // [owner, repo, 'issues', number]
                if (parts.length >= 4 && parts[2] === "issues" && /^\d+$/.test(parts[3])) {
                    const issueNumber = Number(parts[3]);
                    const { anchors: commentAnchors } = await getGithubIssueCommentAnchors(parts[0], parts[1], issueNumber);
                    // Merge anchor sets
                    if (commentAnchors.size > 0) {
                        for (const a of commentAnchors) anchors.add(a);
                    }
                }
            }
        } catch { /* ignore */ }

        return { issues, anchors, document };
    } catch (error) {
        issues.push({ type: "empty_dom", reference: url });
        console.error(red("error:"), error);
        return { issues };
    }
}
