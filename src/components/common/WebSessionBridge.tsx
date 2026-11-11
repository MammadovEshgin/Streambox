import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import WebView, { type WebViewMessageEvent } from "react-native-webview";

import type { WebSession } from "../../services/webSession";

/**
 * The hidden WebView that holds a provider session open past the site's
 * Cloudflare challenge (see webSession). Renders nothing until the resolver
 * asks the site for something, and unmounts after a quiet spell.
 */
export function WebSessionBridge({ session }: { session: WebSession }) {
  const [open, setOpen] = useState(false);
  const webViewRef = useRef<WebView>(null);

  useEffect(() => session.subscribe(setOpen), [session]);

  useEffect(() => {
    if (!open) return;
    session.attachHost({
      evaluate: (script) => webViewRef.current?.injectJavaScript(script),
      reload: () => webViewRef.current?.reload(),
    });
    return () => session.attachHost(null);
  }, [open, session]);

  if (!open) return null;

  return (
    <View pointerEvents="none" style={styles.host}>
      <WebView
        ref={webViewRef}
        source={{ uri: session.sessionUrl() }}
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        setSupportMultipleWindows={false}
        javaScriptCanOpenWindowsAutomatically={false}
        mediaPlaybackRequiresUserAction
        injectedJavaScript={session.pageProbe}
        onMessage={(event: WebViewMessageEvent) => session.handleMessage(event.nativeEvent.data)}
        onError={(event) => session.handleLoadError(event.nativeEvent.description)}
        onShouldStartLoadWithRequest={(request) => session.isNavigationAllowed(request.url)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // It must be DRAWN, not just mounted. Android skips drawing a view at zero
  // opacity, and a WebView that is never drawn gets no animation frames, so
  // Cloudflare's challenge script stalls: the 2026-10-23 release (2×2 px,
  // opacity 0) timed out on phones while desktop Chromium passed in 5s. A
  // phone-sized viewport, mounted beneath the app's screens and all but
  // transparent in case one of them is not opaque.
  host: { position: "absolute", left: 0, top: 0, width: 360, height: 640, opacity: 0.01 },
});
