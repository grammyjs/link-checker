import { extname, join } from "./deps.ts";
import { checkExternalLink, checkRelativeLink, findMissingAnchors, parseMarkdownFile, prepareReport } from "./refactor.ts";
import { Issue } from "./types.ts";
import { strom } from "https://deno.land/x/strom@0.2.0/mod.ts";

const INDEX_FILENAME = "README.md";
const ALLOW_HTML_EXTENSION = false;
const ROOT_DIRECTORY = Deno.args[0] ?? ".";

if (Deno.args[0] == null) {
  console.warn("No path was specified. Using the current directory as documentation source root.");
}

const issues = await readMarkdownFiles(ROOT_DIRECTORY);

for (const filepath of Object.keys(issues).sort((a, b) => a.localeCompare(b))) {
  console.log(prepareReport(filepath, issues[filepath]));
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
        const anchor = hash != "" ? hash.substring(1) : undefined;

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
