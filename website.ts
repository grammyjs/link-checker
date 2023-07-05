import { default as anchorPlugin } from "https://esm.sh/markdown-it-anchor@8.6.7";
import { slugify } from "https://esm.sh/@mdit-vue/shared@0.12.0";
import { extname, join } from "https://deno.land/std@0.193.0/path/mod.ts";
import { colors, domParser, MarkdownIt, overwrite } from "./deps.ts";
import { isValidAnchor, transformURL } from "./fetch.ts";
import type { Issue, MissingAnchorIssue } from "./types.ts";
import { checkExternalLink, getAnchors, parseLink, parseMarkdownContent } from "./utilities.ts";

const markdown = MarkdownIt({ html: true, linkify: true }).use(anchorPlugin, { slugify });
markdown.linkify.set({ fuzzyLink: false });

const ALLOW_HTML_EXTENSION = false;
const INDEX_FILE = "README.md";

async function parseMarkdownFile(filepath: string) {
  const content = await Deno.readTextFile(filepath);
  const parsed = parseMarkdownContent(markdown, content);
  const document = domParser.parseFromString(parsed.html, "text/html")!;
  const allAnchors = getAnchors(document, { includeHref: false });

  const issues: Issue[] = [];
  const anchors = { all: allAnchors, used: new Set<string>() };
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
  localLink: string,
  options: { indexFile: string; isCleanUrl: boolean },
) {
  const issues: Issue[] = [];
  let { root, anchor } = parseLink(localLink);

  if (options.isCleanUrl) {
    if (extname(root) === ".html") {
      issues.push({ type: "disallow_extension", reference: localLink, extension: "html" });
      root = root.slice(0, -4) + "md";
    } else if (extname(root) === ".md") {
      issues.push({ type: "disallow_extension", reference: localLink, extension: "md" });
    } else if (root.endsWith("/")) {
      root += options.indexFile;
    } else {
      root += ".md";
    }
  } else {
    if (extname(root) === ".html") {
      if (!ALLOW_HTML_EXTENSION) {
        issues.push({ type: "wrong_extension", actual: ".html", expected: ".md", reference: localLink });
      }
      root = root.slice(0, -4) + "md";
    }
    if (extname(root) !== ".md") {
      if (!root.endsWith("/")) root += "/";
      root += options.indexFile;
    }
  }

  const path = join(directory, root);
  try {
    await Deno.lstat(path);
    return { anchor, issues, path };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      issues.push({ type: "linked_file_not_found", filepath: root });
      return { anchor, issues, path };
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

export async function readMarkdownFiles(rootDirectory: string, options: { isCleanUrl: boolean }) {
  const issues: Record<string, Issue[]> = {};
  const allAnchors: Record<string, Set<string>> = {};
  const usedAnchors: Record<string, typeof allAnchors> = {};

  async function readDirectoryFiles(directory: string) {
    for await (const entry of Deno.readDir(directory)) {
      if (!entry.isFile && !entry.isDirectory) continue;
      const filepath = join(directory, entry.name);

      if (entry.isDirectory) {
        overwrite(colors.magenta("reading directory"), filepath);
        await readDirectoryFiles(filepath);
        continue;
      }

      if (extname(entry.name) != ".md") continue;
      overwrite(colors.magenta("reading"), filepath);

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
        const linkedFile = await checkRelativeLink(directory, localLink, {
          indexFile: INDEX_FILE,
          isCleanUrl: options.isCleanUrl,
        });

        if (linkedFile.issues.length > 0) {
          issues[filepath] ??= [];
          issues[filepath].push(...linkedFile.issues);
        }

        if (linkedFile.anchor != null) {
          if (linkedFile.anchor === "") {
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
        const { root, anchor } = parseLink(externalLink);

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

        overwrite(colors.blue("fetch"), transformURL(decodeURI(root)));
        const checkedExternalLink = await checkExternalLink(root);
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