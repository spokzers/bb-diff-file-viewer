import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  bb.settings.define({
    sidebarPosition: {
      type: "select",
      label: "File sidebar position",
      options: ["left", "right"],
      experimental_optionLabels: { left: "Left", right: "Right" },
      default: "left",
    },
    fileView: {
      type: "select",
      label: "Default file view",
      options: ["single", "multiple"],
      experimental_optionLabels: {
        single: "One file at a time",
        multiple: "Multiple files",
      },
      default: "single",
    },
    fileNavigation: {
      type: "select",
      label: "Default file navigation",
      options: ["tree", "list"],
      experimental_optionLabels: { tree: "Folder tree", list: "Flat list" },
      default: "tree",
    },
    diffView: {
      type: "select",
      label: "Default diff layout",
      options: ["unified", "split"],
      experimental_optionLabels: {
        unified: "Unified",
        split: "Side by side",
      },
      default: "unified",
    },
    wrapLines: {
      type: "boolean",
      label: "Wrap long diff lines by default",
      default: false,
    },
    hideViewed: {
      type: "boolean",
      label: "Hide viewed files by default",
      default: false,
    },
    hideTests: {
      type: "boolean",
      label: "Hide test files by default",
      default: false,
    },
    hideGenerated: {
      type: "boolean",
      label: "Hide generated files by default",
      default: false,
    },
  });

  bb.onDispose(() => bb.log.info("disposed"));
}
