import { ResponseInfo } from "./types.ts";

export const ACCEPTABLE_NOT_OK_STATUS: Record<string, number> = {
  "https://dash.cloudflare.com/login": 403,
  "https://dash.cloudflare.com/?account=workers": 403,
  "https://api.telegram.org/file/bot": 404,
  "https://accounts.google.com/signup": 302,
};

const VALID_REDIRECTIONS: Record<string, string> = {
  "https://localtunnel.me/": "https://theboroer.github.io/localtunnel-www/",
  "https://nodejs.org/": "https://nodejs.org/en",
  "https://api.telegram.org/": "https://core.telegram.org/bots",
  "https://telegram.me/name-of-your-bot?start=custom-payload": "https://telegram.org/",
  "http://telegram.me/addstickers/": "https://telegram.org/",
};

export const MANUAL_REDIRECTIONS: Array<string> = [
  "https://accounts.google.com/signup",
];

type FetchOptions = Parameters<typeof fetch>[1];

export const FETCH_OPTIONS: FetchOptions = {
  method: "GET",
  headers: {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/113.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Pragma": "no-cache",
    "Cache-Control": "no-cache",
  },
  mode: "cors",
};

export function getFetchWithRetries(retryOnFail: boolean, maxRetries: number) {
  return async function (url: string, options = FETCH_OPTIONS): Promise<ResponseInfo> {
    let retries = 0;
    const retryDelay = 3_000;
    const timeout = 30_000;

    const info: ResponseInfo = { redirected: false, redirectedUrl: "" };
    let error: unknown;

    do {
      if (retries > 0) {
        console.log(`Retrying (${retries}) after ${retryDelay}ms`);
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
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
        if (!retryOnFail) break;
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
      // Simply a slash was removed or added (I don't think we should care).
      (from.host === to.host && ((to.pathname + "/" === from.pathname) || (from.pathname + "/" === to.pathname))) ||
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
  // from the fetch as the contents are lazy loaded. So, the following is a hack: (not reliable)
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
