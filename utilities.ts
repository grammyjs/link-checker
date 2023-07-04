import { anchorPlugin, colors, DOMParser, HTMLDocument, MarkdownIt, overwrite, slugify } from "./deps.ts";
import { ExternalLinkIssue, MarkdownItToken, ParsedMarkdown } from "./types.ts";
import { ACCEPTABLE_NOT_OK_STATUS, getRetryingFetch, isValidRedirection, transformURL } from "./fetch.ts";

const RETRY_FAILED_FETCH = true;
const MAX_RETRIES = 5;
const ID_TAGS = ["section", "h1", "h2", "h3", "h4", "h5", "h6", "div", "a"];

const markdown = MarkdownIt({ html: true, linkify: true }).use(anchorPlugin, { slugify });
markdown.linkify.set({ fuzzyLink: false });
const domParser = new DOMParser();
const fetchWithRetries = getRetryingFetch(RETRY_FAILED_FETCH, MAX_RETRIES);
const { red, brightMagenta } = colors;

export function parseMarkdownContent(content: string, options: { anchors: boolean }): ParsedMarkdown {
  const html = markdown.render(content, {});
  const tokens = markdown.parse(content, {});
  const links = filterLinksFromTokens(tokens);
  if (!options.anchors) return { links, anchors: new Set() };
  const document = domParser.parseFromString(html, "text/html")!;
  const anchors = getAnchors(document, { includeHref: false });
  return { anchors, links };
}

export function parseLink(href: string) {
  if (!URL.canParse(href)) { // looks like an local link
    const hashPos = href.lastIndexOf("#");
    if (hashPos === -1) return { root: href, anchor: undefined };
    return { root: href.substring(0, hashPos), anchor: href.substring(hashPos + 1) };
  }
  const url = new URL(href);
  const anchor = url.hash === "" ? undefined : url.hash.substring(1);
  url.hash = "";
  return { root: url.href, anchor };
}

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

export async function checkExternalLink(link: string) {
  const issues: ExternalLinkIssue[] = [];

  const url = transformURL(link);

  const response = await fetchWithRetries(url);
  if (response == null) return;

  if (response.redirected && !isValidRedirection(new URL(link), new URL(response.url))) {
    issues.push({ type: "redirected", from: link, to: response.url });
  }

  if (!response.ok && ACCEPTABLE_NOT_OK_STATUS[link] != response.status) {
    issues.push({ type: "not_ok_response", reference: link, status: response.status, statusText: response.statusText });
    overwrite(red("not OK"), response.status, response.statusText);
  }

  const contentType = response.headers.get("content-type");
  if (contentType == null) {
    overwrite(brightMagenta("No Content-Type header was found in the response. Continuing anyway"));
  } else if (!contentType.includes("text/html")) {
    overwrite(brightMagenta(`Content-Type header is ${contentType}; continuing with HTML anyway`));
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
