import {
  type PluginWorkspacePanelProps,
  useRpc,
} from "@getpaseo/plugin";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { browserGetUrl } from "./browser-tab.shared";

export function BrowserTabPanel({
  theme,
  workspaceId,
}: PluginWorkspacePanelProps) {
  const getUrlRpc = useRpc(browserGetUrl);
  const [iframeUrl, setIframeUrl] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);
  const loadingRef = useRef(false);

  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 } as const,
      loading: {
        flex: 1,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        gap: 12,
      },
      error: { color: theme.colors.statusDanger, fontSize: 14, padding: 16, textAlign: "center" as const },
      retryBtn: {
        paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6,
        backgroundColor: theme.colors.accent,
      } as const,
      retryText: { color: "#fff", fontSize: 13, fontWeight: "600" } as const,
      iframe: { width: "100%" as const, height: "100%" as const, border: "none" as const },
    }),
    [theme],
  );

  const init = useCallback(async () => {
    // Prevent concurrent calls — Chromium startup takes several seconds
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await getUrlRpc({});
      if (res.error) {
        setError(res.error);
      } else if (res.url) {
        setIframeUrl(res.url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [getUrlRpc]);

  useEffect(() => {
    // Only auto-init once per component lifecycle
    if (initRef.current) return;
    initRef.current = true;
    void init();
  }, [init]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.colors.accent} size="large" />
        <Text style={{ color: theme.colors.foregroundMuted }}>
          Starting remote browser...
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.loading}>
        <Text style={styles.error}>Error: {error}</Text>
        <Pressable style={styles.retryBtn} onPress={() => void init()}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!iframeUrl) {
    return (
      <View style={styles.loading}>
        <Text style={{ color: theme.colors.foregroundMuted }}>
          No browser URL received
        </Text>
        <Pressable style={styles.retryBtn} onPress={() => void init()}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  // On web, render an iframe directly
  // On mobile, this won't work — would need a WebView component
  return (
    <View style={styles.screen}>
      {/* @ts-ignore — iframe exists in web DOM */}
      <iframe src={iframeUrl} style={styles.iframe} allow="clipboard-read; clipboard-write" />
    </View>
  );
}
