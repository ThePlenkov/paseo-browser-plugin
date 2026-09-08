import {
  type PluginWorkspacePanelProps,
  useRpc,
  useWorkspace,
} from "@getpaseo/plugin";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { linkList, navigate } from "./browser-tab.shared";

type NavResult = {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title: string | null;
  html: string;
  error: string | null;
};

type LinkItem = { text: string; href: string };

export function BrowserTabPanel({
  theme,
  layout,
  workspaceId,
}: PluginWorkspacePanelProps) {
  const workspace = useWorkspace(workspaceId, ({ directory }) => ({ directory }));
  const navigateRpc = useRpc(navigate);
  const linksRpc = useRpc(linkList);

  const [urlInput, setUrlInput] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<NavResult | null>(null);
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [iframeKey, setIframeKey] = useState(0);
  const containerRef = useRef<View>(null);

  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        backgroundColor: theme.colors.surface0,
      } as const,
      toolbar: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        padding: 8,
        backgroundColor: theme.colors.surface0,
      },
      navBtn: {
        padding: 8,
        borderRadius: 6,
        backgroundColor: theme.colors.accent,
      },
      navBtnDisabled: {
        opacity: 0.4,
      },
      navBtnText: {
        color: theme.colors.accentForeground,
        fontSize: 14,
        fontWeight: "600" as const,
      },
      urlInput: {
        flex: 1,
        padding: 8,
        borderRadius: 6,
        backgroundColor: theme.colors.surface0,
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        color: theme.colors.foreground,
        fontSize: 14,
      },
      content: {
        flex: 1,
      } as const,
      status: {
        padding: 8,
        backgroundColor: theme.colors.surface0,
      },
      statusText: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
      },
      error: {
        color: theme.colors.statusDanger,
        fontSize: 13,
      },
      title: {
        color: theme.colors.foreground,
        fontSize: 16,
        fontWeight: "600" as const,
      },
      linkItem: {
        padding: 10,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.foregroundMuted,
      },
      linkText: {
        color: theme.colors.accent,
        fontSize: 14,
      },
      linkHref: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
        marginTop: 2,
      },
      mobileContent: {
        padding: 12,
        gap: 8,
      },
      empty: {
        flex: 1,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        gap: 12,
      },
      emptyText: {
        color: theme.colors.foregroundMuted,
        fontSize: 14,
        textAlign: "center" as const,
      },
      loadingRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        padding: 12,
      },
      iframeContainer: {
        flex: 1,
      } as const,
    }),
    [theme],
  );

  const doNavigate = useCallback(
    async (rawUrl: string) => {
      const target = rawUrl.trim();
      if (!target) return;
      setLoading(true);
      setLinks([]);
      try {
        const res = await navigateRpc({ url: target, workspaceId });
        setResult(res);
        setCurrentUrl(res.finalUrl);
        setUrlInput(res.finalUrl);
        if (!res.error) {
          setHistory((prev) => {
            const next = [...prev.slice(0, historyIndex + 1), res.finalUrl];
            setHistoryIndex(next.length - 1);
            return next;
          });
          if (layout.platform === "web") {
            setIframeKey((k) => k + 1);
          } else {
            const linkRes = await linksRpc({ url: res.finalUrl, workspaceId });
            setLinks(linkRes.links);
          }
        }
      } catch (err) {
        setResult({
          url: target,
          finalUrl: target,
          status: 0,
          contentType: "unknown",
          title: null,
          html: "",
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setLoading(false);
      }
    },
    [navigateRpc, linksRpc, workspaceId, historyIndex, layout.platform],
  );

  const goBack = () => {
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    const url = history[newIndex];
    if (url) {
      setUrlInput(url);
      void doNavigate(url);
    }
  };

  const goForward = () => {
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    const url = history[newIndex];
    if (url) {
      setUrlInput(url);
      void doNavigate(url);
    }
  };

  const reload = () => {
    if (currentUrl) {
      setIframeKey((k) => k + 1);
      void doNavigate(currentUrl);
    }
  };

  const handleSubmit = () => void doNavigate(urlInput);

  // On web, create an iframe via DOM to display fetched HTML (srcdoc)
  useEffect(() => {
    if (layout.platform !== "web" || !result?.html || result.error) return;
    const container = containerRef.current as unknown as {
      _nativeTag?: HTMLElement;
    } | null;
    // React Native Web exposes the DOM node via the ref's _nativeTag
    const domNode = container?._nativeTag;
    if (!domNode) return;
    domNode.innerHTML = "";
    const iframe = document.createElement("iframe");
    iframe.srcdoc = result.html;
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "none";
    iframe.style.backgroundColor = "#fff";
    iframe.title = result.title ?? "Browser";
    domNode.appendChild(iframe);
  }, [result, iframeKey, layout.platform]);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  return (
    <View style={styles.screen}>
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={goBack}
          disabled={!canGoBack}
          style={[styles.navBtn, !canGoBack && styles.navBtnDisabled]}
        >
          <Text style={styles.navBtnText}>{"<"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Forward"
          onPress={goForward}
          disabled={!canGoForward}
          style={[styles.navBtn, !canGoForward && styles.navBtnDisabled]}
        >
          <Text style={styles.navBtnText}>{">"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reload"
          onPress={reload}
          disabled={!currentUrl}
          style={[styles.navBtn, !currentUrl && styles.navBtnDisabled]}
        >
          <Text style={styles.navBtnText}>{"\u21bb"}</Text>
        </Pressable>
        <TextInput
          value={urlInput}
          onChangeText={setUrlInput}
          onSubmitEditing={handleSubmit}
          placeholder="Enter URL or localhost:3000"
          placeholderTextColor={theme.colors.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={styles.urlInput}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go"
          onPress={handleSubmit}
          style={styles.navBtn}
        >
          <Text style={styles.navBtnText}>Go</Text>
        </Pressable>
      </View>

      <View style={styles.content}>
        {loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={styles.statusText}>Loading {urlInput}...</Text>
          </View>
        )}

        {result?.error && !loading && (
          <View style={styles.mobileContent}>
            <Text style={styles.error}>Error: {result.error}</Text>
          </View>
        )}

        {!loading && !result && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              Enter a URL above to browse from the daemon machine.
            </Text>
            {workspace?.directory && (
              <Text style={styles.emptyText}>
                Workspace: {workspace.directory}
              </Text>
            )}
          </View>
        )}

        {layout.platform === "web" && result?.html && !result.error && !loading && (
          <View ref={containerRef} style={styles.iframeContainer} key={iframeKey} />
        )}

        {layout.platform !== "web" && result && !result.error && !loading && (
          <ScrollView>
            <View style={styles.mobileContent}>
              {result.title && <Text style={styles.title}>{result.title}</Text>}
              <Text style={styles.statusText}>
                {result.status} - {result.contentType}
              </Text>
              <Text style={styles.statusText}>{result.finalUrl}</Text>
              {links.length > 0 && (
                <View style={{ gap: 0, marginTop: 8 }}>
                  {links.map((link, i) => (
                    <Pressable
                      key={`${link.href}-${i}`}
                      accessibilityRole="link"
                      onPress={() => {
                        setUrlInput(link.href);
                        void doNavigate(link.href);
                      }}
                      style={styles.linkItem}
                    >
                      <Text style={styles.linkText} numberOfLines={2}>
                        {link.text}
                      </Text>
                      <Text style={styles.linkHref} numberOfLines={1}>
                        {link.href}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          </ScrollView>
        )}
      </View>
    </View>
  );
}
