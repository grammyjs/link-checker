import { ExternalLinkIssue } from "./types.ts";

export const ACCEPTABLE_NOT_OK_STATUS: Record<string, number> = {
  "https://dash.cloudflare.com/login": 403,
  "https://dash.cloudflare.com/?account=workers": 403,
  "https://api.telegram.org/file/bot": 404,
};

const VALID_REDIRECTIONS: Record<string, string> = {
  "https://localtunnel.me/": "https://theboroer.github.io/localtunnel-www/",
  "https://nodejs.org/": "https://nodejs.org/en",
  "https://api.telegram.org/": "https://core.telegram.org/bots",
  "https://telegram.me/name-of-your-bot?start=custom-payload": "https://telegram.org/",
  "http://telegram.me/addstickers/": "https://telegram.org/",
};

const FETCH_OPTIONS: Parameters<typeof fetch>[1] = {
  method: "GET",
  headers: {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/113.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Pragma": "no-cache",
    "Cache-Control": "no-cache",
  },
  mode: "cors",
};

export function getRetryingFetch(
  RETRY_FAILED_FETCH: boolean,
  MAX_RETRIES: number,
) {
  return async function (url: string) {
    let retries = 0;
    let response: Response | undefined;
    let error: unknown;
    do {
      try {
        response = await fetch(url, FETCH_OPTIONS);
      } catch (err) {
        error = err;
        if (!RETRY_FAILED_FETCH) break;
        console.log(`Retrying (${retries + 1})`);
      }
      retries++;
    } while (retries < MAX_RETRIES && response == null);
    if (response == null) {
      console.error("Couldn't get a proper response");
      console.error(error);
    }
    return response;
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
      // (0) For www and https checks' general calls.
      (from.href === to.href) ||
      // (1) A third-party Deno module, supposed to be redirected to the latest
      // version, and it does get redirected to the latest version.
      (from.hostname === "deno.land" && to.hostname === "deno.land" &&
        (
          (from.pathname.startsWith("/x/") && segments.from[2] != null && !segments.from[2].includes("@") &&
            to.pathname.startsWith("/x/") && segments.to[2] != null && segments.to[2].includes("@")) ||
          (from.pathname.startsWith("/std/") && to.pathname.startsWith("/std@"))
        )) ||
      // (2) A link to Deno Manual, and it is supposed to be redirected to the
      // latest version. And it does get redirected!
      (from.hostname === "deno.com" && from.pathname.startsWith("/manual/") &&
        to.hostname === "deno.com" && to.pathname.startsWith("/manual@")) ||
      // (3) Shortened https://youtu.be/{id} links redirecting to https://youtube.com/watch?v={id} links.
      (from.hostname === "youtu.be" && to.hostname === "www.youtube.com" && to.pathname === "/watch" &&
        to.searchParams.get("v") === from.pathname.substring(1)) ||
      // (4) Simply a slash was removed or added (I don't think we should care).
      (from.host === to.host && ((to.pathname + "/" === from.pathname) || (from.pathname + "/" === to.pathname))) ||
      // (5) Maybe some search params was appended: like a language code or something.
      (from.host === to.host && from.pathname === to.pathname && from.searchParams.size !== to.searchParams.size) ||
      // (6) Login redirections; e.g., Firebase Console -> Google Account Login
      (
        (to.hostname === "accounts.google.com" && segments.to[2] === "signin") || // Google
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
  if (!URL.canParse(url)) return true; // Has to be a local URL.

  const { hostname, pathname } = new URL(url);
  if (hostname === "firebase.google.com" && pathname.startsWith("/docs")) {
    // Firebase's (generally Google's) Documentation sometimes messes up the HTML response
    // from the fetch as the contents are lazy loaded. So, the following is a hack: (not reliable)
    return all.has(anchor + "_1") || all.has(decodedAnchor + "_1");
  }
  return false;
}

export async function getREADME(link: string, path = "", branch?: string) {
  const pathSegments = new URL(link).pathname.split("/");
  const repo = pathSegments.slice(1, 3);


  const issues: ExternalLinkIssue[] = [];

  const url = new URL(`/repos/${repo}/readme/${path}`, "https://api.github.com");
  const headers = new Headers({ "Accept": "application/vnd.github.html" });
  if (branch != null) url.search = new URLSearchParams({ "ref": branch }).toString();
  const response = await fetch(url, { headers });
  if (!response.ok) {
    issues.push({ type: "not_ok_response", reference: link, status: response.status, statusText: response.statusText });
    return { issues };
  }
  return await response.text();
}
