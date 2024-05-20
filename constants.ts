export const FIXABLE_ISSUE_TYPES = ["redirected", "missing_anchor", "empty_anchor", "wrong_extension", "disallow_extension"];

export const ISSUE_TYPES = [
  "unknown_link_format",
  "empty_dom",
  "empty_anchor",
  "no_response",
  "not_ok_response",
  "disallow_extension",
  "wrong_extension",
  "linked_file_not_found",
  "redirected",
  "missing_anchor",
  "local_alt_available",
  "inaccessible",
] as const;

export const WARNING_ISSUE_TYPES: typeof ISSUE_TYPES[number][] = [
  "inaccessible",
];

export const ACCEPTABLE_NOT_OK_STATUS: Record<string, number> = {
  "https://dash.cloudflare.com/login": 403,
  "https://dash.cloudflare.com/?account=workers": 403,
  "https://api.telegram.org/file/bot": 404,
};

export const VALID_REDIRECTIONS: Record<string, string> = {
  "https://localtunnel.me/": "https://theboroer.github.io/localtunnel-www/",
  "https://nodejs.org/": "https://nodejs.org/en",
  "https://api.telegram.org/": "https://core.telegram.org/bots",
  "https://telegram.me/name-of-your-bot?start=custom-payload": "https://telegram.org/",
  "http://telegram.me/addstickers/": "https://telegram.org/",
};

export const MANUAL_REDIRECTIONS: string[] = [
  "https://accounts.google.com/signup",
];

/** Websites protected by Cloudflare's DDos Protection Services */
export const CLOUDFLARE_PROTECTED: string[] = [
  "www.scaleway.com",
];

export const FETCH_OPTIONS = {
  method: "GET",
  headers: {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/113.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Pragma": "no-cache",
    "Cache-Control": "no-cache",
  },
  mode: "cors",
} as const;

export const DEFAULT_GITHUB_API_ROOT = "https://api.github.com";

export const SEARCH_PANIC_MESSAGE = `\
====================================================================================
PANIC. This shouldn't be happening. The search strings are supposed to have at least
one occurrence in the corresponding file. Please report this issue with enough
information and context at: https://github.com/grammyjs/link-checker/issues/new.
====================================================================================`;
