import { colors, type HTMLDocument } from "./deps.ts";
import type { FetchOptions, MarkdownItToken } from "./types.ts";

const VALID_REDIRECTIONS: Record<string, string> = {
  "https://localtunnel.me": "https://theboroer.github.io/localtunnel-www/",
};

export function warn(text: string) {
  console.warn(`%cWARN%c ${text}`, "color: yellow", "color: none");
}

export const log = console.log;

// deno-fmt-ignore
const ID_TAGS = ["section", "h1", "h2", "h3", "h4", "h5", "h6", "div", "a"];

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
        .filter((href) => {
          return href != null && href.startsWith("#") && href.length > 1;
        }).map((href) => href!.substring(1))
      : []),
  ]);
}

// Transform the URL (if needed), before fetching
export function transformURL(url: string) {
  if (url.includes("://t.me/")) { // Some ISPs have blocked t.me
    warn("Changing t.me to telegram.me for convenience");
    url = url.replace("://t.me/", "://telegram.me/");
  }
  return url;
}

const FETCH_OPTIONS: FetchOptions = {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/113.0",
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Pragma": "no-cache",
    "Cache-Control": "no-cache",
  },
  method: "GET",
  mode: "cors",
};

export function getRetryingFetch(
  RETRY_FAILED_FETCH: boolean,
  MAX_RETRIES: number,
) {
  return async function (url: string) {
    let retries = 0;
    let response: Response | undefined;
    // deno-lint-ignore no-explicit-any
    let error: any;
    do {
      try {
        response = await fetch(url, FETCH_OPTIONS);
      } catch (err) {
        error = err;
        if (!RETRY_FAILED_FETCH) break;
        log(colors.magenta("INFO"), `Retrying (${retries + 1})`);
      }
      retries++;
    } while (retries < MAX_RETRIES && response == null);
    if (response == null) {
      log(colors.red("ERROR"), "Couldn't get a proper response");
      console.error(error);
    }
    return response;
  };
}

/** Some redirections are okay, so we ignore those changes */
export function isValidRedirection(from: string, to: string) {
  if (VALID_REDIRECTIONS[from] === to) return true;

  const general = (from: string, to: string) => (
    (from === to) || // for www's and https's general calls.
    (
      // CASE 1:
      from.includes("deno.land/x/") && // a third-party module
      !from.includes("@") && // supposed to be redirected to the latest version
      to.includes("@") // and it does get redirected
    ) ||
    (
      // CASE 2:
      from.includes("deno.com/manual/") && // deno manual link: supposed to be redirected to the latest
      to.includes("@") // and does get redirected to the latest.
    ) ||
    // CASE 3: short youtu.be links redirecting to youtube.com links.
    to.includes(from.replace(new URL(from).origin + "/", "?v=")) ||
    // CASE 4: maybe a slash was removed or added --> I don't think we should care.
    ((to + "/" == from) || (from + "/" == to)) ||
    // CASE 5: maybe some search params was appended --> like a language code?
    to.includes(from + "?") || to.includes(from.split("#")[0] + "?") ||
    // CASE 6: Login redirections; e.g., firebase console -> google login
    ((to.includes("accounts.google.com") && to.includes("signin")) || // Google
      (to.includes("github.com/login?return_to="))) // Github
  );

  // added a www to the domain and any of the above.
  const www = !from.includes("://www.") && to.includes("://www.") &&
    general(from.replace("://", "://www."), to);

  // we wrote as http:// but was redirected to https --> I think thats ignorable?
  const https = from.startsWith("http://") && to.startsWith("https://") &&
    general(from.replace("http://", "https://"), to);

  return general(from, to) || www || https;
}

/* Some anchors might be missing due to how the content is loaded in the website */
export function isValidAnchor(root: string, all: Set<string>, anchor: string) {
  if (root.includes("firebase.google.com/docs")) {
    // firebase (generally google) docs sometimes messes up the response
    // from the fetch as the contents are lazy loaded. the following is a hack:
    return all.has(anchor + "_1") || all.has(decodeURIComponent(anchor) + "_1");
  }
  return false;
}

export function filterLinksFromTokens(tokens: MarkdownItToken[]) {
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
  return links;
}
