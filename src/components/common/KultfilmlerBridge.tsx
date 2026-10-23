import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import WebView, { type WebViewMessageEvent } from "react-native-webview";

import {
  KULTFILMLER_PAGE_PROBE,
  attachKultfilmlerHost,
  handleKultfilmlerMessage,
  isKultfilmlerNavigationAllowed,
  kultfilmlerSessionUrl,
  subscribeKultfilmlerSession,
} from "../../services/kultfilmlerSession";

/**
 * The hidden WebView that holds a Kült Filmler session open past the site's
 * Cloudflare challenge (see kultfilmlerSession). Renders nothing until the
 * resolver asks the site for something, and unmounts after a quiet spell.
 */
export function KultfilmlerBridge() {
  const [open, setOpen] = useState(false);
  const webViewRef = useRef<WebView>(null);

  useEffect(() => subscribeKultfilmlerSession(setOpen), []);

  useEffect(() => {
    if (!open) return;
    attachKultfilmlerHost({
      evaluate: (script) => webViewRef.current?.injectJavaScript(script),
      reload: () => webViewRef.current?.reload(),
    });
    return () => attachKultfilmlerHost(null);
  }, [open]);

  if (!open) return null;

  return (
    <View pointerEvents="none" style={styles.host}>
      <WebView
        ref={webViewRef}
        source={{ uri: kultfilmlerSessionUrl() }}
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        setSupportMultipleWindows={false}
        javaScriptCanOpenWindowsAutomatically={false}
        mediaPlaybackRequiresUserAction
        injectedJavaScript={KULTFILMLER_PAGE_PROBE}
        onMessage={(event: WebViewMessageEvent) => handleKultfilmlerMessage(event.nativeEvent.data)}
        onShouldStartLoadWithRequest={(request) => isKultfilmlerNavigationAllowed(request.url)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Laid out (a WebView with no size may never run its page) but invisible.
  host: { position: "absolute", left: 0, bottom: 0, width: 2, height: 2, opacity: 0 },
});
