import type { PluginContext } from "@getpaseo/plugin";
import { BrowserTabPanel } from "./browser-tab.client";
import { cleanupSessions, handleGetUrl } from "./browser-tab.server";
import { browserGetUrl } from "./browser-tab.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(browserGetUrl, handleGetUrl);

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

  return async () => {
    await cleanupSessions();
  };
}
