/**
 * HlsWebPlayer — provider-session WebView fallback for Dizipal native streams.
 *
 * The native (expo-video / ExoPlayer) attempt runs first and stays first; this
 * component is only mounted after PlayerScreen has given up on the native
 * pipeline. Once mounted, it recreates the embed host's browser session,
 * refreshes the stream URL through the same getVideo endpoint as its player,
 * and renders only the app-controlled video surface.
 *
 * Why a single persistent WebView
 * --------------------------------
 * Two earlier designs failed:
 *
 *   1. Warm-up WebView at the stream origin root + separate player WebView.
 *      imagestoo.com's protected resource lives under `/cdn/hls/…`, so a GET
 *      against the root often returns 200 or 404 with no challenge served at
 *      all — cf_clearance is never minted, the player WebView's manifest fetch
 *      lands cold and times out. Two-instance cookie sharing on Android can
 *      also race (the warm-up unmounts before the player mounts).
 *   2. Treating onLoadEnd / onError / onHttpError as the same success signal.
 *      Any of these fire even when the WebView loaded a 403 or a CF challenge
 *      HTML; "we got a load event" is not "the cookie store has clearance".
 *
 * This rebuild does both differently:
 *
 *   • One WebView, whose initial navigation IS the exact embed URL the resolver
 *     captured (`playerResult.embedUrl`). That's where a browser normally
 *     enters; if CF challenges anywhere, it challenges here. After the WebView
 *     finishes loading we can be reasonably sure cookies match what a browser
 *     visiting the embed in a tab would have.
 *   • `injectedJavaScript` runs at every page load. It actively *qualifies*
 *     the session before installing the player by performing a same-origin
 *     credentialed fetch of the manifest. The player overlay only goes up
 *     after that fetch returns 200 with an `#EXTM3U` body — proof that
 *     subsequent media requests will succeed with whatever cookies are now in
 *     place.
 *   • The script reports every milestone (navigated, cf_challenge_pending,
 *     probing, probe_status, qualified, manifest_parsed, level_loaded,
 *     frag_loaded, ready, error, …). Failures point at a specific step
 *     instead of being lumped into a single "stall".
 *
 * Why the player runs as an overlay on the navigated page
 * -------------------------------------------------------
 * Rather than replace `documentElement` (which provokes CSP edge cases on
 * pages that ship one), we append a fixed-position max-z-index `<div>` with
 * our `<video>` element. Almost every CSP that ships in the wild allows
 * inline styles for layout; it's external `script-src` that's the gotcha —
 * which we handle by trying jsdelivr and falling back to unpkg before giving
 * up to native HLS (Safari/WKWebView).
 */

import { memo, useCallback, useMemo } from "react";
import { View } from "react-native";
import WebView, { type WebViewMessageEvent } from "react-native-webview";

type Subtitle = { url: string; label: string; lang: string };

export type HlsWebPlayerEvent =
  | { type: "ready" }
  | { type: "playing" }
  | { type: "waiting" }
  | { type: "ended" }
  | { type: "error"; message: string }
  | { type: "time"; positionSeconds: number; durationSeconds: number };

interface Props {
  streamUrl: string;
  embedUrl?: string | null;
  pageUrl?: string | null;
  referer?: string | null;
  poster?: string | null;
  subtitles?: Subtitle[];
  onEvent?: (event: HlsWebPlayerEvent) => void;
}

const HLS_CDN_PRIMARY = "https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js";
const HLS_CDN_FALLBACK = "https://unpkg.com/hls.js@1.5.13/dist/hls.min.js";

function debug(...args: unknown[]) {
  if (__DEV__) console.log("[HlsWebPlayer]", ...args);
}

/**
 * Pick the URL the WebView should NAVIGATE to before playing. The cookies and
 * Cloudflare challenge state acquired by this load are what subsequent media
 * fetches will reuse. Priority:
 *
 *   1. embedUrl — the iframe URL the Dizipal page would have loaded. On
 *      imagestoo this is `https://imagestoo.com/embed/…`, which is exactly
 *      where Cloudflare's JS challenge fires.
 *   2. referer — when the resolver did not go through the embed path it now
 *      stores the full Dizipal episode page URL here. That's still a real
 *      page navigation, just one origin away from the eventual media GET.
 *   3. streamUrl origin — last resort. Better than nothing if Cloudflare DOES
 *      happen to challenge the root, worthless if it doesn't.
 */
function pickWarmUrl(streamUrl: string, embedUrl?: string | null, referer?: string | null): string {
  if (embedUrl && /^https?:\/\//i.test(embedUrl)) return embedUrl;
  if (referer && /^https?:\/\/.+\/.+/.test(referer)) return referer;
  try {
    return new URL(streamUrl).origin + "/";
  } catch {
    return streamUrl;
  }
}

function embedHashOf(embedUrl?: string | null): string {
  return embedUrl?.match(/\/video\/([a-z0-9]{8,})/i)?.[1] ?? "";
}

function buildInjection(
  streamUrl: string,
  embedUrl?: string | null,
  pageUrl?: string | null
): string {
  // ES5 only — older Android WebView builds (HyperOS / MIUI) have flaky
  // ES2020+ support. No arrow functions, no template literals, no optional
  // chaining, no `let`/`const`-only constructs the parser might choke on.
  return `(function(){
  if (window.__sbHlsBooted) return;
  window.__sbHlsBooted = true;

  var STREAM = ${JSON.stringify(streamUrl)};
  var EMBED_HASH = ${JSON.stringify(embedHashOf(embedUrl))};
  var PAGE_URL = ${JSON.stringify(pageUrl ?? "")};
  var IS_HLS = /\\.m3u8(?:[?#]|$)/i.test(STREAM);
  var HLS_CDN_PRIMARY = ${JSON.stringify(HLS_CDN_PRIMARY)};
  var HLS_CDN_FALLBACK = ${JSON.stringify(HLS_CDN_FALLBACK)};
  var SESSION_BUDGET_MS = 14000;
  var sessionStart = Date.now();
  var installed = false;

  function post(o) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch (e) {}
  }
  function budgetLeft() {
    return Math.max(0, SESSION_BUDGET_MS - (Date.now() - sessionStart));
  }
  function abortSignal(ms) {
    if (typeof AbortController === 'undefined') return null;
    var c = new AbortController();
    setTimeout(function(){ try { c.abort(); } catch(e){} }, ms);
    return c.signal;
  }

  function onChallengePage() {
    try {
      var t = (document.title || '').toLowerCase();
      if (t.indexOf('just a moment') >= 0) return true;
      if (t.indexOf('checking your browser') >= 0) return true;
      if (document.querySelector('script[src*="challenges.cloudflare.com"]')) return true;
      if (document.querySelector('#cf-challenge-running, #cf-bubbles, .cf-browser-verification')) return true;
      var b = document.body && document.body.className ? document.body.className.toLowerCase() : '';
      if (b.indexOf('no-js') >= 0 && document.querySelector('iframe[src*="challenges.cloudflare.com"]')) return true;
    } catch (e) {}
    return false;
  }

  function waitForChallenge(callback, attempt) {
    if (!onChallengePage()) { callback(); return; }
    if (attempt >= 16) { post({t:'error', m:'cf_challenge_persistent'}); return; }
    if (attempt === 0) post({t:'cf_challenge_pending'});
    setTimeout(function(){ waitForChallenge(callback, attempt + 1); }, 500);
  }

  function resolveSessionStream(callback) {
    if (!EMBED_HASH || !location || !location.origin) { callback(); return; }

    var apiBudget = Math.min(4000, budgetLeft());
    var endpoint = location.origin + '/player/index.php?data=' + encodeURIComponent(EMBED_HASH) + '&do=getVideo';
    var body = 'hash=' + encodeURIComponent(EMBED_HASH) + '&r=' + encodeURIComponent(PAGE_URL);
    post({t:'session_stream_request', budget:budgetLeft()});

    fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body,
      signal: abortSignal(apiBudget)
    }).then(function(r){
      post({t:'session_stream_status', code:r.status, ok:r.ok});
      if (!r.ok) throw new Error('session_http_' + r.status);
      return r.text();
    }).then(function(raw){
      var data = JSON.parse(raw);
      var candidate = data && (data.videoSource || data.securedLink);
      if (candidate && /^https?:\/\//i.test(candidate)) {
        STREAM = candidate;
        IS_HLS = data.hls === true || /\\.m3u8(?:[?#]|$)/i.test(candidate);
        post({t:'session_stream_resolved', hls:IS_HLS});
      }
      callback();
    }).catch(function(e){
      post({t:'session_stream_failed', m:String((e && (e.name || e.message)) || 'unknown')});
      callback();
    });
  }

  function probeAndQualify() {
    post({t:'probing', url: STREAM, budget: budgetLeft()});
    var probeBudget = Math.min(6000, budgetLeft());
    fetch(STREAM, {
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Accept': 'application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*' },
      signal: abortSignal(probeBudget)
    }).then(function(r){
      var ct = '';
      try { ct = r.headers.get('content-type') || ''; } catch (e) {}
      post({t:'probe_status', code: r.status, ct: ct, ok: r.ok});
      if (!r.ok) {
        post({t:'error', m:'probe_http_' + r.status});
        return null;
      }
      return r.text();
    }).then(function(body){
      if (body === null) return;
      var head = (body || '').slice(0, 64);
      if (head.indexOf('#EXTM3U') < 0) {
        post({t:'error', m:'probe_not_manifest', snippet: head});
        return;
      }
      post({t:'qualified', preview: head.slice(0, 16)});
      installPlayer();
    }).catch(function(e){
      var name = (e && (e.name || e.message)) || 'unknown';
      post({t:'error', m:'probe_net_' + name});
    });
  }

  function installPlayer() {
    if (installed) return;
    installed = true;

    var overlay = document.createElement('div');
    overlay.id = 'sb-player-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;width:100vw;height:100vh;z-index:2147483647;background:#000;margin:0;padding:0';
    overlay.innerHTML = '<video id="sb-v" controls playsinline preload="auto" style="width:100%;height:100%;background:#000;display:block" crossorigin="anonymous"></video>';

    // Defensive append. Some embed pages re-render their <body> shortly after
    // load; if that happens we'd lose our overlay. Hold a reference and
    // re-attach if the parent goes away.
    function ensureAttached() {
      if (!overlay.parentNode || overlay.parentNode !== document.body) {
        try { document.body.appendChild(overlay); } catch (e) {}
      }
    }
    document.body.appendChild(overlay);
    setInterval(ensureAttached, 1000);

    var v = document.getElementById('sb-v');

    v.addEventListener('canplay',    function(){ post({t:'ready'}); });
    v.addEventListener('playing',    function(){ post({t:'playing'}); });
    v.addEventListener('waiting',    function(){ post({t:'waiting'}); });
    v.addEventListener('timeupdate', function(){ post({t:'time', p:v.currentTime||0, d:v.duration||0}); });
    v.addEventListener('ended',      function(){ post({t:'ended'}); });
    v.addEventListener('error', function(){
      var code = (v.error && v.error.code) ? v.error.code : 'video';
      post({t:'error', m:'video_'+code});
    });

    function nativePlay() {
      v.src = STREAM;
      v.load();
      var p = v.play();
      if (p && p.catch) p.catch(function(e){
        post({t:'error', m:'play_native_'+(e && e.message ? e.message : e)});
      });
    }

    function startHls() {
      try {
        var hls = new window.Hls({
          maxBufferLength: 30,
          backBufferLength: 30,
          enableWorker: true,
          lowLatencyMode: false
        });
        hls.loadSource(STREAM);
        hls.attachMedia(v);
        hls.on(window.Hls.Events.MANIFEST_PARSED, function(){
          post({t:'manifest_parsed'});
          var p = v.play();
          if (p && p.catch) p.catch(function(){});
        });
        hls.on(window.Hls.Events.LEVEL_LOADED, function(){ post({t:'level_loaded'}); });
        hls.on(window.Hls.Events.FRAG_LOADED, function(_e, d){
          // Only report the first fragment so we don't spam the bridge.
          if (!hls.__firstFrag) { hls.__firstFrag = true; post({t:'frag_loaded'}); }
        });
        hls.on(window.Hls.Events.ERROR, function(_e, d){
          if (!d || !d.fatal) return;
          if (d.type === 'mediaError') { try { hls.recoverMediaError(); return; } catch (e) {} }
          post({t:'error', m:'hls_'+(d.details || d.type || 'unknown')});
        });
      } catch (e) {
        post({t:'error', m:'hls_init_'+(e && e.message ? e.message : e)});
      }
    }

    function loadHlsJs(primary, onFail) {
      var s = document.createElement('script');
      s.async = true;
      s.src = primary ? HLS_CDN_PRIMARY : HLS_CDN_FALLBACK;
      s.onload = function(){
        post({t:'hlsjs_loaded', src: primary ? 'primary' : 'fallback'});
        if (window.Hls && window.Hls.isSupported && window.Hls.isSupported()) startHls();
        else if (v.canPlayType('application/vnd.apple.mpegurl')) nativePlay();
        else post({t:'error', m:'no_hls_support'});
      };
      s.onerror = onFail;
      document.head.appendChild(s);
    }

    var isHls = IS_HLS || /\\.m3u8(?:[?#]|$)/i.test(STREAM);
    if (!isHls) { nativePlay(); return; }
    if (v.canPlayType('application/vnd.apple.mpegurl')) { nativePlay(); return; }

    loadHlsJs(true, function(){
      loadHlsJs(false, function(){
        if (v.canPlayType('application/vnd.apple.mpegurl')) nativePlay();
        else post({t:'error', m:'hlsjs_cdn_failed'});
      });
    });
  }

  // Boot
  try { post({t:'navigated', url: (location && location.href) || '', t_ms: 0}); } catch (e) {}
  waitForChallenge(function(){ resolveSessionStream(probeAndQualify); }, 0);

  // Outer escape — if we don't reach 'qualified' (or 'ready' for a non-HLS
  // direct play) inside the session budget, post a session_timeout. The host
  // already has its own watchdog; this just gives the host a precise reason.
  setTimeout(function(){
    if (!installed) post({t:'error', m:'session_timeout'});
  }, SESSION_BUDGET_MS);
})();
true;`;
}

export const HlsWebPlayer = memo(function HlsWebPlayer({
  streamUrl,
  embedUrl,
  pageUrl,
  referer,
  onEvent,
}: Props) {
  const warmUrl = useMemo(
    () => pickWarmUrl(streamUrl, embedUrl, referer),
    [streamUrl, embedUrl, referer]
  );
  const injection = useMemo(
    () => buildInjection(streamUrl, embedUrl, pageUrl),
    [streamUrl, embedUrl, pageUrl]
  );

  const onMessage = useCallback(
    (ev: WebViewMessageEvent) => {
      if (!ev.nativeEvent.data) return;
      let payload: any;
      try {
        payload = JSON.parse(ev.nativeEvent.data);
      } catch {
        return;
      }
      debug(payload);

      if (!onEvent) return;
      switch (payload.t) {
        case "ready":
        case "playing":
          onEvent({ type: "ready" });
          break;
        case "waiting":
          onEvent({ type: "waiting" });
          break;
        case "ended":
          onEvent({ type: "ended" });
          break;
        case "error":
          onEvent({ type: "error", message: String(payload.m ?? "unknown") });
          break;
        case "time":
          onEvent({
            type: "time",
            positionSeconds: Number(payload.p) || 0,
            durationSeconds: Number(payload.d) || 0,
          });
          break;
        default:
          // Diagnostic-only events (navigated, probing, qualified, …) are
          // logged via debug() above and don't bubble.
          break;
      }
    },
    [onEvent]
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <WebView
        source={{
          uri: warmUrl,
          headers: pageUrl ? { Referer: pageUrl } : undefined,
        }}
        style={{ flex: 1, backgroundColor: "#000" }}
        injectedJavaScript={injection}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        cacheEnabled
        allowsFullscreenVideo
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mixedContentMode="always"
        originWhitelist={["*"]}
        setSupportMultipleWindows={false}
        javaScriptCanOpenWindowsAutomatically={false}
        onMessage={onMessage}
      />
    </View>
  );
});
