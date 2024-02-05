/**
 * There are some links that needs to be taken care in a different approach
 * rather than the general fetch & check. So, we first group such links and
 * resolve them as needed and finally store their issues and some other
 * details (to avoid re-fetching). Resolved results are saved to be re-used.
 *
 * Links that are currently considered special and grouped:
 *
 * - Renderable Github files written in Markdown, rsT, etc. including Directory
 *   README files.
 *
 * @module
 */

import { DOMParser } from "./deps/deno_dom.ts";
import { blue, yellow } from "./deps/std/fmt.ts";

import { ExternalLinkIssue } from "./types.ts";
import { fetchWithRetries, getAnchors, parseLink } from "./utilities.ts";

interface GroupedLinks {
  githubRenderableFiles: Set<GithubFileLink>;
  other: Set<string>;
}
export interface GroupedLinksResolved {
  githubRenderableFiles: GithubFiles; // repo -> branch -> filepath -> anchors
}

// === GROUP 1: GITHUB RENDERABLE FILE LINKS ===
//
// GitHub can show Markdown (.md), restructedText (.rst), etc. files rendered
// as HTML documents. If we have a link that links to such a file with an anchor
// it needs to be fetched in a different way, since normal fetch-response won't
// contain the actual rendered content as it is lazily loaded. Hence, it is not
// possible to check if such an anchor exists that way. So, we use Github's REST
// API (Content API) instead. This'll take care of directory README files as well.
//
// Types of links covered by this grouping:
// - github.com/OWNER/REPO/tree/dir/maybe-subdirs#anchor (Directory README)
// - github.com/OWNER/REPO/blob/maybe-dirs/license.rst (Renderable file)
//
// This OPTIONALLY requires a GitHub API token. Set it as the GITHUB_TOKEN
// environment variable. If the number of links are very less, you shouldn't
// worry about hitting rate limits. ceil(N=branches / 100) API calls per each
// repository for getting all branches, and one for each file mentioned.

const GITHUB_API_ROOT = "https://api.github.com";
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN");
if (GITHUB_TOKEN == null) {
  console.info(
    `\n┃ ${yellow("Gentle reminder")}: It is recommended to set the GITHUB_TOKEN environment variable
┃ if there are GitHub repository file links in the documents.\n`,
  );
}

interface GithubFileLink {
  repository: string;
  path: string;
  /** Original link referenced in the document */
  originalReference: string;
  /** Is the file a directory README file */
  isDirREADME: boolean;
}
type GithubFiles = Record<string, {
  allBranches: string[];
  anchors: Record<string, Record<string, Set<string>>>;
  issues: Record<string, Record<string, ExternalLinkIssue[]>>;
  // structure:  branch ------> file -> anchors
}>;

// "tree" is the key
export function isGithubReadmeWithAnchorUrl(url: URL) {
  if (url.hostname !== "github.com" || url.hash.length < 2) return false; // fast path
  if (url.hash === "#readme") return true;
  const segments = url.pathname.split("/");
  if (segments.at(-1) === "") segments.pop();
  return segments.length === 3 || (segments[3] === "tree" && segments.length >= 5);
}

// "blob" is the key
function isGithubRenderableFileWithAnchorUrl(url: URL) {
  if (url.hostname !== "github.com") return false; // fast path
  const segments = url.pathname.split("/");
  if (segments.at(-1) === "") segments.pop();
  return url.hash.length > 1 && segments[3] === "blob" && segments.length > 5;
}

function parseGithubUrl(url: URL) {
  const segments = url.pathname.split("/");
  while (segments.at(-1)?.trim() === "") segments.pop();
  const repository = segments.slice(1, 3).join("/");
  const path = segments.length === 3 ? "" : segments.slice(4).join("/");
  return { repository, path };
}

function parseGithubFilepathWithBranch(path: string, branches: string[]) {
  let finalSegments: string[] = [];
  const sortedBranches = branches.sort((b0, b1) => b0.localeCompare(b1));
  for (const branch of sortedBranches) {
    const branchSegs = branch.split("/");
    const pathSegs = path.split("/");
    const currentSegs: string[] = [];
    for (let i = 0; i < branchSegs.length; i++) {
      if (branchSegs[i] !== pathSegs[i]) continue;
      currentSegs.push(branchSegs[i]);
    }
    if (branchSegs.length === currentSegs.length) finalSegments = currentSegs;
  }
  const branch = finalSegments.length > 0 ? finalSegments.join("/") : undefined;
  const filepath = path.slice(branch ? branch.length + 1 : 0);
  return { branch, filepath };
}

async function getBranches(repo: string) {
  let page = 1, continueFetching = true;
  const branchNames: string[] = [];
  do {
    const query = `GET /repos/${repo}/branches?per_page=100&page=${page++}`;
    const branches = await makeGithubAPIRequest<Array<{ name: string }>>(query) ?? [];
    branchNames.push(...branches.map((branch) => branch.name));
    if (branches.length < 100) continueFetching = false;
  } while (continueFetching);
  return branchNames;
}

function getREADME(repo: string, path: string, branch: string) {
  return makeGithubAPIRequest<string>(
    `GET /repos/${repo}/readme/${path}${branch !== "" ? `?ref=${branch}` : ""}`,
    "application/vnd.github.html",
  );
}

function getRenderedGithubFile(repo: string, path: string, branch: string) {
  return makeGithubAPIRequest<string>(
    `GET /repos/${repo}/contents/${path}${branch !== "" ? `?ref=${branch}` : ""}`,
    "application/vnd.github.html",
  );
}

async function makeGithubAPIRequest<T>(query: string, mediaType = "application/vnd.github+json") {
  const [method, ...path] = query.split(" ");
  const url = GITHUB_API_ROOT + path.join(" ");
  const headers = new Headers({ "Accept": mediaType, "X-GitHub-Api-Version": "2022-11-28" });
  if (GITHUB_TOKEN != null) headers.set("Authorization", `Bearer ${GITHUB_TOKEN}`);
  const { response } = await fetchWithRetries(url, { method, headers });
  if (response == null || response.status === 404) return undefined;
  if (!response.ok) throw new Error(response.statusText);
  return (mediaType === "application/vnd.github.html" ? response.text() : response.json()) as T;
}

export function groupLinks(urls: Set<string>): GroupedLinks {
  const githubRenderableFiles = new Set<GithubFileLink>();
  const other = new Set<string>();

  for (const href of urls) {
    const url = new URL(href);
    if (isGithubReadmeWithAnchorUrl(url)) {
      githubRenderableFiles.add({
        ...parseGithubUrl(url),
        originalReference: href,
        isDirREADME: true,
      });
    } else if (isGithubRenderableFileWithAnchorUrl(url)) {
      githubRenderableFiles.add({
        ...parseGithubUrl(url),
        originalReference: href,
        isDirREADME: false,
      });
    } else {
      other.add(href);
    }
  }

  return { githubRenderableFiles, other };
}

export async function resolveGroupedLinks(
  links: GroupedLinks,
  resolved: GroupedLinksResolved,
  utils: { domParser: DOMParser },
) {
  // ==== Github Renderable files ====
  for (const { repository, path, originalReference, isDirREADME } of links.githubRenderableFiles) {
    const { root: reference, anchor } = parseLink(originalReference);
    console.log(blue("fetch"), decodeURIComponent(originalReference));

    if (anchor === "#readme" && isDirREADME) continue; // fast path
    console.log("It's a renderable Github file with an anchor. Resolving using Github API...");

    if (!(repository in resolved.githubRenderableFiles)) {
      const allBranches = await getBranches(repository);
      resolved.githubRenderableFiles[repository] = { allBranches, anchors: {}, issues: {} };
    }
    const branches = resolved.githubRenderableFiles[repository].allBranches;
    const { filepath, branch = "" } = parseGithubFilepathWithBranch(path, branches);

    resolved.githubRenderableFiles[repository].issues[branch] ??= {};
    resolved.githubRenderableFiles[repository].issues[branch][filepath] ??= [];

    // If its an already fetched file
    const anchors = resolved.githubRenderableFiles[repository].anchors[branch]?.[filepath];

    if (anchor != null && anchors != null && !anchors.has(anchor)) {
      resolved.githubRenderableFiles[repository].issues[branch][filepath].push(
        { type: "missing_anchor", reference, anchor },
      );
      continue;
    }

    // Haven't been fetched before. Manage that:
    const readme = isDirREADME
      ? await getREADME(repository, filepath, branch)
      : await getRenderedGithubFile(repository, filepath, branch);
    if (readme == null) {
      resolved.githubRenderableFiles[repository].issues[branch][filepath]
        .push({ type: "not_ok_response", status: 404, reference, statusText: "Not found" });
      continue;
    }
    const document = utils.domParser.parseFromString(readme, "text/html");
    if (document == null) {
      resolved.githubRenderableFiles[repository].issues[branch][filepath]
        .push({ type: "empty_dom", reference });
      continue;
    }

    const allAnchors = getAnchors(document, { includeHref: true });
    if (anchor != null && !allAnchors.has(anchor)) {
      resolved.githubRenderableFiles[repository].issues[branch][filepath]
        .push({ type: "missing_anchor", reference, anchor });
    }

    resolved.githubRenderableFiles[repository].anchors[branch] ??= {};
    resolved.githubRenderableFiles[repository].anchors[branch][filepath] = allAnchors;
  }
}

export function findGroupedLinksIssues(grouped: GroupedLinks, resolved: GroupedLinksResolved) {
  const issues: ExternalLinkIssue[] = [];
  for (const { repository, path } of grouped.githubRenderableFiles) {
    const repoDetails = resolved.githubRenderableFiles[repository];
    const { filepath, branch = "" } = parseGithubFilepathWithBranch(path, repoDetails.allBranches);
    issues.push(...repoDetails.issues[branch][filepath]);
  }
  return issues;
}

// TODO
// GROUP 2: DENO MODULE SYMBOLS
//
// A Deno module documentation has links under the https://deno.land website has
// links like the following, which points to a page with the Symbol with additional
// details and properties of that specific symbol. (An exported member of the module).
//
// Example: https://deno.land/x/grammy/mod.ts?s=Api#method_sendmessage_0
//
// In the documentation and such, there are a lot of such symbol links, mostly of
// the core modules owned by the grammY organization (e.g.: https://deno.land/x/grammy).
// By re-using the deno_doc module to generate similar results as in /x, it is possible
// to obtain the list of exported symbols and their properties (linked via anchor).
// But, instead of setting up all that, we can use Deno Registry HTTP API hosted at
// https://apiland.deno.dev to do fetch the Doc Nodes and cook the list ourselves.

// TODO need to check if its worth it and fixate on how.
