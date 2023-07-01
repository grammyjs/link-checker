import { anchorPlugin, colors, DOMParser, extname, HTMLDocument, join, MarkdownIt, slugify } from "./deps.ts";
import {
  DenoModuleDocLink,
  GitHubRepositoryLink,
  GroupedLinks,
  Issue,
  MarkdownFile,
  MarkdownItToken,
  MissingAnchorIssue,
  ParsedMarkdown,
} from "./types.ts";
import { ACCEPTABLE_NOT_OK_STATUS, getRetryingFetch, isValidAnchor, isValidRedirection, transformURL } from "./fetch.ts";

const RETRY_FAILED_FETCH = true;
const MAX_RETRIES = 5;
const LIST_BULLET = "* ";
const ID_TAGS = ["section", "h1", "h2", "h3", "h4", "h5", "h6", "div", "a"];

/** MarkdownIt instance configured similar to VitePress */
const markdown = MarkdownIt({ html: true, linkify: true }).use(anchorPlugin, { slugify });
markdown.linkify.set({ fuzzyLink: false });
const domParser = new DOMParser();
const fetchWithRetries = getRetryingFetch(RETRY_FAILED_FETCH, MAX_RETRIES);
const { red, cyan, bold, dim, brightBlue, brightMagenta, yellow } = colors;

/** Parses given markdown content and returns links and anchors of the file */
function parseMarkdownContent(content: string): ParsedMarkdown | undefined {
  const html = markdown.render(content, {});
  const document = domParser.parseFromString(html, "text/html");
  if (document == null) return;
  const anchors = getAnchors(document, { includeHref: false });
  const tokens = markdown.parse(content, {});
  const links = filterLinksFromTokens(tokens);
  return { anchors, links };
}

/** Reads the file from filepath and parses it */
export async function parseMarkdownFile(filepath: string): Promise<MarkdownFile | undefined> {
  const content = await Deno.readTextFile(filepath);
  const parsed = parseMarkdownContent(content);
  if (parsed == null) return;

  const issues: Issue[] = [];
  const anchors = { all: parsed.anchors, used: new Set<string>() };
  const links = { external: new Set<string>(), local: new Set<string>() };

  for (const link of parsed.links) {
    if ((/^https?:/).test(link) && URL.canParse(link)) {
      links.external.add(link);
    } else if (link.startsWith(".")) {
      links.local.add(link);
    } else if (link.startsWith("#")) {
      anchors.used.add(link);
    } else {
      issues.push({ type: "unknown_link_format", reference: link });
    }
  }

  return { anchors, links, issues };
}

/** Filters links from tokenized markdown */
function filterLinksFromTokens(tokens: MarkdownItToken[]) {
  const links: string[] = [];
  for (const token of tokens) {
    if (token.type === "link_open") {
      const href = token.attrGet("href");
      if (href != null) links.push(href);
    }
    if (token.children != null) {
      links.push(...filterLinksFromTokens(token.children));
    }
  }
  return new Set(links);
}

/** Get anchors from the HTML document */
function getAnchors(
  document: HTMLDocument,
  opts: { includeHref: boolean } = { includeHref: true },
): Set<string> {
  const anchors: string[] = [];
  for (const tag of ID_TAGS) {
    const ids = document.getElementsByTagName(tag)
      .map((element) => element.getAttribute("id"))
      .filter((id) => id != null && id.trim() !== "") as string[];
    anchors.push(...ids);
  }
  return new Set([
    ...anchors,
    ...(opts.includeHref
      ? document.getElementsByTagName("a")
        .map((element) => element.getAttribute("href"))
        .filter((href) => href != null && href.startsWith("#") && href.length > 1)
        .map((href) => href!.substring(1))
      : []),
  ]);
}

/** Checks for relative link */
export async function checkRelativeLink(
  directory: string,
  link: string,
  options: { indexFile: string },
) {
  const hash = link.indexOf("#"); // Filepaths here shouldn't be containing '#'.
  let root = link.substring(0, hash == -1 ? undefined : hash);
  const anchor = hash == -1 ? null : link.substring(hash + 1);

  let isHtmlExtension = false;

  if (extname(root) === ".html") {
    isHtmlExtension = true;
    root = root.slice(0, -4) + "md";
  }
  if (extname(root) !== ".md") {
    if (!root.endsWith("/")) root += "/";
    root += options.indexFile;
  }

  const path = join(directory, root);
  try {
    await Deno.lstat(path);
    return { anchor, exists: true, isHtmlExtension, path };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { anchor, exists: false, isHtmlExtension, path };
    }
    throw error;
  }
}

/** Fetch an external webpage and collect all the anchors in it. */
export async function checkExternalLink(link: string) {
  const issues: Issue[] = [];

  const url = transformURL(link);
  console.log(brightBlue("fetch"), decodeURI(url));

  const response = await fetchWithRetries(url);
  if (response == null) return;

  if (response.redirected && !isValidRedirection(url, response.url)) {
    issues.push({ type: "redirected", from: link, to: response.url });
  }

  if (!response.ok && ACCEPTABLE_NOT_OK_STATUS[link] != response.status) {
    issues.push({ type: "not_ok_response", reference: link, status: response.status, statusText: response.statusText });
    console.error(red("not OK"), response.status, response.statusText);
  }

  const contentType = response.headers.get("content-type");
  if (contentType == null) {
    console.warn(brightMagenta("No Content-Type header was found in the response. Continuing anyway"));
  } else if (!contentType.includes("text/html")) {
    console.warn(brightMagenta(`Content-Type header is ${contentType}; continuing with HTML anyway`));
  }

  try {
    const content = await response.text();
    const document = domParser.parseFromString(content, "text/html");
    if (document == null) throw new Error("Failed to parse the webpage: skipping");
    const anchors = getAnchors(document, { includeHref: true });
    return { issues, anchors, document };
  } catch (error) {
    issues.push({ type: "empty_dom", reference: link });
    console.error(red("error:"), error);
    return { issues };
  }
}

/** Goes through all links and their anchors, and finds the missing ones. */
export function findMissingAnchors(
  allAnchors: Record<string, Set<string>>,
  usedAnchors: Record<string, Record<string, Set<string>>>,
): Record<string, MissingAnchorIssue[]> {
  const issues: Record<string, MissingAnchorIssue[]> = {};
  for (const link in usedAnchors) {
    const all = allAnchors[link] ?? new Set<string>();
    for (const fileWithAnchorMention in usedAnchors[link]) {
      for (const anchor of usedAnchors[link][fileWithAnchorMention]) {
        if (isValidAnchor(all, link, anchor)) continue;
        issues[fileWithAnchorMention] ??= [];
        issues[fileWithAnchorMention].push({ type: "missing_anchor", anchor, reference: link });
      }
    }
  }
  return issues;
}

export function isDenoModuleDocLink(url: URL): boolean {
  const pathSegments = url.pathname.split("/");
  return url.hostname === "deno.land" && pathSegments.length >= 4 &&
    (/^(x|std)$/.test(pathSegments[1])) && (/\.(t|j)s$/).test(pathSegments.at(-1)!);
}

function isGroupableGithubRepositoryLink(url: URL): boolean {
  const pathSegments = url.pathname.split("/");
  return url.hostname === "github.com" && (
    (pathSegments.length === 3 || (pathSegments.length === 4 && pathSegments.at(-1) === "")) ||
    ((pathSegments.length === 4 || (pathSegments.length === 5 && pathSegments.at(-1)! === "")) &&
      (pathSegments[3] === "pulls" || pathSegments[3] === "issues")) ||
    ((pathSegments[3] === "pull" || pathSegments[3] === "issues") && pathSegments[4] === "new")
  );
}

export function groupLinks(links: Set<string>): GroupedLinks {
  const denoModuleDoc: DenoModuleDocLink = {};
  const githubRepo: GitHubRepositoryLink = {};
  const otherLinks = new Set<string>();

  for (const link of links) {
    const url = new URL(link);
    if (isDenoModuleDocLink(url)) {
      const pathSegments = url.pathname.split("/");
      const moduleName = pathSegments.slice(0, 3).join("/");
      const filepath = pathSegments.slice(3).join("/");
      const symbolParam = url.searchParams.get("s");
      const anchor = url.hash.substring(1) === "" ? null : url.hash.substring(1);
      denoModuleDoc[moduleName] ??= {};
      denoModuleDoc[moduleName][filepath] ??= {
        symbols: new Set(),
        anchors: new Set(),
      };
      if (symbolParam != null) {
        denoModuleDoc[moduleName][filepath].symbols.add(symbolParam);
      }
      if (anchor != null) {
        denoModuleDoc[moduleName][filepath].anchors.add(anchor);
      }
    } else if (isGroupableGithubRepositoryLink(url)) {
      const pathSegments = url.pathname.split("/");
      const owner = pathSegments[1], repository = pathSegments[2];
      const anchor = url.hash === "#" ? null : url.hash.substring(1);
      githubRepo[owner] ??= {};
      githubRepo[owner][repository] ??= new Set();
      if (anchor != null) githubRepo[owner][repository].add(anchor);
    } else {
      otherLinks.add(link);
    }
  }

  return { denoModuleDoc, githubRepo, otherLinks };
}

export async function resolveDenoModuleDocLinks(links: DenoModuleDocLink) {
  const issues: Issue[] = [];
  const allAnchors: Record<string, Set<string>> = {};

  for (const modulePath in links) {
    for (const filepath in links[modulePath]) {
      const url = `https://deno.land${modulePath}/${filepath}`;
      const props = links[modulePath][filepath];
      const checkedLink = await checkExternalLink(url);
      if (checkedLink == null) {
        issues.push({ type: "no_response", reference: url });
        continue;
      }
      issues.push(...checkedLink.issues);
      if (checkedLink.anchors != null) {
        for (const anchor of props.anchors) {
          if (checkedLink.anchors.has(anchor)) continue;
          issues.push({ type: "missing_anchor", anchor, reference: url });
        }
      }
      if (checkedLink.document != null) {
        console.log(checkedLink.document.getElementsByTagName("a").map((e) => e.getAttribute("href")));
        const actualSymbols = new Set(
          (checkedLink.document.getElementsByTagName("a")
            .map((element) => element.getAttribute("href"))
            .filter((href) => href != null && URL.canParse(href)) as string[])
            .filter((href) => isDenoModuleDocLink(new URL(href)))
            .filter((href) => new URL(href).searchParams.get("s") === "Api")
            .map((href) => new URL(href).searchParams.get("s") as string),
        );
        for (const symbol of props.symbols) {
          if (actualSymbols.has(symbol)) continue;
          issues.push({ type: "unknown_symbol", reference: url, symbol });
        }
      }
    }
  }

  return { issues, allAnchors };
}

export async function resolveGithubLinks (links: GitHubRepositoryLink) {
  const issues: Issue[] = [];
  for (const owner in links) {
    for (const repo in links[owner]) {
      
    }
  }
}

function getReportMessage(issue: Issue): string {
  switch (issue.type) {
    case "unknown_link_format":
      return `The link ${cyan(issue.reference)} seems to be a unknown type of link.\n` +
        yellow("Please open an issue about this here: https://github.com/grammyjs/link-checker/issues/new.");
    case "empty_dom":
      return `The document at ${cyan(issue.reference)} can't seem to be properly parsed.`;
    case "not_ok_response":
      return `The link at ${cyan(issue.reference)} responded with a not OK status code ${red(`${issue.status}`)}.` +
        (issue.statusText ? ` It says "${issue.statusText}"` : "");
    case "wrong_extension":
      return `${cyan(issue.reference)} is ending with the extension ${yellow(issue.actual)} instead of ${
        yellow(issue.expected)
      }.`;
    case "linked_file_not_found":
      return `The linked file ${brightMagenta(issue.filepath)} does not exist.`;
    case "redirected":
      return `The link ${cyan(issue.from)} was redirected to ${cyan(issue.to)}.`;
    case "missing_anchor":
      return `The webpage at ${cyan(issue.reference)} doesn't seem to be have the anchor ${brightBlue(issue.anchor)}`;
    case "empty_anchor":
      return `The page ${cyan(issue.reference)} seems to be linked with an empty anchor.`;
    default:
      throw new Error("Invalid type of issue! This shouldn't be happening.");
  }
}

export function prepareReport(filepath: string, issues: Issue[]) {
  const header = bold(filepath) + ": " + red(`${issues.length} issue${issues.length > 1 ? "s" : ""}`);
  const list = issues.map((issue) => dim(LIST_BULLET) + getReportMessage(issue)).join("\n");
  return `${header}\n${list}\n`;
}
