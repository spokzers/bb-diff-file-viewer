Browse a thread's changed files as a real folder tree instead of scanning one flat list.

## What you get

- A fixed **Diff tree** tab on every thread that has a Git workspace.
- A file sidebar that can sit on the left or right.
- Collapsible tree and flat-list navigation.
- Single-file and multiple-file diff views.
- Path search, change-type filtering, and shared Viewed marks.
- Change status plus addition and deletion counts for each file.
- BB's native diff rendering, including the active code theme and compatible diff-renderer plugins.

## How it works

Diff Tree reads status and patch data from BB's bundled Git plugin. It compares the workspace with its configured merge base, falls back to uncommitted changes when no merge base exists, and keeps repository data local to BB.

The plugin does not modify files, run commits, or send code to an external service.
