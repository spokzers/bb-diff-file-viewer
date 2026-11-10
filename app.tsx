import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  definePluginApp,
  experimental_Diff as Diff,
  experimental_useRpcMutation,
  experimental_useRpcQuery,
  experimental_useTabVisible,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const targetSchema = z.union([
  z.object({ type: z.literal("uncommitted") }),
  z.object({ type: z.literal("all"), mergeBaseBranch: z.string() }),
  z.object({ type: z.literal("commit"), sha: z.string() }),
]);

const statusRowSchema = z.union([
  z.object({
    outcome: z.literal("available"),
    workspace: z.object({
      mergeBase: z
        .object({
          mergeBaseBranch: z.string(),
          commits: z.array(z.object({
            sha: z.string(),
            shortSha: z.string(),
            subject: z.string(),
          })),
        })
        .nullable(),
    }),
  }),
  z.object({ outcome: z.literal("not_applicable"), message: z.string() }),
  z.object({
    outcome: z.literal("unavailable"),
    failure: z.object({ message: z.string() }),
  }),
  z.object({ outcome: z.literal("failed"), message: z.string() }),
]);

const changedFileSchema = z.object({
  path: z.string(),
  previousPath: z.string().nullable(),
  changeKind: z.enum([
    "added",
    "modified",
    "deleted",
    "renamed",
    "copied",
    "type_changed",
  ]),
  additions: z.number(),
  deletions: z.number(),
  binary: z.boolean(),
  origin: z.enum(["tracked", "untracked"]),
  loadMode: z.enum(["auto", "on_demand", "too_large"]),
  revision: z.string(),
});
export type ChangedFile = z.infer<typeof changedFileSchema>;

const unavailableSchema = z.object({
  outcome: z.literal("unavailable"),
  failure: z.object({ message: z.string() }),
});
const viewedTargetSchema = targetSchema;
const fileSideQuerySchema = z.union([
  z.object({
    target: z.literal("uncommitted"),
    path: z.string(),
    side: z.enum(["old", "new"]),
  }),
  z.object({
    target: z.literal("all"),
    mergeBaseRef: z.string(),
    path: z.string(),
    side: z.enum(["old", "new"]),
  }),
  z.object({
    target: z.literal("commit"),
    sha: z.string(),
    path: z.string(),
    side: z.enum(["old", "new"]),
  }),
]);
const notApplicableSchema = z.object({
  outcome: z.literal("not_applicable"),
  message: z.string(),
});

const gitContract = defineRpcContract({
  status: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(z.string(), statusRowSchema),
  },
  files: {
    input: z.object({
      environmentId: z.string(),
      target: targetSchema,
      ignoreWhitespace: z.boolean(),
    }),
    output: z.union([
      z.object({
        outcome: z.literal("available"),
        files: z.array(changedFileSchema),
        truncated: z.boolean(),
        shortstat: z.string(),
        mergeBaseRef: z.string().nullable(),
        initialPatches: z.array(z.object({
          path: z.string(),
          patch: z.string(),
          truncated: z.boolean(),
        })),
      }),
      unavailableSchema,
      notApplicableSchema,
    ]),
  },
  diff: {
    input: z.object({
      environmentId: z.string(),
      target: targetSchema,
      maxDiffBytes: z.number().optional(),
      maxFileListBytes: z.number().optional(),
    }),
    output: z.union([
      z.object({
        outcome: z.literal("available"),
        diff: z.object({
          diff: z.string(),
          truncated: z.boolean(),
          shortstat: z.string(),
          files: z.string(),
          mergeBaseRef: z.string().nullable(),
        }),
      }),
      unavailableSchema,
      notApplicableSchema,
    ]),
  },
  fileSide: {
    input: z.object({
      environmentId: z.string(),
      query: fileSideQuerySchema,
    }),
    output: z.union([
      z.object({
        outcome: z.literal("available"),
        file: z.object({
          path: z.string(),
          content: z.string(),
          contentEncoding: z.enum(["base64", "utf8"]),
          sizeBytes: z.number(),
        }),
      }),
      z.object({
        outcome: z.literal("unavailable"),
        code: z.enum(["ENOENT", "invalid_path", "file_too_large"]),
        message: z.string(),
      }),
    ]),
  },
  viewed: {
    input: z.object({
      environmentId: z.string(),
      target: viewedTargetSchema,
      paths: z.array(z.string()).optional(),
    }),
    output: z.object({
      files: z.array(z.object({ path: z.string(), revision: z.string() })),
    }),
  },
  markViewed: {
    input: z.object({
      environmentId: z.string(),
      target: viewedTargetSchema,
      path: z.string(),
      revision: z.string(),
    }),
    output: z.object({ ok: z.literal(true) }),
  },
  clearViewed: {
    input: z.object({
      environmentId: z.string(),
      target: viewedTargetSchema,
      path: z.string().optional(),
    }),
    output: z.object({ ok: z.literal(true) }),
  },
});

type DiffTarget = z.infer<typeof targetSchema>;

type TreeFolder = {
  kind: "folder";
  name: string;
  path: string;
  children: TreeNode[];
};
type TreeFile = { kind: "file"; name: string; file: ChangedFile };
type TreeNode = TreeFolder | TreeFile;

function buildTree(files: ChangedFile[]): TreeNode[] {
  const root: TreeFolder = { kind: "folder", name: "", path: "", children: [] };
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let parent = root;
    for (const [index, part] of parts.entries()) {
      if (index === parts.length - 1) {
        parent.children.push({ kind: "file", name: part, file });
        continue;
      }
      const path = parts.slice(0, index + 1).join("/");
      let folder = parent.children.find(
        (node): node is TreeFolder =>
          node.kind === "folder" && node.name === part,
      );
      if (folder === undefined) {
        folder = { kind: "folder", name: part, path, children: [] };
        parent.children.push(folder);
      }
      parent = folder;
    }
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) if (node.kind === "folder") sort(node.children);
  };
  sort(root.children);
  return root.children;
}

function decodePatchPath(raw: string): string | null {
  const value = raw.trim();
  if (value === "/dev/null") return null;
  const unquoted = value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\")
    : value;
  return unquoted.replace(/^[ab]\//, "");
}

function patchesByPath(diff: string): Map<string, string> {
  const result = new Map<string, string>();
  const starts: number[] = [];
  const header = /^diff --git /gm;
  for (let match = header.exec(diff); match !== null; match = header.exec(diff)) {
    starts.push(match.index);
  }
  if (starts.length === 0 && diff.trim() !== "") return result;
  starts.push(diff.length);
  for (let index = 0; index < starts.length - 1; index += 1) {
    const patch = diff.slice(starts[index], starts[index + 1]);
    const newPath = patch.match(/^\+\+\+\s+(.+)$/m)?.[1];
    const oldPath = patch.match(/^---\s+(.+)$/m)?.[1];
    const path = decodePatchPath(newPath ?? "") ?? decodePatchPath(oldPath ?? "");
    if (path !== null && path !== "") result.set(path, patch);
  }
  return result;
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (value && typeof value === "object") {
    if ("message" in value && typeof value.message === "string") return value.message;
    if ("failure" in value) {
      const failure = value.failure;
      if (
        failure &&
        typeof failure === "object" &&
        "message" in failure &&
        typeof failure.message === "string"
      ) return failure.message;
    }
  }
  return "The diff could not be loaded.";
}

function changeLabel(kind: ChangedFile["changeKind"]): string {
  switch (kind) {
    case "added": return "A";
    case "deleted": return "D";
    case "renamed": return "R";
    case "copied": return "C";
    case "type_changed": return "T";
    default: return "M";
  }
}

function changeColorClass(kind: ChangedFile["changeKind"]): string {
  switch (kind) {
    case "added":
      return "text-emerald-600 dark:text-emerald-400";
    case "modified":
      return "text-amber-600 dark:text-amber-400";
    case "deleted":
      return "text-red-600 dark:text-red-400";
    case "renamed":
    case "copied":
      return "text-sky-600 dark:text-sky-400";
    default:
      return "text-muted-foreground";
  }
}

function FileNavRow({
  file,
  label,
  selected,
  viewed,
  paddingLeft,
  onSelect,
  onViewedChange,
}: {
  file: ChangedFile;
  label: string;
  selected: boolean;
  viewed: boolean;
  paddingLeft: number;
  onSelect: (file: ChangedFile) => void;
  onViewedChange: (file: ChangedFile, viewed: boolean) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "flex h-7 w-full items-center gap-1.5 rounded px-1 text-left text-xs hover:bg-muted",
        selected && "bg-accent text-accent-foreground hover:bg-accent",
        viewed && !selected && "text-muted-foreground",
      )}
      style={{ paddingLeft: `${paddingLeft}px` }}
      onClick={() => onSelect(file)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect(file);
      }}
      title={file.path}
    >
      <span onClick={(event) => event.stopPropagation()} className="flex shrink-0 items-center">
        <Checkbox
          checked={viewed}
          onCheckedChange={(checked) => onViewedChange(file, checked === true)}
          aria-label={`Mark ${file.path} ${viewed ? "not viewed" : "viewed"}`}
          className="size-3.5"
        />
      </span>
      <Icon name="FileText" className="size-3.5 shrink-0 text-muted-foreground" />
      <span className={cn("min-w-0 flex-1 truncate", changeColorClass(file.changeKind))}>{label}</span>
      <span className={cn("shrink-0 font-mono text-[10px]", changeColorClass(file.changeKind))}>
        {changeLabel(file.changeKind)}
      </span>
    </div>
  );
}

function collectTreeFiles(folder: TreeFolder): ChangedFile[] {
  return folder.children.flatMap((node) =>
    node.kind === "file" ? [node.file] : collectTreeFiles(node),
  );
}

function TreeRows({
  nodes,
  selectedPath,
  viewedPaths,
  collapsed,
  onToggleFolder,
  onSelect,
  onViewedChange,
  onFilesViewedChange,
  depth = 0,
}: {
  nodes: TreeNode[];
  selectedPath: string | null;
  viewedPaths: Set<string>;
  collapsed: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelect: (file: ChangedFile) => void;
  onViewedChange: (file: ChangedFile, viewed: boolean) => void;
  onFilesViewedChange: (files: ChangedFile[], viewed: boolean) => void;
  depth?: number;
}) {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      const isCollapsed = collapsed.has(node.path);
      const folderFiles = collectTreeFiles(node);
      const viewedCount = folderFiles.filter((file) => viewedPaths.has(file.path)).length;
      const folderViewed = viewedCount === folderFiles.length;
      const folderChecked = viewedCount === 0 ? false : folderViewed ? true : "indeterminate";
      return (
        <div key={`folder:${node.path}`}>
          <div
            role="button"
            tabIndex={0}
            className="flex h-7 w-full items-center gap-1 rounded px-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
            onClick={() => onToggleFolder(node.path)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onToggleFolder(node.path);
            }}
          >
            <Icon
              name="ChevronRight"
              className={cn("size-3.5 shrink-0 transition-transform", !isCollapsed && "rotate-90")}
            />
            <span onClick={(event) => event.stopPropagation()} className="flex shrink-0 items-center">
              <Checkbox
                checked={folderChecked}
                onCheckedChange={() => onFilesViewedChange(folderFiles, !folderViewed)}
                aria-label={`Mark folder ${node.path} ${folderViewed ? "not viewed" : "viewed"}`}
                className="size-3.5"
              />
            </span>
            <Icon name={isCollapsed ? "Folder" : "FolderOpen"} className="size-3.5 shrink-0" />
            <span className="truncate">{node.name}</span>
          </div>
          {isCollapsed ? null : (
            <TreeRows
              nodes={node.children}
              selectedPath={selectedPath}
              viewedPaths={viewedPaths}
              collapsed={collapsed}
              onToggleFolder={onToggleFolder}
              onSelect={onSelect}
              onViewedChange={onViewedChange}
              onFilesViewedChange={onFilesViewedChange}
              depth={depth + 1}
            />
          )}
        </div>
      );
    }
    return (
      <FileNavRow
        key={node.file.path}
        file={node.file}
        label={node.name}
        selected={selectedPath === node.file.path}
        viewed={viewedPaths.has(node.file.path)}
        paddingLeft={depth * 12 + 20}
        onSelect={onSelect}
        onViewedChange={onViewedChange}
      />
    );
  });
}

function hunkAnchors(patch: string | undefined): Array<{ oldStart: number; newStart: number }> {
  if (!patch) return [];
  const anchors: Array<{ oldStart: number; newStart: number }> = [];
  const pattern = /^@@ -([0-9]+)(?:,[0-9]+)? \+([0-9]+)(?:,[0-9]+)? @@/gm;
  for (let match = pattern.exec(patch); match !== null; match = pattern.exec(patch)) {
    anchors.push({ oldStart: Number(match[1]), newStart: Number(match[2]) });
  }
  return anchors;
}

function findDeepElement(root: ParentNode, selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const direct = root.querySelector(selector);
    if (direct instanceof HTMLElement) return direct;
  }
  for (const element of Array.from(root.querySelectorAll("*"))) {
    if (!(element instanceof HTMLElement) || element.shadowRoot === null) continue;
    const nested = findDeepElement(element.shadowRoot, selectors);
    if (nested) return nested;
  }
  return null;
}

function fileSideQuery(
  target: DiffTarget,
  mergeBaseRef: string | null,
  path: string,
  side: "old" | "new",
): z.infer<typeof fileSideQuerySchema> | null {
  if (target.type === "uncommitted") return { target: "uncommitted", path, side };
  if (target.type === "commit") return { target: "commit", sha: target.sha, path, side };
  return mergeBaseRef ? { target: "all", mergeBaseRef, path, side } : null;
}

function diffSectionId(environmentId: string, path: string): string {
  return `diff-tree-${encodeURIComponent(environmentId)}-${encodeURIComponent(path)}`;
}

function DiffFileSection({
  environmentId,
  target,
  mergeBaseRef,
  diffView,
  file,
  patch,
  viewed,
  truncated,
  onViewedChange,
}: {
  environmentId: string;
  target: DiffTarget;
  mergeBaseRef: string | null;
  diffView: "unified" | "split";
  file: ChangedFile;
  patch: string | undefined;
  viewed: boolean;
  truncated: boolean;
  onViewedChange: (file: ChangedFile, viewed: boolean) => void;
}) {
  const oldQuery = fileSideQuery(target, mergeBaseRef, file.path, "old");
  const newQuery = fileSideQuery(target, mergeBaseRef, file.path, "new");
  const oldSide = experimental_useRpcQuery({
    pluginId: "bb--git",
    contract: gitContract,
    method: "fileSide",
    input: { environmentId, query: oldQuery ?? { target: "uncommitted", path: file.path, side: "old" } },
    enabled: !file.binary && oldQuery !== null,
  });
  const newSide = experimental_useRpcQuery({
    pluginId: "bb--git",
    contract: gitContract,
    method: "fileSide",
    input: { environmentId, query: newQuery ?? { target: "uncommitted", path: file.path, side: "new" } },
    enabled: !file.binary && newQuery !== null,
  });
  const sideContent = (result: typeof oldSide.data): { path: string; content: string } | null => {
    if (result?.outcome === "available" && result.file.contentEncoding === "utf8") {
      return { path: result.file.path, content: result.file.content };
    }
    if (result?.outcome === "unavailable" && result.code === "ENOENT") {
      return { path: file.path, content: "" };
    }
    return null;
  };
  const oldContent = sideContent(oldSide.data);
  const newContent = sideContent(newSide.data);
  const fullFileContents = oldContent && newContent
    ? {
        old: { path: file.previousPath ?? file.path, content: oldContent.content },
        new: { path: file.path, content: newContent.content },
      }
    : undefined;
  const diffRootRef = useRef<HTMLDivElement>(null);
  const hunks = useMemo(() => hunkAnchors(patch), [patch]);
  const [activeHunk, setActiveHunk] = useState(0);
  useEffect(() => setActiveHunk(0), [patch]);
  const navigateToHunk = (nextIndex: number) => {
    if (hunks.length === 0) return;
    const index = Math.min(hunks.length - 1, Math.max(0, nextIndex));
    setActiveHunk(index);
    requestAnimationFrame(() => {
      const root = diffRootRef.current;
      const anchor = hunks[index];
      if (!root || !anchor) return;
      const element = findDeepElement(root, [
        `[data-line="${anchor.newStart}"]`,
        `[data-alt-line="${anchor.oldStart}"]`,
        `[data-column-number="${anchor.newStart}"]`,
        `[data-column-number="${anchor.oldStart}"]`,
      ]);
      if (!element) return;
      const scroller = root.closest<HTMLElement>("[data-diff-scroll]");
      if (!scroller) return;
      const elementRect = element.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const top = scroller.scrollTop + elementRect.top - scrollerRect.top - scroller.clientHeight / 3;
      scroller.scrollTo({ top: Math.max(0, top), left: scroller.scrollLeft, behavior: "smooth" });
    });
  };
  return (
    <section className="scroll-mt-10 border-b border-border last:border-b-0">
      <div className="sticky top-0 z-10 flex min-h-10 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur">
        <Checkbox
          checked={viewed}
          onCheckedChange={(checked) => onViewedChange(file, checked === true)}
          aria-label={`Mark ${file.path} ${viewed ? "not viewed" : "viewed"}`}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={file.path}>
          {file.path}
        </span>
        {viewed ? <span className="text-[10px] text-muted-foreground">Viewed</span> : null}
        {hunks.length > 1 ? (
          <div className="flex items-center gap-0.5" aria-label="Hunk navigation">
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              disabled={activeHunk <= 0}
              onClick={() => navigateToHunk(activeHunk - 1)}
              aria-label="Previous hunk"
            >
              <Icon name="ChevronUp" className="size-3.5" />
            </Button>
            <span className="min-w-8 text-center text-[10px] text-muted-foreground">
              {activeHunk + 1}/{hunks.length}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              disabled={activeHunk >= hunks.length - 1}
              onClick={() => navigateToHunk(activeHunk + 1)}
              aria-label="Next hunk"
            >
              <Icon name="ChevronDown" className="size-3.5" />
            </Button>
          </div>
        ) : null}
        <span className="text-xs text-emerald-600 dark:text-emerald-400">+{file.additions}</span>
        <span className="text-xs text-red-600 dark:text-red-400">−{file.deletions}</span>
      </div>
      {file.binary ? (
        <EmptyState>Binary file changed.</EmptyState>
      ) : patch ? (
        <div ref={diffRootRef}>
          <Diff
            patch={patch}
            path={file.path}
            view={diffView}
            experimental_fullFileContents={fullFileContents}
            className="min-w-full"
          />
        </div>
      ) : (
        <EmptyState>
          {truncated
            ? "This file is outside the loaded 2 MB diff."
            : "No text patch is available for this file."}
        </EmptyState>
      )}
    </section>
  );
}

function LazyDiffFileSection(props: {
  environmentId: string;
  target: DiffTarget;
  mergeBaseRef: string | null;
  diffView: "unified" | "split";
  file: ChangedFile;
  patch: string | undefined;
  viewed: boolean;
  truncated: boolean;
  onViewedChange: (file: ChangedFile, viewed: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [placeholderHeight, setPlaceholderHeight] = useState(180);
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setActive(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          setActive(true);
        } else {
          const height = element.getBoundingClientRect().height;
          if (height > 0) setPlaceholderHeight(height);
          setActive(false);
        }
      },
      { rootMargin: "700px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={containerRef}
      id={diffSectionId(props.environmentId, props.file.path)}
      style={active ? undefined : { height: `${placeholderHeight}px` }}
    >
      {active ? (
        <DiffFileSection {...props} />
      ) : (
        <div className="flex h-full min-h-32 items-start gap-2 border-b border-border px-3 py-3 text-xs text-muted-foreground">
          <Icon name="FileText" className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate font-mono">{props.file.path}</span>
          <span>Scroll to load</span>
        </div>
      )}
    </div>
  );
}

function ViewOptionsMenu({
  fileView,
  fileNavigation,
  diffView,
  onFileViewChange,
  onFileNavigationChange,
  onDiffViewChange,
}: {
  fileView: "single" | "multiple";
  fileNavigation: "tree" | "list";
  diffView: "unified" | "split";
  onFileViewChange: (value: "single" | "multiple") => void;
  onFileNavigationChange: (value: "tree" | "list") => void;
  onDiffViewChange: (value: "unified" | "split") => void;
}) {
  const itemClass = "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-7 pr-2 text-xs outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Diff view settings">
          <Icon name="Settings" className="size-4" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={5}
          align="start"
          className="z-50 min-w-48 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <DropdownMenu.Label className="px-2 py-1 text-[10px] font-medium text-muted-foreground">Files</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={fileView} onValueChange={(value) => onFileViewChange(value as "single" | "multiple")}>
            <DropdownMenu.RadioItem value="single" className={itemClass}>
              <DropdownMenu.ItemIndicator className="absolute left-2"><Icon name="Check" className="size-3.5" /></DropdownMenu.ItemIndicator>
              Single file
            </DropdownMenu.RadioItem>
            <DropdownMenu.RadioItem value="multiple" className={itemClass}>
              <DropdownMenu.ItemIndicator className="absolute left-2"><Icon name="Check" className="size-3.5" /></DropdownMenu.ItemIndicator>
              Multiple files
            </DropdownMenu.RadioItem>
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Label className="px-2 py-1 text-[10px] font-medium text-muted-foreground">Navigation</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={fileNavigation} onValueChange={(value) => onFileNavigationChange(value as "tree" | "list")}>
            <DropdownMenu.RadioItem value="tree" className={itemClass}>
              <DropdownMenu.ItemIndicator className="absolute left-2"><Icon name="Check" className="size-3.5" /></DropdownMenu.ItemIndicator>
              File tree
            </DropdownMenu.RadioItem>
            <DropdownMenu.RadioItem value="list" className={itemClass}>
              <DropdownMenu.ItemIndicator className="absolute left-2"><Icon name="Check" className="size-3.5" /></DropdownMenu.ItemIndicator>
              File list
            </DropdownMenu.RadioItem>
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Label className="px-2 py-1 text-[10px] font-medium text-muted-foreground">Diff layout</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={diffView} onValueChange={(value) => onDiffViewChange(value as "unified" | "split")}>
            <DropdownMenu.RadioItem value="unified" className={itemClass}>
              <DropdownMenu.ItemIndicator className="absolute left-2"><Icon name="Check" className="size-3.5" /></DropdownMenu.ItemIndicator>
              Unified
            </DropdownMenu.RadioItem>
            <DropdownMenu.RadioItem value="split" className={itemClass}>
              <DropdownMenu.ItemIndicator className="absolute left-2"><Icon name="Check" className="size-3.5" /></DropdownMenu.ItemIndicator>
              Split
            </DropdownMenu.RadioItem>
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function DiffTreePanel({ threadId, environment }: { threadId: string; environment: { id: string } | null }) {
  const visible = experimental_useTabVisible();
  const { values: settingValues, isLoading: settingsLoading } = useSettings();
  const sidebarPosition = settingValues?.sidebarPosition === "right" ? "right" : "left";
  const defaultFileView = settingValues?.fileView === "multiple" ? "multiple" : "single";
  const defaultFileNavigation = settingValues?.fileNavigation === "list" ? "list" : "tree";
  const defaultDiffView = settingValues?.diffView === "split" ? "split" : "unified";
  const environmentId = environment?.id ?? "";
  const [changeTarget, setChangeTarget] = useState("all");
  const status = experimental_useRpcQuery({
    pluginId: "bb--git",
    contract: gitContract,
    method: "status",
    input: { keys: environmentId ? [environmentId] : [] },
    enabled: visible && environmentId !== "",
  });
  const statusRow = status.data?.[environmentId];
  const mergeBase = statusRow?.outcome === "available" ? statusRow.workspace.mergeBase : null;
  const commits = mergeBase?.commits ?? [];
  const selectedCommitSha = changeTarget.startsWith("commit:") ? changeTarget.slice(7) : null;
  const effectiveChangeTarget = selectedCommitSha && commits.some((commit) => commit.sha === selectedCommitSha)
    ? changeTarget
    : changeTarget === "uncommitted" || mergeBase === null
      ? "uncommitted"
      : "all";
  const target = useMemo<DiffTarget | null>(() => {
    if (statusRow?.outcome !== "available") return null;
    if (effectiveChangeTarget === "uncommitted") return { type: "uncommitted" };
    if (effectiveChangeTarget.startsWith("commit:")) {
      return { type: "commit", sha: effectiveChangeTarget.slice(7) };
    }
    return mergeBase
      ? { type: "all", mergeBaseBranch: mergeBase.mergeBaseBranch }
      : { type: "uncommitted" };
  }, [effectiveChangeTarget, mergeBase, statusRow]);
  const files = experimental_useRpcQuery({
    pluginId: "bb--git",
    contract: gitContract,
    method: "files",
    input: {
      environmentId,
      target: target ?? { type: "uncommitted" },
      ignoreWhitespace: false,
    },
    enabled: visible && target !== null,
  });
  const diff = experimental_useRpcQuery({
    pluginId: "bb--git",
    contract: gitContract,
    method: "diff",
    input: {
      environmentId,
      target: target ?? { type: "uncommitted" },
      maxDiffBytes: 2 * 1024 * 1024,
      maxFileListBytes: 256 * 1024,
    },
    enabled: visible && target !== null,
  });
  const viewed = experimental_useRpcQuery({
    pluginId: "bb--git",
    contract: gitContract,
    method: "viewed",
    input: {
      environmentId,
      target: target ?? { type: "uncommitted" },
    },
    enabled: visible && target !== null,
  });
  const markViewed = experimental_useRpcMutation({
    pluginId: "bb--git",
    contract: gitContract,
    method: "markViewed",
  });
  const clearViewed = experimental_useRpcMutation({
    pluginId: "bb--git",
    contract: gitContract,
    method: "clearViewed",
  });

  const changedFiles = files.data?.outcome === "available" ? files.data.files : [];
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [viewedOverrides, setViewedOverrides] = useState<Map<string, boolean>>(() => new Map());
  const [showSidebar, setShowSidebar] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [resizeStart, setResizeStart] = useState<{ x: number; width: number; pointerId: number } | null>(null);
  const [fileView, setFileView] = useState<"single" | "multiple">(defaultFileView);
  const [fileNavigation, setFileNavigation] = useState<"tree" | "list">(defaultFileNavigation);
  const [diffView, setDiffView] = useState<"unified" | "split">(defaultDiffView);
  const [preferencesReady, setPreferencesReady] = useState(false);
  useEffect(() => {
    if (settingsLoading) return;
    setPreferencesReady(false);
    let saved: unknown = null;
    try {
      saved = JSON.parse(localStorage.getItem(`diff-tree:view:${threadId}`) ?? "null");
    } catch {
      saved = null;
    }
    const record = saved && typeof saved === "object" ? saved as Record<string, unknown> : {};
    setFileView(record.fileView === "multiple" || record.fileView === "single" ? record.fileView : defaultFileView);
    setFileNavigation(record.fileNavigation === "list" || record.fileNavigation === "tree" ? record.fileNavigation : defaultFileNavigation);
    setDiffView(record.diffView === "split" || record.diffView === "unified" ? record.diffView : defaultDiffView);
    setPreferencesReady(true);
  }, [defaultDiffView, defaultFileNavigation, defaultFileView, settingsLoading, threadId]);
  useEffect(() => {
    if (!preferencesReady) return;
    try {
      localStorage.setItem(
        `diff-tree:view:${threadId}`,
        JSON.stringify({ fileView, fileNavigation, diffView }),
      );
    } catch {
      // The view still works when browser storage is unavailable.
    }
  }, [diffView, fileNavigation, fileView, preferencesReady, threadId]);
  const effectiveSelectedPath =
    changedFiles.some((file) => file.path === selectedPath)
      ? selectedPath
      : changedFiles[0]?.path ?? null;
  const selectedFile = changedFiles.find((file) => file.path === effectiveSelectedPath) ?? null;
  const filteredFiles = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return changedFiles.filter((file) => {
      if (normalized === "") return true;
      return file.path.toLocaleLowerCase().includes(normalized)
        || file.previousPath?.toLocaleLowerCase().includes(normalized) === true;
    });
  }, [changedFiles, query]);
  const tree = useMemo(() => buildTree(filteredFiles), [filteredFiles]);
  const patches = useMemo(() => {
    const result = patchesByPath(diff.data?.outcome === "available" ? diff.data.diff.diff : "");
    if (files.data?.outcome === "available") {
      for (const initial of files.data.initialPatches) result.set(initial.path, initial.patch);
    }
    return result;
  }, [diff.data, files.data]);
  const selectedPatch = effectiveSelectedPath ? patches.get(effectiveSelectedPath) : undefined;
  const viewedPaths = useMemo(() => {
    const current = new Map(changedFiles.map((file) => [file.path, file.revision]));
    const result = new Set(
      (viewed.data?.files ?? [])
        .filter((file) => current.get(file.path) === file.revision)
        .map((file) => file.path),
    );
    for (const input of markViewed.pendingInputs) result.add(input.path);
    for (const input of clearViewed.pendingInputs) if (input.path) result.delete(input.path);
    for (const [path, isViewed] of viewedOverrides) {
      if (isViewed) result.add(path);
      else result.delete(path);
    }
    return result;
  }, [changedFiles, clearViewed.pendingInputs, markViewed.pendingInputs, viewed.data, viewedOverrides]);

  const loading = status.isLoading || (target !== null && (files.isLoading || diff.isLoading || viewed.isLoading));
  const rpcError = status.error ?? files.error ?? diff.error ?? viewed.error;
  const viewedWriteError = markViewed.error ?? clearViewed.error;
  const outcomeError =
    statusRow && statusRow.outcome !== "available"
      ? errorMessage(statusRow)
      : files.data && files.data.outcome !== "available"
        ? errorMessage(files.data)
        : diff.data && diff.data.outcome !== "available"
          ? errorMessage(diff.data)
          : null;

  const refetch = () => {
    void Promise.all([status.refetch(), files.refetch(), diff.refetch(), viewed.refetch()]);
  };
  const setFilesViewed = (nextFiles: ChangedFile[], nextViewed: boolean) => {
    if (target === null || nextFiles.length === 0) return;
    const paths = nextFiles.map((file) => file.path);
    setViewedOverrides((current) => {
      const next = new Map(current);
      for (const path of paths) next.set(path, nextViewed);
      return next;
    });
    markViewed.reset();
    clearViewed.reset();
    const operations = nextFiles.map((file) => {
      const request = { environmentId, target, path: file.path };
      return nextViewed
        ? markViewed.mutate({ ...request, revision: file.revision })
        : clearViewed.mutate(request);
    });
    void Promise.allSettled(operations).then(async () => {
      await viewed.refetch();
      setViewedOverrides((current) => {
        const next = new Map(current);
        for (const path of paths) {
          if (next.get(path) === nextViewed) next.delete(path);
        }
        return next;
      });
    });
  };
  const setViewed = (file: ChangedFile, nextViewed: boolean) => {
    setFilesViewed([file], nextViewed);
  };
  const selectFile = (file: ChangedFile) => {
    setSelectedPath(file.path);
    if (fileView === "multiple") {
      requestAnimationFrame(() => {
        const element = document.getElementById(diffSectionId(environmentId, file.path));
        const scroller = element?.closest<HTMLElement>("[data-diff-scroll]");
        if (!element || !scroller) return;
        const top = scroller.scrollTop + element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        scroller.scrollTo({ top, left: scroller.scrollLeft, behavior: "smooth" });
      });
    }
  };

  if (environment === null) {
    return <EmptyState>This thread has no workspace.</EmptyState>;
  }
  if (loading && changedFiles.length === 0) {
    return <EmptyState>Loading changed files…</EmptyState>;
  }
  if (rpcError || outcomeError) {
    return (
      <EmptyState>
        <p>{rpcError ? errorMessage(rpcError) : outcomeError}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={refetch}>
          Retry
        </Button>
      </EmptyState>
    );
  }
  if (changedFiles.length === 0) {
    return <EmptyState>No changed files.</EmptyState>;
  }

  const truncated = diff.data?.outcome === "available" && diff.data.diff.truncated;
  const navigation = fileNavigation === "tree" ? (
    <TreeRows
      nodes={tree}
      selectedPath={effectiveSelectedPath}
      viewedPaths={viewedPaths}
      collapsed={collapsed}
      onToggleFolder={(path) => {
        setCollapsed((current) => {
          const next = new Set(current);
          if (next.has(path)) next.delete(path);
          else next.add(path);
          return next;
        });
      }}
      onSelect={selectFile}
      onViewedChange={setViewed}
      onFilesViewedChange={setFilesViewed}
    />
  ) : (
    filteredFiles.map((file) => (
      <FileNavRow
        key={file.path}
        file={file}
        label={file.path}
        selected={effectiveSelectedPath === file.path}
        viewed={viewedPaths.has(file.path)}
        paddingLeft={4}
        onSelect={selectFile}
        onViewedChange={setViewed}
      />
    ))
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1">
        <div
          className={cn(
            "flex items-center gap-1",
            sidebarPosition === "right" ? "order-2 ml-auto flex-row-reverse" : "order-1",
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setShowSidebar((value) => !value)}
            aria-label={showSidebar ? "Hide file sidebar" : "Show file sidebar"}
            aria-pressed={showSidebar}
          >
            <Icon name={sidebarPosition === "right" ? "PanelRight" : "PanelLeft"} className="size-4" />
          </Button>
          <ViewOptionsMenu
            fileView={fileView}
            fileNavigation={fileNavigation}
            diffView={diffView}
            onFileViewChange={setFileView}
            onFileNavigationChange={setFileNavigation}
            onDiffViewChange={setDiffView}
          />
        </div>
        <div
          className={cn(
            "flex min-w-20 flex-1 items-center gap-1",
            sidebarPosition === "right" ? "order-1" : "order-2 justify-end",
          )}
        >
          <span className={cn("min-w-0 flex-1 truncate text-xs text-muted-foreground", sidebarPosition === "left" && "text-right")}>
            {files.data?.outcome === "available" ? files.data.shortstat : `${changedFiles.length} files`}
          </span>
          {viewedWriteError ? <span className="text-xs text-destructive">Viewed update failed</span> : null}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={refetch} aria-label="Refresh diff">
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {showSidebar ? (
          <aside
            className={cn(
              "relative flex shrink-0 flex-col bg-card/40",
              sidebarPosition === "right" ? "order-2 border-l border-border" : "order-1 border-r border-border",
            )}
            style={{ width: `${sidebarWidth}px` }}
          >
            <div
              role="separator"
              aria-label="Resize file sidebar"
              aria-orientation="vertical"
              aria-valuemin={180}
              aria-valuemax={480}
              aria-valuenow={sidebarWidth}
              tabIndex={0}
              className={cn(
                "absolute inset-y-0 z-20 w-1.5 touch-none cursor-col-resize hover:bg-primary/20",
                resizeStart && "bg-primary/30",
                sidebarPosition === "right" ? "-left-1" : "-right-1",
              )}
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                setResizeStart({ x: event.clientX, width: sidebarWidth, pointerId: event.pointerId });
              }}
              onPointerMove={(event) => {
                if (resizeStart === null || resizeStart.pointerId !== event.pointerId) return;
                const delta = sidebarPosition === "right"
                  ? resizeStart.x - event.clientX
                  : event.clientX - resizeStart.x;
                setSidebarWidth(Math.min(480, Math.max(180, resizeStart.width + delta)));
              }}
              onPointerUp={(event) => {
                if (resizeStart?.pointerId !== event.pointerId) return;
                event.currentTarget.releasePointerCapture(event.pointerId);
                setResizeStart(null);
              }}
              onPointerCancel={() => setResizeStart(null)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const physicalDelta = event.key === "ArrowRight" ? 16 : -16;
                const widthDelta = sidebarPosition === "right" ? -physicalDelta : physicalDelta;
                setSidebarWidth((width) => Math.min(480, Math.max(180, width + widthDelta)));
              }}
            />
            <div className="space-y-2 p-2">
              <select
                value={effectiveChangeTarget}
                onChange={(event) => setChangeTarget(event.target.value)}
                aria-label="Select changes to show"
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
              >
                {mergeBase ? <option value="all">All changes</option> : null}
                <option value="uncommitted">Uncommitted changes</option>
                {commits.map((commit) => (
                  <option key={commit.sha} value={`commit:${commit.sha}`}>
                    {commit.shortSha} · {commit.subject}
                  </option>
                ))}
              </select>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search file paths"
                aria-label="Search changed files"
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                {filteredFiles.length} of {changedFiles.length} files · {viewedPaths.size} viewed
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
              {filteredFiles.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">No matching files.</p>
              ) : navigation}
            </div>
          </aside>
        ) : null}
        <main data-diff-scroll className={cn("min-w-0 flex-1 overflow-auto", sidebarPosition === "right" ? "order-1" : "order-2")}>
          {fileView === "multiple" ? (
            filteredFiles.length === 0 ? (
              <EmptyState>No files match the current search and filter.</EmptyState>
            ) : (
              filteredFiles.map((file) => (
                <LazyDiffFileSection
                  key={file.path}
                  environmentId={environmentId}
                  target={target ?? { type: "uncommitted" }}
                  mergeBaseRef={files.data?.outcome === "available" ? files.data.mergeBaseRef : null}
                  diffView={diffView}
                  file={file}
                  patch={patches.get(file.path)}
                  viewed={viewedPaths.has(file.path)}
                  truncated={truncated}
                  onViewedChange={setViewed}
                />
              ))
            )
          ) : selectedFile === null ? null : (
            <div id={diffSectionId(environmentId, selectedFile.path)}>
              <DiffFileSection
                environmentId={environmentId}
                target={target ?? { type: "uncommitted" }}
                mergeBaseRef={files.data?.outcome === "available" ? files.data.mergeBaseRef : null}
                diffView={diffView}
                file={selectedFile}
                patch={selectedPatch}
                viewed={viewedPaths.has(selectedFile.path)}
                truncated={truncated}
                onViewedChange={setViewed}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-40 items-center justify-center p-6 text-center text-sm text-muted-foreground">
      <div>{children}</div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "fixed",
    id: "diff-tree",
    title: "Diff tree",
    tooltip: "Browse changed files as a tree",
    icon: "diff-tree/file-tree",
    layout: "flush",
    useVisible: ({ environment }) => environment !== null,
    component: DiffTreePanel,
  });
});
