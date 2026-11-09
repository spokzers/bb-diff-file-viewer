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
  });

  bb.onDispose(() => bb.log.info("disposed"));
}
