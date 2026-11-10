# bb-plugin-diff-tree

Adds a **Diff tree** tab to BB threads with a Git workspace.

The tab shows changed files in a collapsible folder tree. Selecting a file renders its unified diff with BB's native diff component, so collapsed context can be expanded and syntax highlighting, themes, and installed diff renderers continue to work.

## Features

- Resizable file sidebar on the left or right
- Collapsible folder tree or flat file list
- Single-file or multiple-file diff views
- Unified or side-by-side split diff layouts
- Previous/next hunk navigation in each file header
- Change target selector for all changes, uncommitted changes, or an individual commit
- File-path search
- Viewed marks shared with BB's Git diff state, including folder-wide marking
- Change status and per-file addition/deletion counts
- All branch changes compared with the configured merge base
- Refresh and sidebar show/hide controls
- Binary and truncated-diff states

Defaults are configurable under **Settings → Installed plugins → Diff Tree**. The view, navigation, and diff layout can be changed from the settings menu in the Diff tree tab; each thread remembers its own choices. Multiple-file mode lazily mounts nearby diffs to keep large change sets responsive.

The plugin reads Git data from BB's bundled `bb--git` plugin. It does not run Git itself and stores no repository data.

## Install

```sh
npm install
bb plugin build
bb plugin install .
```

After editing, run `bb plugin build` and `bb plugin reload diff-tree`, or use `bb plugin dev`.
