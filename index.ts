import type { PluginContext } from "@getpaseo/plugin";
import { BrowserTabPanel } from "./browser-tab.client";
import { handleLinks, handleNavigate } from "./browser-tab.server";
import { linkList, navigate } from "./browser-tab.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(navigate, handleNavigate);
  plugin.handle(linkList, handleLinks);

  plugin.addWorkspacePanel({
    id: "browser-tab",
    title: "Browser",
    icon: "Globe",
    context: "workspace",
    locations: ["workspace"],
    Component: BrowserTabPanel,
  });

  plugin.addCommandCenterItem({
    id: "open-browser-tab",
    title: "Open browser tab",
    icon: "Globe",
    keywords: ["browse", "url", "web", "localhost"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("browser-tab");
    },
  });

  return () => {};
}
