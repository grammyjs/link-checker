import { HTMLDocument } from "./deps/deno_dom.ts";
import { MarkdownIt } from "./deps/markdown-it/mod.ts";
import { distance } from "./deps/jaro-winkler.ts";

import { getFetchWithRetries } from "./fetch.ts";
import type { MarkdownItToken } from "./types.ts";

const RETRY_FAILED_FETCH = true;
const MAX_RETRIES = 5;
const ID_TAGS = ["section", "h1", "h2", "h3", "h4", "h5", "h6", "div", "a"];
const MINIMUM_DISTANCE = 0.9;

export const fetchWithRetries = getFetchWithRetries(RETRY_FAILED_FETCH, MAX_RETRIES);

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

export function parseLink(href: string): { root: string; anchor?: string } {
  if (!URL.canParse(href)) { // looks like an local relative link
    const hashPos = href.lastIndexOf("#");
    if (hashPos === -1) return { root: href };
    return { root: href.substring(0, hashPos), anchor: decodeURIComponent(href.substring(hashPos + 1)) };
  }
  // not a relative link, hopefully external.
  const url = new URL(href);
  if (url.hash === "") return { root: url.href };
  const anchor = decodeURIComponent(url.hash.substring(1));
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

export function getPossibleMatches(anchor: string, allAnchors: Set<string>) {
  const matches: string[] = [];
  for (const possible of allAnchors) {
    const percent = distance(anchor.toLowerCase(), possible.toLowerCase());
    if (percent >= MINIMUM_DISTANCE) matches.push(possible);
  }
  return matches;
}

function getColumns(haystack: string, needle: string) {
  const indices: number[] = [];
  while (haystack.includes(needle)) {
    const length = indices.push(haystack.indexOf(needle) + 1);
    haystack = haystack.slice(indices[length - 1]);
  }
  return indices;
}

// little grep (my own impl.)
export async function findStringLocations(
  filepath: string,
  searchString: string,
): Promise<[line: number, columns: number[], text: string][]> {
  using file = await Deno.open(filepath, { read: true });
  let tempLine = "";
  let currentLine = 1;
  const locations: [line: number, columns: number[], text: string][] = [];
  const decoder = new TextDecoder();
  for await (const chunk of file.readable) {
    const decodedChunk = decoder.decode(chunk);
    const lines = decodedChunk.split("\n");
    tempLine += lines.shift();
    if (lines.length <= 1) continue;
    if (tempLine.includes(searchString)) {
      locations.push([currentLine, getColumns(tempLine, searchString), tempLine]);
    }
    currentLine += 1;
    tempLine = lines.pop()!;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(searchString)) {
        locations.push([currentLine, getColumns(line, searchString), line]);
      }
      currentLine += 1;
    }
  }
  return locations;
}

export function indentText(text: string, indentSize: number) {
  const indent = " ".repeat(indentSize);
  return text.includes("\n") ? text.split("\n").map((line) => indent + line).join("\n") : indent + text;
}
