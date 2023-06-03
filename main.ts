import {
  anchorPlugin,
  colors,
  DOMParser,
  extname,
  HTMLDocument,
  join,
  MarkdownIt,
  slugify,
} from "./deps.ts";
import {
  filterLinksFromTokens,
  getAnchors,
  getRetryingFetch,
  isValidAnchor,
  isValidRedirection,
  log,
  transformURL,
  warn,
} from "./utilities.ts";
import type { Issue } from "./types.ts";

const INDEX_FILE = "README.md";
const ALLOW_HTML_INSTEAD_OF_MD = false;
const RETRY_FAILED_FETCH = true;
const MAX_RETRIES = 5;
const ACCEPTABLE_NOT_OK_STATUS: Record<string, number> = {
  "https://dash.cloudflare.com/login": 403,
  "https://dash.cloudflare.com/?account=workers": 403,
};

// === Prerequisites === //

const domParser = new DOMParser();
const markdownIt = MarkdownIt({ html: true, linkify: true })
  .use(anchorPlugin, { slugify }); // this is what vuepress uses.
const fetchWithRetries = getRetryingFetch(RETRY_FAILED_FETCH, MAX_RETRIES);

// All anchors that are actually present in the file or website.
const allAnchors: Record<string, Set<string>> = {};
const links: Record<string, Set<string>> = {};
const usedAnchors: Record<string, Record<string, Set<string>>> = {};
const issues: Record<string, Issue[]> = {};

const directory = Deno.args[0];
if (directory == null || directory.trim() === "") {
  log(
    "%cUsing current working directory as the website content root directory%c",
    "magenta",
  );
}
let fileCount = 0;
const linkCount = { external: 0, local: 0 };
await findLinksFromFiles(directory ?? ".");
log(`%cINFO%c Read ${fileCount} markdown files`, "magenta");
log(
  `%cINFO%c Found ${linkCount.external} external and ${linkCount.local} local links`,
  "magenta",
);

async function findLinksFromFiles(directory: string) {
  for await (const dirEntry of Deno.readDir(directory)) {
    if (!dirEntry.isFile && !dirEntry.isDirectory) continue;

    const path = join(directory, dirEntry.name);

    if (dirEntry.isDirectory) {
      await findLinksFromFiles(path);
      continue;
    }

    if (extname(dirEntry.name) != ".md") continue;

    const content = await Deno.readTextFile(path);
    const tokens = markdownIt.parse(content, {});

    const html = markdownIt.render(content, {});
    const document = domParser.parseFromString(html, "text/html");
    if (document == null) { // Document seems to be empty: shouldn't happen
      issues[path].push({ type: "domParseFailure", reference: path });
      continue;
    }
    allAnchors[path] = getAnchors(document, { includeHref: false });
    // Why not include href?:                 ^?
    // Since we're getting anchor ids from a local file, we don't need
    // incorrect hrefs that points to non-existent element ids. We only
    // need href if we're getting the anchors of an external website as
    // its their responsibility to not to leave incorrect hrefs in their website.
    fileCount++;

    const filtered = filterLinksFromTokens(tokens);
    for (const link of filtered) {
      if (link.startsWith("http") && link.includes("://")) { // external link.
        links[path] ??= new Set();
        links[path].add(link);
        linkCount.external++;
      } else if (link.startsWith(".")) { // relative path to a file.
        await resolveLocalFileLink(directory, path, link);
        linkCount.local++;
      } else if (link.startsWith("#")) { // anchor to the same file.
        usedAnchors[path] ??= {};
        usedAnchors[path][path] ??= new Set();
        usedAnchors[path][path].add(link.substring(1));
      } else { // some other type -- MUST be an invalid one
        issues[path].push({ type: "unknownLinkType", reference: link });
      }
    }
  }
}

async function resolveLocalFileLink(
  directory: string,
  path: string,
  link: string,
) {
  let [root, anchor] = link.split("#");
  if (root.endsWith(".html")) {
    if (!ALLOW_HTML_INSTEAD_OF_MD) {
      issues[path] ??= [];
      issues[path].push({ type: "htmlInsteadOfMd", reference: link });
    }
    root = root.replace(".html", ".md");
  }
  if (!root.endsWith(".md")) { // links to the index
    if (!root.endsWith("/")) root += "/";
    root += INDEX_FILE;
  }
  const relativePath = join(directory, root);
  try {
    await Deno.lstat(relativePath);
    if (anchor == null) return;
    usedAnchors[relativePath] ??= {};
    usedAnchors[relativePath][path] ??= new Set();
    usedAnchors[relativePath][path].add(anchor);
    // ^ Means that this anchor have been used to link
    //   the `relativePath` file from `path` file.
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      issues[path] ??= [];
      issues[path].push({ type: "fileNotFound", reference: link });
      return;
    }
    throw error;
  }
}

// === Manage External Links === //

let fetchCount = 0;

for (const file in links) { // goes through each local file...
  for (const url_ of links[file]) { // ...and through the links in each file.
    const [root, anchor] = url_.split("#");

    if (usedAnchors[root] != null) {
      usedAnchors[root][file] ??= new Set();
      if (anchor != null) usedAnchors[root][file].add(anchor);
      continue; // already fetched once.
    }

    usedAnchors[root] = {};
    usedAnchors[root][file] ??= new Set();
    if (anchor != null) usedAnchors[root][file].add(anchor);

    const url = transformURL(url_);
    log(`%cFETCH%c (${colors.dim(`${++fetchCount}`)}) ${root}`, "blue");
    const response = await fetchWithRetries(url);
    if (response == null) {
      delete usedAnchors[root];
      continue;
    }

    if (response.redirected) {
      if (!isValidRedirection(url, response.url)) {
        issues[file] ??= [];
        issues[file].push({ type: "redirected", from: url_, to: response.url });
      }
    }

    if (!response.ok && ACCEPTABLE_NOT_OK_STATUS[url_] != response.status) {
      issues[file] ??= [];
      issues[file].push({ type: "notOk", reference: url_ });
      log(`%cNOT OK%c : ${response.status} ${response.statusText}`, "red");
    }

    // For getting list of actual anchors we need to parse the docuement.
    // And for parsing the document we need to make sure its a HTML document.
    const contentType = response.headers.get("content-type");
    if (!contentType) {
      warn(`No content-type header, continuing anyway`);
    } else if (!contentType.includes("text/html")) {
      warn(`Content-type is: ${contentType}, but let's just go with html`);
    }

    let document: HTMLDocument;
    try {
      const content = await response.text();
      const doc = domParser.parseFromString(content, "text/html");
      if (doc == null) throw new Error("no document, skipping");
      document = doc;
    } catch (err) {
      issues[file] ??= [];
      issues[file].push({ type: "domParseFailure", reference: url_ });
      log("%cERROR%c Couldn't parse the text (error below), skipping", "red");
      console.log(err);
      continue;
    }

    allAnchors[root] = getAnchors(document);
  }
}

// === Missing Anchors === //

for (const root in usedAnchors) {
  const all = allAnchors[root] ?? new Set();
  for (const file in usedAnchors[root]) {
    for (const anchor of usedAnchors[root][file]) {
      const decodedAnchor = decodeURIComponent(anchor); // there are other langs
      if (
        all.has(anchor) ||
        all.has(decodedAnchor) ||
        isValidAnchor(root, all, anchor)
      ) continue;
      issues[file] ??= [];
      issues[file].push({ type: "missingAnchor", root, anchor: decodedAnchor });
    }
  }
}

const d = decodeURIComponent;
const { red: r, blue: b, cyan: c, gray } = colors;

// === Report Generation and Summarization === //

const issueCount: Record<Issue["type"] | "total", number> = {
  total: 0,
  missingAnchor: 0,
  htmlInsteadOfMd: 0,
  fileNotFound: 0,
  redirected: 0,
  notOk: 0,
  domParseFailure: 0,
  unknownLinkType: 0,
};

const sortedFiles = Object.keys(issues).sort((a, b) => a.localeCompare(b));

log(`\n%cINFO%c Found issues in ${sortedFiles.length} files`, "magenta");

for (const file of sortedFiles) {
  const issueList = issues[file];
  issueCount.total += issueList.length;

  let report = colors.bold(r(`\n${file} (${issueList.length})`));

  for (const issue of issueList) {
    issueCount[issue.type]++;
    const message = generateIssueMessage(issue);
    report += `\n ${gray("-->")} ${message}`;
  }

  console.log(report);
}

function generateIssueMessage(issue: Issue) {
  // deno-fmt-ignore
  switch (issue.type) {
    case "missingAnchor":
      return `${c(issue.root)} does not have an anchor ${b(d(issue.anchor))}.`;
    case "htmlInsteadOfMd": {
      const [root, anchor] = issue.reference.split("#");
      return `The "${b(root)}" in ${b(`${root}#${d(anchor)}`)} should be ending with ".md" instead of ".html".`;
    }
    case "fileNotFound": {
      const [root] = issue.reference.split("#");
      return `The linked file ${c(root)} does not exist.`;
    }
    case "redirected":
      return `${c(issue.from)} was redirected to ${c(issue.to)}.`;
    case "notOk":
      return `${c(issue.reference)} returned a non-ok status code.`;
    case "domParseFailure":
      return `Couldn't parse the document at ${b(issue.reference)}.`;
    case "unknownLinkType":
      return `Unknown type of link: ${c(issue.reference)}`;
  }
}

const maxDistance = issueCount.total.toString().length;

function pad(x: number) {
  return x.toString().padStart(maxDistance, " ");
}

console.log(`
${colors.bold("SUMMARY")}
----------------------------${"-".repeat(maxDistance)}
           Missing anchors: ${pad(issueCount.missingAnchor)}
Using .html instead of .md: ${pad(issueCount.htmlInsteadOfMd)}
    Links to missing files: ${pad(issueCount.fileNotFound)}
                  Redirect: ${pad(issueCount.redirected)}
          Non-200 response: ${pad(issueCount.notOk)}
       DOM parsing failure: ${pad(issueCount.domParseFailure)}
      Unknown type of link: ${pad(issueCount.unknownLinkType)}
----------------------------${"-".repeat(maxDistance)}
                    Total : ${issueCount.total}`);

if (issueCount.total > 0) {
  Deno.exit(1); // for CI purposes
}
