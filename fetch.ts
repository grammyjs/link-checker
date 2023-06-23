import { colors } from "./deps.ts";

export const ACCEPTABLE_NOT_OK_STATUS: Record<string, number> = {
  "https://dash.cloudflare.com/login": 403,
  "https://dash.cloudflare.com/?account=workers": 403,
};

const VALID_REDIRECTIONS: Record<string, string> = {
  "https://localtunnel.me/": "https://theboroer.github.io/localtunnel-www/",
  "https://nodejs.org/": "https://nodejs.org/en",
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
        console.info(`Retrying (${retries + 1})`);
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
    console.info(colors.yellow("Changing t.me to telegram.me for convenience"));
    url.hostname = "telegram.me";
  }
  return url.toString();
}

/** Some redirections are okay, so we ignore those changes */
export function isValidRedirection(from: string, to: string) {
  if (VALID_REDIRECTIONS[from] === to) return true;

  // --- General cases ---

  const general = (from: string, to: string) => (
    // (0) For www and https checks' general calls.
    (from === to) ||
    // (1) A third-party Deno module, supposed to be redirected to the latest
    // version, and it does get redirected to the latest version.
    (from.includes("deno.land/x/") && !from.includes("@") && to.includes("@")) ||
    // (2) A link to Deno Manual, and it is supposed to be redirected to the
    // latest version. And it does get redirected!
    (from.includes("deno.com/manual/") && to.includes("@")) ||
    // (3) Shortened https://youtu.be/{id} links redirecting to https://youtube.com/watch?v={id} links.
    to.includes(from.replace(new URL(from).origin + "/", "?v=")) ||
    // (4) Simply a slash was removed or added (I don't think we should care).
    ((to + "/" == from) || (from + "/" == to)) ||
    // (5) Maybe some search params was appended: like a language code or something.
    to.includes(from + "?") || to.includes(from.split("#")[0] + "?") ||
    to.includes(from + "&") || to.includes(from.split("#")[0] + "&") ||
    // (6) Login redirections; e.g., Firebase Console -> Google Account Login
    (
      (to.includes("accounts.google.com") && to.includes("signin")) || // Google
      (to.includes("github.com/login?return_to=")) // Github
    )
  );

  // --- Special Cases ---

  // (1) Added a www to the domain and any of the above.
  const www = !from.includes("://www.") && to.includes("://www.") && general(from.replace("://", "://www."), to);
  // (2) Protocol changed to "https" from "http": (I think thats ignorable?)
  const https = from.startsWith("http://") && to.startsWith("https://") &&
    general(from.replace("http://", "https://"), to);

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
