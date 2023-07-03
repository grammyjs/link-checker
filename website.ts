import { extname, join } from "./deps.ts";
import { checkExternalLink, parseMarkdownContent } from "./utilities.ts";
import { Issue, MarkdownFile, MissingAnchorIssue } from "./types.ts";
import { generateIssueList } from "./issues.ts";
import { isValidAnchor } from "./fetch.ts";

const INDEX_FILENAME = "README.md";
const ALLOW_HTML_EXTENSION = false;
const ROOT_DIRECTORY = Deno.args[0] ?? ".";

if (Deno.args[0] == null) {
  console.warn("No path was specified. Using the current directory as documentation source root.");
}

const issues = await readMarkdownFiles(ROOT_DIRECTORY);

for (const filepath of Object.keys(issues).sort((a, b) => a.localeCompare(b))) {
  console.log(filepath, `(${issues[filepath].length})`);
  console.log(generateIssueList(issues[filepath]));
}

async function parseMarkdownFile(filepath: string): Promise<MarkdownFile> {
  const content = await Deno.readTextFile(filepath);
  const parsed = parseMarkdownContent(content, { anchors: true });

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

async function readMarkdownFiles(rootDirectory: string) {
  const issues: Record<string, Issue[]> = {};
  const allAnchors: Record<string, Set<string>> = {};
  const usedAnchors: Record<string, typeof allAnchors> = {};

  async function readDirectoryFiles(directory: string) {
    for await (const entry of Deno.readDir(directory)) {
      if (!entry.isFile && !entry.isDirectory) continue;
      const filepath = join(directory, entry.name);

      if (entry.isDirectory) {
        await readDirectoryFiles(filepath);
        continue;
      }

      if (extname(entry.name) != ".md") continue;

      const parsed = await parseMarkdownFile(filepath);

      // --- Issues ---
      if (parsed == null) {
        issues[filepath] ??= [];
        issues[filepath].push({ type: "empty_dom", reference: filepath });
        continue;
      }

      if (parsed.issues.length != 0) {
        issues[filepath] ??= [];
        issues[filepath].push(...parsed.issues);
      }

      // --- Anchors ---
      allAnchors[filepath] = parsed.anchors.all;

      if (parsed.anchors.used.size != 0) {
        usedAnchors[filepath] ??= {};
        usedAnchors[filepath][filepath] ??= new Set();
      }
      for (const anchor of parsed.anchors.used) {
        usedAnchors[filepath][filepath].add(anchor);
      }

      // --- Relative Links (Local files) ---
      for (const localLink of parsed.links.local) {
        const linkedFile = await checkRelativeLink(directory, localLink, { indexFile: INDEX_FILENAME });

        if (!ALLOW_HTML_EXTENSION && linkedFile.isHtmlExtension) {
          issues[filepath] ??= [];
          issues[filepath].push({ type: "wrong_extension", actual: ".html", expected: ".md", reference: localLink });
        }

        if (!linkedFile.exists) {
          issues[filepath] ??= [];
          issues[filepath].push({ type: "linked_file_not_found", filepath: linkedFile.path });
        }

        if (linkedFile.anchor != null) {
          if (linkedFile.anchor == "") {
            issues[filepath] ??= [];
            issues[filepath].push({ type: "empty_anchor", reference: localLink });
            continue;
          }
          usedAnchors[linkedFile.path] ??= {};
          usedAnchors[linkedFile.path][filepath] ??= new Set();
          usedAnchors[linkedFile.path][filepath].add(linkedFile.anchor);
        }
      }

      // --- External Links ---
      for (const externalLink of parsed.links.external) {
        const { origin, pathname, search, hash } = new URL(externalLink);
        const root = origin + pathname + search;
        const anchor = hash.substring(1) !== "" ? hash.substring(1) : undefined;

        if (usedAnchors[root] != null) {
          usedAnchors[root][filepath] ??= new Set();
          if (anchor != null) {
            usedAnchors[root][filepath].add(anchor);
          }
          continue;
        }

        usedAnchors[root] = {
          [filepath]: new Set(anchor != null ? [anchor] : []),
        };

        const checkedExternalLink = await checkExternalLink(externalLink);
        if (checkedExternalLink == null) {
          delete usedAnchors[root];
          continue;
        }

        if (checkedExternalLink.issues.length > 0) {
          issues[filepath] ??= [];
          issues[filepath].push(...checkedExternalLink.issues);
        }

        if (checkedExternalLink.anchors != null) {
          allAnchors[root] = checkedExternalLink.anchors;
        }
      }
    }
  }

  await readDirectoryFiles(rootDirectory);

  const missingAnchors = findMissingAnchors(allAnchors, usedAnchors);
  for (const filepath in missingAnchors) {
    issues[filepath] ??= [];
    issues[filepath].push(...missingAnchors[filepath]);
  }

  return issues;
}
