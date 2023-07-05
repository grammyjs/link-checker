import { doc } from "https://deno.land/x/deno_doc@0.62.0/mod.ts";
import type { DocNode, JsDoc, JsDocTag, JsDocTagKind, Location } from "https://deno.land/x/deno_doc@0.62.0/types.d.ts";
import { colors, MarkdownIt, overwrite, parse } from "./deps.ts";
import { generateIssueList, prettySummary } from "./issues.ts";
import type { ExternalLinkIssue, Issue } from "./types.ts";
import { checkExternalLink, parseLink, parseMarkdownContent } from "./utilities.ts";

const args = parse(Deno.args, { string: ["module"] });

if (args.module == null) {
  console.error("Specify a module using --module.");
  Deno.exit(1);
}

const markdown = MarkdownIt();

interface Link {
  location: Location;
  anchor?: string;
  tag?: string;
  name?: string;
}
type HasJSDoc = { jsDoc?: JsDoc; location: Location; name?: string };
type TSDocLinkIssue = (Issue & { loc: Link }) | (ExternalLinkIssue & { loc: Set<Link> });

await main(args.module);

async function main(module: string) {
  const allIssues: TSDocLinkIssue[] = [];
  const links = await findLinks(module);

  for (const root in links) {
    overwrite(colors.brightMagenta("fetch"), root);
    const checked = await checkExternalLink(root);
    if (checked == null) {
      allIssues.push({ type: "no_response", reference: root, loc: links[root] });
      continue;
    }
    allIssues.push(...checked.issues.map((issue) => ({ ...issue, loc: links[root] })));
    if (checked.anchors == null) {
      delete links[root];
      continue;
    }
    for (const loc of links[root]) {
      if (loc.anchor == null || checked.anchors.has(loc.anchor)) continue;
      allIssues.push({ type: "missing_anchor", anchor: loc.anchor, reference: root, loc });
    }
  }

  if (allIssues.length === 0) {
    console.log(colors.green("No broken links were found in any of the TS Docs!"));
    Deno.exit(0);
  }

  console.log(colors.red(`Found ${allIssues.length} issues in TS Docs of the module.\n`));

  const issues = allIssues.reduce<Record<string, TSDocLinkIssue[]>>((prev, issue) => {
    if (issue.loc instanceof Set) {
      const locations: string[] = [];
      for (const loc of issue.loc) {
        locations.push(prettyLocation(loc));
      }
      const location = locations.join("\n");
      prev[location] ??= [];
      prev[location].push(issue);
    } else {
      const location = prettyLocation(issue.loc);
      prev[location] ??= [];
      prev[location].push(issue);
    }
    return prev;
  }, {});

  console.log(prettySummary(issues).summary);

  for (const location of Object.keys(issues).sort((a, b) => a.localeCompare(b))) {
    console.log(location);
    console.log(generateIssueList(issues[location]));
  }

  Deno.exit(1);
}

function prettyLocation({ location, tag, name }: Link) {
  return `${colors.bold(location.filename)}:${location.line}:${location.col}` +
    (tag == null ? "" : ` in ${colors.red("@" + tag)}`) +
    (name == null ? "" : ` ${colors.yellow(name)}`);
}

async function findLinks(module: string) {
  console.log("Generating doc nodes of", module);

  const docNodes = await doc(module);
  const jsDocNodes = stripSymbolsWithJSDocs(docNodes);
  const links: Record<string, Set<Link>> = {};

  for (const { jsDoc, location } of jsDocNodes) {
    if (jsDoc == null) continue;
    for (const href of stripLinksFromJSDoc(jsDoc.doc ?? "")) {
      const parsed = parseLink(href);
      links[parsed.root] ??= new Set();
      links[parsed.root].add({ location, anchor: parsed.anchor });
    }
    for (const { kind, href, name } of stripLinksFromJSDocTags(jsDoc.tags ?? [])) {
      const parsed = parseLink(href);
      links[parsed.root] ??= new Set();
      links[parsed.root].add({ location, anchor: parsed.anchor, tag: kind, name });
    }
  }

  return links;
}

function stripLinksFromJSDoc(doc: string) {
  return parseMarkdownContent(markdown, doc).links;
}

function stripLinksFromJSDocTags(tags: JsDocTag[]) {
  const links = new Set<{ kind: JsDocTagKind; href: string; name?: string }>();
  for (const tag of tags) {
    switch (tag.kind) {
      case "category":
      case "deprecated":
      case "example":
      case "callback":
      case "template":
      case "default":
      case "enum":
      case "extends":
      case "this":
      case "type":
      case "property":
      case "typedef":
      case "param":
      case "return": {
        if (tag.doc == null || tag.doc.trim() === "") break;
        const strippedLinks = stripLinksFromJSDoc(tag.doc);
        for (const href of strippedLinks) {
          let name: string | undefined = undefined;
          if (
            tag.kind === "property" || tag.kind === "callback" || tag.kind === "template" || tag.kind === "typedef" ||
            tag.kind === "param"
          ) {
            name = tag.name;
          } else if (tag.kind === "enum" || tag.kind === "extends" || tag.kind === "this" || tag.kind === "type") {
            name = tag.type;
          }
          links.add({ kind: tag.kind, href, name });
        }
      }
    }
  }
  return links;
}

function stripSymbolsWithJSDocs(docNodes: DocNode[]) {
  let jsDocNodes: HasJSDoc[] = [];

  for (const node of docNodes) {
    if (node.kind === "import") continue;
    if (node.jsDoc != null) jsDocNodes.push(node);

    if (node.kind === "interface") {
      jsDocNodes = jsDocNodes.concat(
        node.interfaceDef.methods.filter((method) => method.jsDoc != null),
        node.interfaceDef.properties.filter((prop) => prop.jsDoc != null),
        node.interfaceDef.callSignatures.filter((sig) => sig.jsDoc != null),
      );
    } else if (node.kind === "enum") {
      jsDocNodes = jsDocNodes.concat(node.enumDef.members.filter((member) => member.jsDoc != null));
    } else if (node.kind === "class") {
      jsDocNodes = jsDocNodes.concat(
        node.classDef.constructors.filter((constructor) => constructor.jsDoc != null),
        node.classDef.methods.filter((method) => method.jsDoc != null),
        node.classDef.properties.filter((prop) => prop.jsDoc != null),
      );
    } else if (node.kind === "namespace") {
      jsDocNodes = jsDocNodes.concat(stripSymbolsWithJSDocs(node.namespaceDef.elements));
    }
  }

  return jsDocNodes;
}
