import { DOMParser, HTMLDocument } from "./deps/deno_dom.ts";
import { magenta, red } from "./deps/std/fmt.ts";
import { MarkdownIt } from "./deps/markdown-it/mod.ts";

import { ACCEPTABLE_NOT_OK_STATUS, getRetryingFetch, isValidRedirection, transformURL } from "./fetch.ts";
import type { ExternalLinkIssue, MarkdownItToken } from "./types.ts";

const RETRY_FAILED_FETCH = true;
const MAX_RETRIES = 5;
const ID_TAGS = ["section", "h1", "h2", "h3", "h4", "h5", "h6", "div", "a"];

export const fetchWithRetries = getRetryingFetch(RETRY_FAILED_FETCH, MAX_RETRIES);

export function parseMarkdownContent(mdit: MarkdownIt, content: string) {
  const html = mdit.render(content, {});
  const tokens = mdit.parse(content, {});
  const links = filterLinksFromTokens(tokens);
  return { links, html };
}

export function getAnchors(
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

export async function checkExternalUrl(url: string, utils: { domParser: DOMParser }) {
  const issues: ExternalLinkIssue[] = [];

  const transformed = transformURL(url);

  const response = await fetchWithRetries(transformed);
  if (response == null) {
    issues.push({ type: "no_response", reference: transformed });
    return { issues };
  }

  if (response.redirected && !isValidRedirection(new URL(transformed), new URL(response.url))) {
    issues.push({ type: "redirected", from: transformed, to: response.url });
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
    return { issues, anchors, document };
  } catch (error) {
    issues.push({ type: "empty_dom", reference: url });
    console.error(red("error:"), error);
    return { issues };
  }
}
