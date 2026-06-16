/**
 * WebView injection scripts for the in-app video player.
 *
 * The player runs hot-link-protected stream pages inside a WebView (HDFilm,
 * Dizipal, generic embeds). To force consistent playback across providers we
 * inject scripts at two lifecycle points:
 *
 *   - injectBefore  → before the page loads (sets up policies, blocks ads,
 *                     hijacks navigation, prepares JWPlayer init hooks).
 *   - injectAfter   → after the page loads (auto-clicks the play button,
 *                     extracts the real stream URL, signals readiness via
 *                     window.ReactNativeWebView.postMessage).
 *
 * Each injection script is a tagged template string. They run inside the
 * WebView's JS context, so they must be valid browser JS (no TS, no
 * ES2024+ syntax that older Android WebViews don't support).
 *
 * Public surface — what PlayerScreen.tsx imports:
 *   - PLAYER_WEBVIEW_USER_AGENT
 *   - PLAYER_STOP_MEDIA_SCRIPT
 *   - getInjectBefore(source, fit?)
 *   - getInjectAfter(source, mediaType, fit?, season?, episode?)
 *   - getEmbedInjectBefore(fit?)
 *   - getEmbedInjectAfter(fit?)
 *
 * Everything else (the provider-specific scripts and helpers) is private to
 * this module. The 2 kB+ template strings make this file long, but the
 * structure is flat: constants, then provider-specific builders, then the
 * dispatchers at the bottom.
 */
import {
  BLOCKED_PLAYER_NAVIGATION_PATTERNS,
  PLAYER_PASSIVE_ASSET_PATTERN,
  TRUSTED_PLAYER_FRAME_PATTERNS,
} from "./playerWebViewPolicy";

export type WebViewProviderSource = "hdfilm" | "dizipal";


// ---------------------------------------------------------------------------
// Injected player automation
// ---------------------------------------------------------------------------
export const PLAYER_WEBVIEW_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

// Player WebView navigation policy + patterns moved to ./player/playerWebViewPolicy.ts.

const PLAYER_AD_GUARD_SCRIPT = `
(function() {
  'use strict';

  var blockedPatterns = ${JSON.stringify(BLOCKED_PLAYER_NAVIGATION_PATTERNS)};
  var trustedFramePatterns = ${JSON.stringify(TRUSTED_PLAYER_FRAME_PATTERNS)};
  var passiveAssetPattern = ${PLAYER_PASSIVE_ASSET_PATTERN};
  var currentHost = '';

  try {
    currentHost = window.location.hostname.replace(/^www\\./i, '').toLowerCase();
  } catch (e) {}

  function normalize(value) {
    return String(value || '').toLowerCase();
  }

  function isBlockedUrl(value) {
    var url = normalize(value);
    if (!url) return false;
    return blockedPatterns.some(function(pattern) { return url.indexOf(pattern) !== -1; });
  }

  function isTrustedPlayerUrl(value) {
    var url = normalize(value);
    if (!url) return false;
    return trustedFramePatterns.some(function(pattern) { return url.indexOf(pattern) !== -1; });
  }

  function getHost(value) {
    try {
      return new URL(value, window.location.href).hostname.replace(/^www\\./i, '').toLowerCase();
    } catch (e) {
      return '';
    }
  }

  function isSameHostUrl(value) {
    var host = getHost(value);
    return Boolean(host && currentHost && host === currentHost);
  }

  function isPassiveAssetUrl(value) {
    return passiveAssetPattern.test(String(value || ''));
  }

  function isPlayerContainer(el) {
    if (!el || !el.closest) return false;
    return Boolean(el.closest(
      '#player, #playerbase, #mainPlayer, #playerContent, .jwplayer, .jw-wrapper, .jw-media, .jw-controls, .jw-overlays, .video-js, .vjs-control-bar, .plyr, [class*="player"], .kePlayerCont, .film-player, .video-container'
    ));
  }

  function isVisibleEnough(el) {
    try {
      var rect = el.getBoundingClientRect();
      var style = window.getComputedStyle(el);
      return rect.width >= 120 && rect.height >= 80 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.05;
    } catch (e) {
      return false;
    }
  }

  function isLikelyPlayerFrame(frame) {
    var src = frame.getAttribute('src') || '';
    if (isTrustedPlayerUrl(src) || isSameHostUrl(src)) return true;
    if (isPlayerContainer(frame) && isVisibleEnough(frame)) return true;
    return false;
  }

  function silenceMedia(media, removeSource) {
    if (!media) return;
    try {
      media.muted = true;
      media.defaultMuted = true;
      media.volume = 0;
      media.pause();
      if (removeSource) {
        media.removeAttribute('autoplay');
        media.removeAttribute('src');
        Array.prototype.forEach.call(media.querySelectorAll('source'), function(source) {
          source.removeAttribute('src');
        });
        if (typeof media.load === 'function') media.load();
      }
    } catch (e) {}
  }

  function neutralizeElement(el) {
    if (!el || el.__streamboxNeutralized) return;
    el.__streamboxNeutralized = true;
    try {
      if (el.tagName === 'IFRAME') {
        el.setAttribute('src', 'about:blank');
        el.removeAttribute('srcdoc');
      }
      el.removeAttribute('href');
      el.removeAttribute('target');
      el.removeAttribute('onclick');
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('visibility', 'hidden', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
      el.style.setProperty('opacity', '0', 'important');
      el.onclick = function(event) {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
          if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        }
        return false;
      };
    } catch (e) {}
  }

  window.open = function() { return null; };
  try {
    var originalAssign = window.location.assign.bind(window.location);
    var originalReplace = window.location.replace.bind(window.location);
    window.location.assign = function(url) {
      if (isBlockedUrl(url)) return undefined;
      return originalAssign(url);
    };
    window.location.replace = function(url) {
      if (isBlockedUrl(url)) return undefined;
      return originalReplace(url);
    };
  } catch (e) {}

  function blockClickIfNeeded(event) {
    var target = event.target;
    if (target && target.closest && target.closest('#player, #playerbase, #mainPlayer, #playerContent, .jwplayer, .jw-controls, .jw-controlbar, .jw-settings-menu, .video-js, .vjs-control-bar, .plyr, .plyr__controls')) {
      return true;
    }
    var link = target && target.closest ? target.closest('a[href], area[href], [onclick], [data-href], [data-url], [data-link]') : null;
    var href = link ? (link.href || link.getAttribute('data-href') || link.getAttribute('data-url') || link.getAttribute('data-link') || '') : '';
    var targetName = link ? normalize(link.getAttribute('target')) : '';
    var rel = link ? normalize(link.getAttribute('rel')) : '';
    var marker = link ? normalize(href + ' ' + link.id + ' ' + link.className + ' ' + link.getAttribute('onclick')) : '';

    if (link && (targetName === '_blank' || rel.indexOf('sponsored') !== -1 || isBlockedUrl(marker))) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      neutralizeElement(link);
      return false;
    }
    return true;
  }

  ['click', 'auxclick', 'touchend', 'pointerup'].forEach(function(eventName) {
    document.addEventListener(eventName, blockClickIfNeeded, true);
  });

  function guardMedia(root) {
    var doc = root || document;
    try {
      Array.prototype.forEach.call(doc.querySelectorAll('audio, video'), function(media) {
        var marker = normalize(media.id + ' ' + media.className + ' ' + media.src + ' ' + (media.currentSrc || ''));
        var hiddenOrTiny = !isVisibleEnough(media);
        var outsidePlayer = !isPlayerContainer(media);
        var trustedMediaSource = isTrustedPlayerUrl(marker) || marker.indexOf('blob:') !== -1;
        var looksLikeAd = isBlockedUrl(marker) || marker.indexOf('reklam') !== -1 || marker.indexOf('advert') !== -1 || marker.indexOf('preroll') !== -1 || marker.indexOf('vast') !== -1 || marker.indexOf('vpaid') !== -1;

        if (media.tagName === 'AUDIO' || looksLikeAd || (hiddenOrTiny && outsidePlayer && !trustedMediaSource)) {
          silenceMedia(media, looksLikeAd || (hiddenOrTiny && outsidePlayer && !trustedMediaSource));
          return;
        }

        if (media.duration && media.duration < 45 && media.playbackRate < 8 && !isPlayerContainer(media)) {
          media.playbackRate = 16;
        }
      });
    } catch (e) {}
  }

  function guardNodes(root) {
    var doc = root || document;
    try {
      Array.prototype.forEach.call(doc.querySelectorAll('iframe, embed, object, a, div, section, aside'), function(el) {
        var marker = normalize(el.id + ' ' + el.className + ' ' + (el.getAttribute('src') || '') + ' ' + (el.getAttribute('href') || ''));
        if (el.tagName === 'IFRAME') {
          var src = el.getAttribute('src') || '';
          var shouldKeep = isLikelyPlayerFrame(el) || isPassiveAssetUrl(src);
          var shouldRemove = !shouldKeep || isBlockedUrl(marker) || marker.indexOf('reklam') !== -1 || marker.indexOf('advert') !== -1 || marker.indexOf('preroll') !== -1;
          if (shouldRemove) neutralizeElement(el);
          return;
        }

        if (isBlockedUrl(marker) || marker.indexOf('reklam') !== -1 || marker.indexOf('advert') !== -1 || marker.indexOf('preroll') !== -1) {
          neutralizeElement(el);
        }
      });
    } catch (e) {}
  }

  function guard() {
    guardMedia(document);
    guardNodes(document);
    try {
      Array.prototype.forEach.call(document.querySelectorAll('iframe'), function(frame) {
        if (!isLikelyPlayerFrame(frame)) {
          neutralizeElement(frame);
          return;
        }
        try {
          var frameDoc = frame.contentDocument || (frame.contentWindow ? frame.contentWindow.document : null);
          if (frameDoc) {
            guardMedia(frameDoc);
            guardNodes(frameDoc);
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  guard();
  window.addEventListener('load', guard, true);
  setInterval(guard, 800);
  if (document.documentElement) {
    new MutationObserver(guard).observe(document.documentElement, { childList: true, subtree: true });
  }

  true;
})();
`;

export const PLAYER_STOP_MEDIA_SCRIPT = `
(function() {
  try {
    Array.prototype.forEach.call(document.querySelectorAll('audio, video'), function(media) {
      try {
        media.muted = true;
        media.defaultMuted = true;
        media.volume = 0;
        media.pause();
        media.removeAttribute('autoplay');
        media.removeAttribute('src');
        Array.prototype.forEach.call(media.querySelectorAll('source'), function(source) {
          source.removeAttribute('src');
        });
        if (typeof media.load === 'function') media.load();
      } catch (e) {}
    });
    Array.prototype.forEach.call(document.querySelectorAll('iframe'), function(frame) {
      try {
        frame.setAttribute('src', 'about:blank');
        frame.removeAttribute('srcdoc');
      } catch (e) {}
    });
  } catch (e) {}
  true;
})();
`;

const HDFILM_RUNTIME_DISCOVERY_SCRIPT = `
(function() {
  'use strict';
  if (window.__streamboxHdfilmDiscoveryInstalled) return;
  window.__streamboxHdfilmDiscoveryInstalled = true;

  var seen = {};
  var blockedPatterns = ${JSON.stringify(BLOCKED_PLAYER_NAVIGATION_PATTERNS)};
  var trustedEmbedPattern = /(rapidrame|hdfilmcehennemi\\.mobi|rplayer|vidmoly|closeload|fastplayer|filemoon|voe|streamwish|dood|mixdrop|streamtape)/i;

  function postToApp(type, payload) {
    try {
      if (!window.ReactNativeWebView || !window.ReactNativeWebView.postMessage) return;
      var message = { type: type };
      if (payload) {
        for (var key in payload) {
          if (Object.prototype.hasOwnProperty.call(payload, key)) {
            message[key] = payload[key];
          }
        }
      }
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
    } catch (e) {}
  }

  function cleanUrl(value) {
    if (!value) return '';
    return String(value)
      .replace(/\\\\\\//g, '/')
      .replace(/&amp;/g, '&')
      .replace(/["'<>\\s]+$/g, '')
      .trim();
  }

  function absoluteUrl(value) {
    var cleaned = cleanUrl(value);
    if (!cleaned) return '';
    try {
      return new URL(cleaned, window.location.href).href;
    } catch (e) {
      return '';
    }
  }

  function isDirectMediaUrl(url) {
    return /\\.(m3u8|mp4)(?:[?#].*)?$/i.test(url) || url.toLowerCase().indexOf('.m3u8') !== -1 || url.toLowerCase().indexOf('.mp4') !== -1;
  }

  function isBlockedPlaybackUrl(url) {
    var normalized = String(url || '').toLowerCase();
    return blockedPatterns.some(function(pattern) {
      return normalized.indexOf(pattern) !== -1;
    });
  }

  function isTrustedRuntimeContext() {
    return trustedEmbedPattern.test(window.location.href);
  }

  function isLikelyMovieStreamUrl(url) {
    var normalized = String(url || '').toLowerCase();
    if (isBlockedPlaybackUrl(normalized)) return false;
    if (trustedEmbedPattern.test(normalized) || isTrustedRuntimeContext()) return true;
    return /\\/hls2?\\//i.test(normalized) ||
      /\\.urlset\\//i.test(normalized) ||
      /\\/(?:master|index|playlist|manifest)\\.m3u8(?:[?#]|$)/i.test(normalized);
  }

  function inspectPlaybackUrl(value, source) {
    var url = absoluteUrl(value);
    if (!url) return;

    var key = source + ':' + url;
    if (seen[key]) return;

    if (isDirectMediaUrl(url) && isLikelyMovieStreamUrl(url)) {
      seen[key] = true;
      postToApp('hdfilm_stream_discovered', {
        streamUrl: url,
        streamType: url.toLowerCase().indexOf('.m3u8') !== -1 ? 'm3u8' : 'mp4',
        referer: window.location.href,
        embedUrl: window.location.href,
        source: source
      });
      return;
    }

    if (!isBlockedPlaybackUrl(url) && trustedEmbedPattern.test(url)) {
      seen[key] = true;
      postToApp('hdfilm_embed_discovered', {
        embedUrl: url,
        pageUrl: window.location.href,
        source: source
      });
    }
  }

  function scanTextForMediaUrls(text, source) {
    if (!text || typeof text !== 'string') return;
    var normalized = text.replace(/\\\\\\//g, '/').replace(/&amp;/g, '&');
    var directRegex = /https?:\\/\\/[^\\s"'<>]+?(?:\\.m3u8|\\.mp4)(?:[^\\s"'<>]*)?/gi;
    var match;
    while ((match = directRegex.exec(normalized)) !== null) {
      inspectPlaybackUrl(match[0], source);
    }

    var embedRegex = /https?:\\/\\/[^\\s"'<>]+?(?:rapidrame|hdfilmcehennemi\\.mobi|rplayer|vidmoly|closeload|fastplayer|filemoon|voe|streamwish|dood|mixdrop|streamtape)[^\\s"'<>]*/gi;
    while ((match = embedRegex.exec(normalized)) !== null) {
      inspectPlaybackUrl(match[0], source);
    }
  }

  function scanNode(node) {
    try {
      if (!node || node.nodeType !== 1) return;
      var attrs = ['src', 'currentSrc', 'href', 'data-link', 'data-video', 'data-url', 'data-href', 'data-src', 'data-file'];
      attrs.forEach(function(attr) {
        var value = attr === 'currentSrc' ? node.currentSrc : node.getAttribute && node.getAttribute(attr);
        if (value) inspectPlaybackUrl(value, 'dom-' + attr);
      });
      if (node.querySelectorAll) {
        node.querySelectorAll('iframe, video, source, a, button, [data-link], [data-video], [data-url], [data-href], [data-src], [data-file]').forEach(scanNode);
      }
    } catch (e) {}
  }

  function scanDocument() {
    try {
      scanNode(document.documentElement);
      scanTextForMediaUrls(document.documentElement ? document.documentElement.innerHTML : '', 'dom-html');
    } catch (e) {}
  }

  try {
    var originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
      if (/src|href|link|url|video|file/i.test(String(name || ''))) {
        inspectPlaybackUrl(value, 'setAttribute-' + name);
      }
      return originalSetAttribute.apply(this, arguments);
    };
  } catch (e) {}

  try {
    var originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
      window.fetch = function(input, init) {
        try {
          inspectPlaybackUrl(typeof input === 'string' ? input : (input && input.url), 'fetch-request');
        } catch (e) {}
        return originalFetch.apply(this, arguments).then(function(response) {
          try {
            var clone = response.clone();
            var contentType = clone.headers && clone.headers.get ? String(clone.headers.get('content-type') || '') : '';
            var requestUrl = response.url || (typeof input === 'string' ? input : (input && input.url)) || '';
            if (/json|text|html|javascript|mpegurl|mpeg/i.test(contentType) || isDirectMediaUrl(requestUrl)) {
              clone.text().then(function(text) {
                scanTextForMediaUrls(text, 'fetch-response');
              }).catch(function() {});
            }
          } catch (e) {}
          return response;
        });
      };
    }
  } catch (e) {}

  try {
    var originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      try {
        this.__streamboxUrl = url;
        inspectPlaybackUrl(url, 'xhr-request');
        this.addEventListener('load', function() {
          try {
            inspectPlaybackUrl(this.responseURL || this.__streamboxUrl, 'xhr-response-url');
            if (typeof this.responseText === 'string') {
              scanTextForMediaUrls(this.responseText, 'xhr-response');
            }
          } catch (e) {}
        });
      } catch (e) {}
      return originalOpen.apply(this, arguments);
    };
  } catch (e) {}

  function startDomWatch() {
    scanDocument();
    try {
      new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
          mutation.addedNodes && Array.prototype.forEach.call(mutation.addedNodes, scanNode);
          if (mutation.target) scanNode(mutation.target);
        });
      }).observe(document.documentElement || document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'href', 'data-link', 'data-video', 'data-url', 'data-href', 'data-src', 'data-file']
      });
    } catch (e) {}
    setInterval(scanDocument, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startDomWatch, { once: true });
  } else {
    startDomWatch();
  }
})();
`;

const DIZIPAL_INJECT_BEFORE = `
(function() {
  'use strict';

  ${PLAYER_AD_GUARD_SCRIPT}

  window.open = function() { return null; };

  var adDomains = ${JSON.stringify(BLOCKED_PLAYER_NAVIGATION_PATTERNS)};
  var _xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, url) {
    if (adDomains.some(function(domain) { return String(url).toLowerCase().includes(domain); })) return;
    return _xhrOpen.apply(this, arguments);
  };
  var _fetch = window.fetch;
  window.fetch = function(url) {
    if (adDomains.some(function(domain) { return String(url).toLowerCase().includes(domain); })) {
      return Promise.reject(new Error('blocked'));
    }
    return _fetch.apply(this, arguments);
  };

  var baseStyle = document.createElement('style');
  baseStyle.id = 'app-player-base';
  baseStyle.textContent = [
    'html, body { background: #000 !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; }',
    'body { min-height: 100vh !important; }'
  ].join('\\n');
  (document.head || document.documentElement).appendChild(baseStyle);

  true;
})();
`;

export function getEmbedInjectBefore(fit: 'contain' | 'cover' = 'contain') {
  return `
(function() {
  'use strict';
  ${PLAYER_AD_GUARD_SCRIPT}
  ${HDFILM_RUNTIME_DISCOVERY_SCRIPT}
  window.open = function() { return null; };
  var baseStyle = document.getElementById('app-fit-style');
  if (!baseStyle) {
    baseStyle = document.createElement('style');
    baseStyle.id = 'app-fit-style';
    (document.head || document.documentElement).appendChild(baseStyle);
  }
  baseStyle.textContent = [
    '*, *::before, *::after { box-sizing: border-box !important; }',
    'html, body { background: #000 !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; width: 100vw !important; height: 100vh !important; }',
    '.first-notification, .modals, .pppx, .rek, .cc-overlay, [onclick*="kapasas"], [id*="google_ads"], ins.adsbygoogle { display: none !important; }',
    '#player, #playerbase, .jwplayer, .jw-wrapper, .jw-media, video { width: 100vw !important; height: 100vh !important; position: fixed !important; top: 0 !important; left: 0 !important; z-index: 9990 !important; }',
    'video { object-fit: ${fit} !important; visibility: visible !important; opacity: 1 !important; z-index: 9991 !important; }',
    '.jw-controls, .jw-overlays, .vjs-control-bar, .plyr__controls { z-index: 9999 !important; visibility: visible !important; opacity: 1 !important; }',
    '.jw-aspect { padding-top: 0 !important; }'
  ].join('\\n');
  true;
})();
`;
}

export function getEmbedInjectAfter(fit: 'contain' | 'cover' = 'contain') {
  return `
(function() {
  'use strict';
  var readySent = false;
  var notFoundSent = false;
  var readyFallbackTimer = null;

  function postReady(reason) {
    if (readySent || notFoundSent) return;
    readySent = true;
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'player_ready', reason: reason }));
    }
  }

  function cleanup() {
    var selectors = ['.first-notification', '.modals', '.pppx', '.rek', '.cc-overlay', '[onclick*="kapasas"]', '[class*="reklam"]', '.reklam_x', '.rek_close'];
    selectors.forEach(function(sel) {
      document.querySelectorAll(sel).forEach(function(el) { el.style.setProperty('display', 'none', 'important'); });
    });

    if (typeof window.fireload === 'function' && !window.__fireloadCalled) {
      window.__fireloadCalled = true;
      try { window.fireload(); } catch(e) {}
    }
    if (typeof window.kapasas === 'function') {
      try { window.kapasas(); } catch(e) {}
    }
  }

  function isInsidePlayerControls(el) {
    // Returns true if the element is inside JWPlayer/VJS control bars
    // (not the big center play overlay, but the bottom bar controls).
    var cur = el;
    while (cur && cur !== document.body) {
      var cls = (cur.className || '').toString();
      if (cls.indexOf('jw-controlbar') !== -1 || cls.indexOf('jw-settings') !== -1 ||
          cls.indexOf('vjs-control-bar') !== -1) {
        return true;
      }
      cur = cur.parentElement;
    }
    return false;
  }

  function clickPlaybackPrompts(doc) {
    if (!doc) return;
    // Click play overlays and start buttons, but NEVER touch JWPlayer/VJS control bar internals
    var targets = doc.querySelectorAll(
      'button, [role="button"], a, div, span, .play-button, .vjs-big-play-button, ' +
      '.jw-display-icon-container, .plyr__control--overlaid, #playerCover, .player-cover-overlay'
    );
    targets.forEach(function(btn) {
      if (btn.__sbClicked) return;
      if (isInsidePlayerControls(btn)) return;

      var text = (btn.textContent || '').toLowerCase().replace(/\\s+/g, ' ').trim();
      var cls = (btn.className || '').toString().toLowerCase();
      var id = (btn.id || '').toString().toLowerCase();
      
      var shouldClick =
        cls.indexOf('jw-display-icon') !== -1 ||
        cls.indexOf('vjs-big-play') !== -1 ||
        cls.indexOf('play-button') !== -1 ||
        cls.indexOf('plyr__control--overlaid') !== -1 ||
        cls.indexOf('cover') !== -1 ||
        id === 'playercover' || id === 'skipbtn' ||
        text.indexOf('videoyu') !== -1 ||
        text.indexOf('baslat') !== -1 ||
        text.indexOf('izle') !== -1 ||
        text.indexOf('tikla') !== -1 ||
        text.indexOf('gec') !== -1 ||
        text.indexOf('skip') !== -1 ||
        text === 'play' || text === 'start';

      if (shouldClick) {
        btn.__sbClicked = true;
        btn.click();
      }
    });

    try {
      doc.querySelectorAll('iframe').forEach(function(ifrm) {
        var ifrmDoc = ifrm.contentDocument || (ifrm.contentWindow ? ifrm.contentWindow.document : null);
        if (ifrmDoc) clickPlaybackPrompts(ifrmDoc);
      });
    } catch(e) {}
  }

  function showPlayerArea() {
    var playerItems = document.querySelectorAll('video, iframe, #player, #playerbase, .jwplayer, .video-js, .plyr');
    playerItems.forEach(function(el) {
      var curr = el;
      while (curr && curr !== document.body) {
        curr.style.setProperty('display', 'block', 'important');
        curr.style.setProperty('visibility', 'visible', 'important');
        curr.style.setProperty('opacity', '1', 'important');
        curr = curr.parentElement;
      }
    });
  }

  function bindVideo(video) {
    if (!video || video.__bound) return;
    video.__bound = true;
    ['playing', 'canplay', 'loadeddata'].forEach(function(evt) {
      video.addEventListener(evt, function() { postReady('embed-video-' + evt); });
    });
    if (video.readyState >= 2) postReady('embed-video-ready');

    // Force visibility and fit
    video.style.setProperty('object-fit', '${fit}', 'important');
    video.style.setProperty('visibility', 'visible', 'important');
    video.style.setProperty('opacity', '1', 'important');
  }

  function scanAndBind(doc) {
    var root = doc || document;
    root.querySelectorAll('video').forEach(bindVideo);
    
    try {
      root.querySelectorAll('iframe').forEach(function(ifrm) {
        var ifrmDoc = ifrm.contentDocument || (ifrm.contentWindow ? ifrm.contentWindow.document : null);
        if (ifrmDoc) scanAndBind(ifrmDoc);
      });
    } catch(e) {}

    if (root === document && typeof window.jwplayer === 'function') {
      try {
        var jw = window.jwplayer();
        if (jw && !jw.__bound && typeof jw.on === 'function') {
          jw.__bound = true;
          jw.on('play', function() { postReady('jwplayer-play'); });
          jw.on('firstFrame', function() { postReady('jwplayer-firstFrame'); });
        }
        if (jw && typeof jw.getState === 'function' && jw.getState() === 'playing') {
          postReady('jwplayer-state-playing');
        }
      } catch(e) {}
    }
  }

  function forceResize() {
    if (typeof window.jwplayer === 'function') {
      try {
        var jw = window.jwplayer();
        if (jw && typeof jw.resize === 'function') jw.resize(window.innerWidth, window.innerHeight);
      } catch(e) {}
    }
  }

  function monitor() {
    cleanup();
    scanAndBind(document);
    // Only do aggressive actions before the player is ready.
    // After readySent, stop interfering with the running player.
    if (!readySent) {
      clickPlaybackPrompts(document);
      showPlayerArea();
      forceResize();
    }
  }

  monitor();
  window.addEventListener('load', monitor);
  setInterval(monitor, 1000);
  new MutationObserver(monitor).observe(document.documentElement, { childList: true, subtree: true });

  // Hard fallback: if we have a jwplayer or video on screen after 6s, just show it
  setTimeout(function() {
    if (!readySent) {
      var p = document.querySelector('video, .jwplayer, #player, iframe');
      if (p) postReady('embed-hard-fallback-6s');
    }
  }, 6000);

  true;
})();
`;
}

export function getInjectBefore(source: WebViewProviderSource, fit: 'contain' | 'cover' = 'contain') {
  if (source === "dizipal") return DIZIPAL_INJECT_BEFORE;

  // Dynamic HDF_INJECT_BEFORE to handle initial fit
  return `
(function() {
  'use strict';
  ${PLAYER_AD_GUARD_SCRIPT}
  ${HDFILM_RUNTIME_DISCOVERY_SCRIPT}
  window.open = function() { return null; };
  var adDomains = ${JSON.stringify(BLOCKED_PLAYER_NAVIGATION_PATTERNS)};
  var _xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, url) {
    if (adDomains.some(function(domain) { return String(url).toLowerCase().includes(domain); })) return;
    return _xhrOpen.apply(this, arguments);
  };
  var _fetch = window.fetch;
  window.fetch = function(url) {
    if (adDomains.some(function(domain) { return String(url).toLowerCase().includes(domain); })) {
      return Promise.reject(new Error('blocked'));
    }
    return _fetch.apply(this, arguments);
  };

  var hideStyle = document.createElement('style');
  hideStyle.id = 'app-player-hide';
  hideStyle.textContent = [
    'html, body { background: #000 !important; overflow: hidden !important; margin: 0 !important; padding: 0 !important; }',
    'body > *:not(script):not(style) { visibility: hidden !important; }'
  ].join('\\n');
  (document.head || document.documentElement).appendChild(hideStyle);

  var fitStyle = document.createElement('style');
  fitStyle.id = 'app-fit-style';
  fitStyle.textContent = 'video { object-fit: ${fit} !important; }';
  (document.head || document.documentElement).appendChild(fitStyle);

  true;
})();
`;
}

export function getInjectAfter(
  source: WebViewProviderSource,
  mediaType: "movie" | "tv",
  fit: 'contain' | 'cover' = 'contain',
  seasonNumber?: number,
  episodeNumber?: number
) {
  return source === "dizipal"
    ? getDizipalInjectAfter()
    : getHdFilmInjectAfter(mediaType, fit, seasonNumber, episodeNumber);
}

function getHdFilmInjectAfter(mediaType: "movie" | "tv", fit: 'contain' | 'cover' = 'contain', seasonNumber?: number, episodeNumber?: number) {
  return `
(function() {
  'use strict';
  ${HDFILM_RUNTIME_DISCOVERY_SCRIPT}

  var isTv = ${mediaType === "tv"};
  var targetSeason = ${seasonNumber || 1};
  var targetEpisode = ${episodeNumber || 1};
  var readySent = false;
  var readyFallbackTimer = null;
  var providerControlsVisible = false;
  var providerControlsHideTimer = null;
  var providerControlsLastPrimaryTapAt = 0;
  var providerControlsLastToggleAt = 0;
  var providerControlsAutoHideMs = 4400;
  var visualFrameSeen = false;
  var visualFrameWarningTimer = null;

  function postToApp(type, payload) {
    try {
      if (!window.ReactNativeWebView || !window.ReactNativeWebView.postMessage) return;
      var message = { type: type };
      if (payload) {
        for (var key in payload) {
          if (Object.prototype.hasOwnProperty.call(payload, key)) {
            message[key] = payload[key];
          }
        }
      }
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
    } catch (e) {}
  }

  function markPlaybackReady(reason) {
    if (readySent) return;
    readySent = true;
    if (readyFallbackTimer) clearTimeout(readyFallbackTimer);
    postToApp('player_ready', { reason: reason });
  }

  function markVisualFrame(reason) {
    visualFrameSeen = true;
    if (visualFrameWarningTimer) {
      clearTimeout(visualFrameWarningTimer);
      visualFrameWarningTimer = null;
    }
    postToApp('player_visual_ready', { reason: reason });
  }

  function scheduleVisualFrameProbe(reason, delay) {
    if (visualFrameSeen || visualFrameWarningTimer) return;
    visualFrameWarningTimer = setTimeout(function() {
      if (!visualFrameSeen) {
        postToApp('player_black_screen_suspected', { reason: reason });
      }
    }, delay);
  }

  function scheduleReadyFallback(reason, delay) {
    if (readySent) return;
    if (readyFallbackTimer) clearTimeout(readyFallbackTimer);
    readyFallbackTimer = setTimeout(function() {
      markPlaybackReady(reason);
    }, delay);
  }

  function probePresentedVideoFrame(video, reason) {
    if (!video) return;

    if (typeof video.requestVideoFrameCallback === 'function') {
      if (video.__streamboxFrameProbeBound) return;
      video.__streamboxFrameProbeBound = true;
      try {
        video.requestVideoFrameCallback(function() {
          markVisualFrame(reason + '-frame-callback');
        });
        return;
      } catch (e) {}
    }

    setTimeout(function() {
      try {
        if (!video.paused && video.currentTime > 0 && video.readyState >= 3) {
          markVisualFrame(reason + '-playing-frame');
        }
      } catch (e) {}
    }, 1600);
  }

  function bindVideo(video) {
    if (!video || video.__streamboxBound) return;
    video.__streamboxBound = true;

    ['loadeddata', 'canplay', 'playing'].forEach(function(eventName) {
      video.addEventListener(eventName, function() {
        if (eventName === 'loadeddata' || eventName === 'canplay') {
          probePresentedVideoFrame(video, 'video-' + eventName);
        }
        if (eventName === 'playing' || video.readyState >= 2) {
          probePresentedVideoFrame(video, 'video-' + eventName);
          markPlaybackReady('video-' + eventName);
          scheduleVisualFrameProbe('video-' + eventName + '-without-presented-frame', 6500);
        }
      });
    });

    if (video.readyState >= 2 && !video.paused) {
      probePresentedVideoFrame(video, 'video-ready');
      markPlaybackReady('video-ready');
      scheduleVisualFrameProbe('video-ready-without-presented-frame', 6500);
    } else if (video.readyState >= 2) {
      probePresentedVideoFrame(video, 'video-buffered');
      scheduleReadyFallback('video-buffered', 900);
      scheduleVisualFrameProbe('video-buffered-without-presented-frame', 7500);
    }
  }

  function bindKnownPlayerApis() {
    try {
      if (typeof window.jwplayer === 'function') {
        var jw = window.jwplayer();
        if (jw && !jw.__streamboxBound && typeof jw.on === 'function') {
          jw.__streamboxBound = true;
          jw.on('play', function() {
            markPlaybackReady('jwplayer-play');
            scheduleVisualFrameProbe('jwplayer-play-without-first-frame', 8500);
          });
          jw.on('buffer', function() {
            scheduleReadyFallback('jwplayer-buffer', 1200);
            scheduleVisualFrameProbe('jwplayer-buffer-without-first-frame', 10500);
          });
          jw.on('firstFrame', function() {
            markVisualFrame('jwplayer-first-frame');
            markPlaybackReady('jwplayer-first-frame');
          });
        }
        if (jw && typeof jw.getState === 'function') {
          var state = jw.getState();
          if (state === 'playing') {
            markPlaybackReady('jwplayer-state-playing');
            scheduleVisualFrameProbe('jwplayer-state-playing-without-first-frame', 8500);
          }
          if (state === 'buffering') {
            scheduleReadyFallback('jwplayer-state-buffering', 1200);
            scheduleVisualFrameProbe('jwplayer-state-buffering-without-first-frame', 10500);
          }
        }
      }
    } catch (e) {}
  }

  function getProviderMenuSelector() {
    return [
      '.jw-settings-menu',
      '.jw-settings-submenu',
      '.jw-settings-topbar',
      '.jw-settings-content-item',
      '.jw-settings-item',
      '.jw-settings-close',
      '.jw-submenu',
      '.jw-option',
      '.vjs-menu',
      '.vjs-menu-content',
      '.plyr__menu',
      '.plyr__menu__container',
      '[role="menu"]',
      '[role="menuitem"]'
    ].join(', ');
  }

  function getProviderMenuActionSelector() {
    return [
      '.jw-settings-content-item',
      '.jw-settings-item',
      '.jw-settings-close',
      '.jw-submenu',
      '.jw-option',
      '.jw-settings-topbar .jw-icon',
      '.jw-settings-menu button',
      '.jw-settings-menu [role="button"]',
      '.jw-settings-menu [role="menuitem"]',
      '.jw-settings-menu [tabindex]',
      '.jw-settings-submenu button',
      '.jw-settings-submenu [role="button"]',
      '.jw-settings-submenu [role="menuitem"]',
      '.jw-settings-submenu [tabindex]',
      '.vjs-menu-item',
      '.vjs-menu button',
      '.plyr__menu__container button',
      '.plyr__menu [role="menuitem"]'
    ].join(', ');
  }

  function getProviderControlSelector() {
    return [
      '.jw-controls',
      '.jw-controlbar',
      '.jw-icon',
      '.jw-button-container',
      '.jw-slider-time',
      '.jw-slider-volume',
      '.jw-display-icon-container',
      '.jw-settings-menu',
      '.jw-settings-submenu',
      '.jw-settings-topbar',
      '.jw-settings-content-item',
      '.jw-settings-item',
      '.jw-settings-close',
      '.jw-submenu',
      '.jw-option',
      '.vjs-control-bar',
      '.vjs-control',
      '.vjs-menu',
      '.vjs-menu-content',
      '.plyr__controls',
      '.plyr__control',
      '.plyr__menu',
      '.plyr__menu__container',
      '[role="menu"]',
      '[role="menuitem"]'
    ].join(', ');
  }

  function hasOpenProviderMenu(doc) {
    try {
      var rootDoc = doc || document;
      return Array.prototype.some.call(rootDoc.querySelectorAll(getProviderMenuSelector()), function(menu) {
        var style = rootDoc.defaultView.getComputedStyle(menu);
        var rect = menu.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.05 && rect.width > 20 && rect.height > 20;
      });
    } catch (e) {
      return false;
    }
  }

  function setProviderControlsVisible(doc, visible, autoHide) {
    try {
      var rootDoc = doc || document;
      if (!visible && hasOpenProviderMenu(rootDoc)) {
        return;
      }
      providerControlsVisible = visible;
      rootDoc.__streamboxControlsVisible = visible;
      if (rootDoc === document) document.__streamboxControlsVisible = visible;
      if (providerControlsHideTimer) {
        clearTimeout(providerControlsHideTimer);
        providerControlsHideTimer = null;
      }

      rootDoc.querySelectorAll('.jwplayer').forEach(function(player) {
        if (visible) {
          player.classList.remove('jw-flag-user-inactive');
          player.classList.remove('jw-flag-controls-hidden');
          player.classList.add('jw-flag-user-active');
        } else {
          player.classList.remove('jw-flag-user-active');
          player.classList.add('jw-flag-user-inactive');
        }
      });
      rootDoc.querySelectorAll('.jw-controls, .jw-controlbar, .jw-overlays, .jw-display, .jw-display-icon-container, .vjs-control-bar, .plyr__controls').forEach(function(el) {
        if (visible) {
          el.style.setProperty('visibility', 'visible', 'important');
          el.style.setProperty('opacity', '1', 'important');
          el.style.setProperty('pointer-events', 'auto', 'important');
        } else {
          el.style.setProperty('visibility', 'hidden', 'important');
          el.style.setProperty('opacity', '0', 'important');
          el.style.setProperty('pointer-events', 'none', 'important');
        }
      });
      if (visible) {
        rootDoc.querySelectorAll(getProviderControlSelector()).forEach(function(el) {
          el.style.setProperty('pointer-events', 'auto', 'important');
        });
      }
      if (visible && rootDoc === document && typeof window.jwplayer === 'function') {
        try {
          var jw = window.jwplayer();
          if (jw && typeof jw.setControls === 'function') jw.setControls(true);
        } catch (e) {}
      }

      if (visible && autoHide) {
        providerControlsHideTimer = setTimeout(function() {
          setProviderControlsVisible(rootDoc, false, false);
        }, providerControlsAutoHideMs);
      }
    } catch (e) {}
  }

  function shouldHandleProviderTap(eventName) {
    var now = Date.now();
    if (eventName === 'click' && now - providerControlsLastPrimaryTapAt < 650) {
      return false;
    }
    if (eventName !== 'click') {
      if (now - providerControlsLastPrimaryTapAt < 120) {
        return false;
      }
      providerControlsLastPrimaryTapAt = now;
    }
    return true;
  }

  function getProviderEventPoint(event) {
    try {
      var touch = event.changedTouches && event.changedTouches.length ? event.changedTouches[0] : null;
      if (!touch && event.touches && event.touches.length) touch = event.touches[0];
      return {
        x: touch ? touch.clientX : event.clientX,
        y: touch ? touch.clientY : event.clientY
      };
    } catch (e) {
      return { x: null, y: null };
    }
  }

  function getProviderActionTarget(node) {
    if (!node || !node.closest) return node;
    return node.closest([
      'button',
      'a[href]',
      '[role="button"]',
      '[role="menuitem"]',
      '.jw-settings-content-item',
      '.jw-settings-item',
      '.jw-settings-close',
      '.jw-submenu',
      '.jw-option',
      '.jw-icon',
      '.jw-button-container',
      '.vjs-control',
      '.vjs-menu-item',
      '.plyr__control',
      '.plyr__menu__container button',
      '[tabindex]',
      '[aria-label]',
      '[title]'
    ].join(', ')) || node;
  }

  function findProviderActionFromPoint(rootDoc, event, selector) {
    try {
      var point = getProviderEventPoint(event);
      if (point.x == null || point.y == null || !rootDoc.elementsFromPoint) return null;
      var stack = rootDoc.elementsFromPoint(point.x, point.y);
      for (var i = 0; i < stack.length; i++) {
        var hit = stack[i];
        if (!hit || !hit.closest) continue;
        var providerNode = hit.closest(selector);
        if (providerNode) return getProviderActionTarget(providerNode);
      }
      var candidates = rootDoc.querySelectorAll(selector);
      for (var j = 0; j < candidates.length; j++) {
        var candidate = candidates[j];
        var style = rootDoc.defaultView.getComputedStyle(candidate);
        var rect = candidate.getBoundingClientRect();
        if (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity || 1) > 0.05 &&
          rect.width > 4 &&
          rect.height > 4 &&
          point.x >= rect.left &&
          point.x <= rect.right &&
          point.y >= rect.top &&
          point.y <= rect.bottom
        ) {
          return getProviderActionTarget(candidate);
        }
      }
    } catch (e) {}
    return null;
  }

  function dispatchProviderPointerSequence(rootDoc, actionTarget, point) {
    var win = rootDoc.defaultView || window;
    var eventInit = {
      bubbles: true,
      cancelable: true,
      view: win,
      clientX: point && point.x != null ? point.x : 0,
      clientY: point && point.y != null ? point.y : 0,
      screenX: point && point.x != null ? point.x : 0,
      screenY: point && point.y != null ? point.y : 0
    };
    try {
      if (win.PointerEvent) {
        actionTarget.dispatchEvent(new win.PointerEvent('pointerdown', Object.assign({}, eventInit, { pointerId: 1, pointerType: 'touch', isPrimary: true })));
        actionTarget.dispatchEvent(new win.PointerEvent('pointerup', Object.assign({}, eventInit, { pointerId: 1, pointerType: 'touch', isPrimary: true })));
      }
    } catch (e) {}
    try {
      actionTarget.dispatchEvent(new win.MouseEvent('mousedown', eventInit));
      actionTarget.dispatchEvent(new win.MouseEvent('mouseup', eventInit));
      actionTarget.dispatchEvent(new win.MouseEvent('click', eventInit));
    } catch (e) {
      try {
        if (typeof actionTarget.click === 'function') actionTarget.click();
      } catch (err) {}
    }
  }

  function relayProviderClick(rootDoc, event, actionTarget) {
    if (!actionTarget || actionTarget.__streamboxRelayingProviderClick) return false;
    try {
      var point = getProviderEventPoint(event);
      actionTarget.__streamboxRelayingProviderClick = true;
      setProviderControlsVisible(rootDoc, true, false);
      if (event.cancelable !== false && event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      setTimeout(function() {
        try {
          dispatchProviderPointerSequence(rootDoc, actionTarget, point);
        } catch (e) {}
        setTimeout(function() {
          try { actionTarget.__streamboxRelayingProviderClick = false; } catch (e) {}
        }, 180);
      }, 0);
      try {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'player_tap' }));
        }
      } catch (e) {}
      return true;
    } catch (e) {
      try { actionTarget.__streamboxRelayingProviderClick = false; } catch (err) {}
      return false;
    }
  }

  function bindProviderControlTapBridge(doc) {
    try {
      var rootDoc = doc || document;
      if (rootDoc.__streamboxControlTapBridgeBound) return;
      rootDoc.__streamboxControlTapBridgeBound = true;
      var tapEvents = window.PointerEvent ? ['pointerup', 'click'] : ['touchend', 'click'];
      tapEvents.forEach(function(eventName) {
        rootDoc.addEventListener(eventName, function(event) {
          if (!shouldHandleProviderTap(eventName)) return;
          var target = event.target;
          var directMenuAction = target && target.closest ? target.closest(getProviderMenuActionSelector()) : null;
          if (directMenuAction) {
            setProviderControlsVisible(rootDoc, true, false);
            try {
              if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'player_tap' }));
              }
            } catch (e) {}
            return;
          }
          var menuAction = null;
          if (hasOpenProviderMenu(rootDoc)) {
            menuAction = findProviderActionFromPoint(rootDoc, event, getProviderMenuActionSelector());
          }
          if (!menuAction && target && target.closest) {
            var targetMenu = target.closest(getProviderMenuActionSelector());
            if (targetMenu) menuAction = getProviderActionTarget(targetMenu);
          }
          if (menuAction && relayProviderClick(rootDoc, event, menuAction)) {
            return;
          }
          if (target && target.closest && target.closest(getProviderControlSelector())) {
            setProviderControlsVisible(rootDoc, true, true);
            try {
              if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'player_tap' }));
              }
            } catch (e) {}
            return;
          }
          if (target && target.closest && target.closest('a[href], [onclick], [data-href], [data-url], [data-link]')) {
            return;
          }
          var now = Date.now();
          if (now - providerControlsLastToggleAt < 180) return;
          providerControlsLastToggleAt = now;
          var nextVisible = !(rootDoc === document ? providerControlsVisible : rootDoc.__streamboxControlsVisible);
          rootDoc.__streamboxControlsVisible = nextVisible;
          setProviderControlsVisible(rootDoc, nextVisible, nextVisible);
          try {
            if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'player_tap' }));
            }
          } catch (e) {}
        }, true);
      });
    } catch (e) {}
  }

  function scanForReadyPlayers(rootDoc) {
    var doc = rootDoc || document;
    try {
      Array.prototype.forEach.call(doc.querySelectorAll('video'), bindVideo);
    } catch (e) {}
    bindProviderControlTapBridge(doc);
    bindKnownPlayerApis();
  }

  function getViewportSize(doc) {
    var win = (doc && doc.defaultView) || window;
    var root = doc && doc.documentElement;
    var visualViewport = win.visualViewport;
    var width = Math.round((visualViewport && visualViewport.width) || win.innerWidth || (root && root.clientWidth) || screen.width || 0);
    var height = Math.round((visualViewport && visualViewport.height) || win.innerHeight || (root && root.clientHeight) || screen.height || 0);
    return {
      width: Math.max(1, width),
      height: Math.max(1, height)
    };
  }

  function syncViewportVars(doc) {
    try {
      var targetDoc = doc || document;
      var size = getViewportSize(targetDoc);
      var root = targetDoc.documentElement;
      var body = targetDoc.body;
      root.style.setProperty('--sb-player-width', size.width + 'px');
      root.style.setProperty('--sb-player-height', size.height + 'px');
      root.style.setProperty('width', size.width + 'px', 'important');
      root.style.setProperty('height', size.height + 'px', 'important');
      if (body) {
        body.style.setProperty('width', size.width + 'px', 'important');
        body.style.setProperty('height', size.height + 'px', 'important');
      }

      var win = targetDoc.defaultView || window;
      if (!win.__streamboxViewportBound) {
        win.__streamboxViewportBound = true;
        win.addEventListener('resize', function() { syncViewportVars(targetDoc); }, { passive: true });
        win.addEventListener('orientationchange', function() {
          setTimeout(function() { syncViewportVars(targetDoc); }, 250);
        }, { passive: true });
        if (win.visualViewport) {
          win.visualViewport.addEventListener('resize', function() { syncViewportVars(targetDoc); }, { passive: true });
          win.visualViewport.addEventListener('scroll', function() { syncViewportVars(targetDoc); }, { passive: true });
        }
      }

      if (targetDoc === document && typeof window.jwplayer === 'function') {
        try {
          var jw = window.jwplayer();
          if (jw && typeof jw.resize === 'function') jw.resize(size.width, size.height);
        } catch (e) {}
      }
    } catch (e) {}
  }

  function injectFullscreenStyleInFrame(frameDoc) {
    try {
      syncViewportVars(frameDoc);
      if (frameDoc.getElementById('sb-fs-fix')) return;
      var s = frameDoc.createElement('style');
      s.id = 'sb-fs-fix';
      s.textContent = [
        'html, body { margin:0!important; padding:0!important; overflow:hidden!important; width:var(--sb-player-width,100vw)!important; height:var(--sb-player-height,100dvh)!important; background:#000!important; touch-action:manipulation!important; }',
        'video { object-fit:${fit}!important; width:var(--sb-player-width,100vw)!important; height:var(--sb-player-height,100dvh)!important; position:absolute!important; top:0!important; left:0!important; }',
        '.jw-aspect { padding-top:0!important; }',
        '#player, #playerbase, .jwplayer, .jw-wrapper, .jw-media, .jw-preview, .video-js, .plyr { width:var(--sb-player-width,100vw)!important; height:var(--sb-player-height,100dvh)!important; position:absolute!important; top:0!important; left:0!important; }',
        '.jw-settings-menu, .jw-settings-submenu, .jw-settings-menu *, .jw-settings-submenu *, .vjs-menu, .vjs-menu *, .plyr__menu, .plyr__menu * { pointer-events:auto!important; z-index:99999999!important; }',
        '.jw-settings-menu, .jw-icon, .jw-button-container, .jw-slider-time, .vjs-control, .plyr__control { pointer-events:auto!important; }',
        '.jw-controls-backdrop, .jw-controlbar { bottom:0!important; left:0!important; width:100%!important; z-index:10!important; pointer-events:auto!important; }',
        '.jw-icon, .jw-button-container, .jw-settings-menu, .jw-slider-time, .vjs-control, .plyr__control { pointer-events:auto!important; }'
      ].join('\\n');
      (frameDoc.head || frameDoc.documentElement).appendChild(s);
    } catch (e) {}
  }

  function inspectAccessibleFrame(frame) {
    try {
      var frameDoc = frame.contentDocument || (frame.contentWindow ? frame.contentWindow.document : null);
      if (!frameDoc) return;
      injectFullscreenStyleInFrame(frameDoc);
      scanForReadyPlayers(frameDoc);
    } catch (e) {}
  }

  function monitorIframes() {
    Array.prototype.forEach.call(document.querySelectorAll('iframe'), function(frame) {
      if (frame.__streamboxBound) return;
      frame.__streamboxBound = true;
      frame.addEventListener('load', function() {
        inspectAccessibleFrame(frame);
        scheduleReadyFallback('iframe-load', 2200);
      });
      inspectAccessibleFrame(frame);
    });
  }

  function monitorPlayback() {
    scanForReadyPlayers(document);
    monitorIframes();
  }

  window.addEventListener('load', function() {
    monitorPlayback();
    scheduleReadyFallback('window-load', 5000);
  });

  if (isTv && window.location.href.includes('/dizi/') && !window.location.href.includes('bolum')) {
    var navInterval = setInterval(function() {
      var links = document.querySelectorAll('a[href*="bolum"]');
      for (var i = 0; i < links.length; i++) {
        var href = links[i].href.toLowerCase();
        if (
          (href.includes('sezon-' + targetSeason) || href.includes(targetSeason + '-sezon') || href.includes('sezon' + targetSeason)) &&
          (href.includes('bolum-' + targetEpisode) || href.includes(targetEpisode + '-bolum') || href.includes('bolum' + targetEpisode))
        ) {
          clearInterval(navInterval);
          window.location.href = links[i].href;
          return;
        }
      }
    }, 500);

    setTimeout(function() { clearInterval(navInterval); }, 10000);
    return;
  }

  var playerStyle = document.createElement('style');
  playerStyle.id = 'app-player-show';
  playerStyle.textContent = [
    'html, body { background: #000 !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; width: var(--sb-player-width, 100vw) !important; height: var(--sb-player-height, 100dvh) !important; touch-action: manipulation !important; -webkit-tap-highlight-color: transparent !important; }',
    'header, footer, nav, aside, .sidebar, .comments, .related, .breadcrumb, .logo, [class*="header"]:not([class*="jw"]):not([class*="vjs"]), [class*="footer"]:not([class*="jw"]):not([class*="vjs"]), [class*="nav-"]:not([class*="jw"]):not([class*="vjs"]), [class*="sidebar"], [class*="comment"], [class*="social"], [class*="share"], [class*="bread"], [class*="cookie"], [class*="consent"], [class*="banner-"], .section-alt, .section-other, .rating, .detail-info, .film-info { display: none !important; }',
    '.player-wrapper, .player-area, .film-player, #player, .ke_post_body { margin: 0 !important; padding: 0 !important; position: fixed !important; top: 0 !important; left: 0 !important; width: var(--sb-player-width, 100vw) !important; height: var(--sb-player-height, 100dvh) !important; z-index: 999999 !important; }',
    'iframe { width: var(--sb-player-width, 100vw) !important; height: var(--sb-player-height, 100dvh) !important; position: fixed !important; top: 0 !important; left: 0 !important; z-index: 999999 !important; border: none !important; pointer-events: auto !important; }',
    'video { object-fit: ${fit} !important; width: var(--sb-player-width, 100vw) !important; height: var(--sb-player-height, 100dvh) !important; position: absolute !important; top: 0 !important; left: 0 !important; }',
    '.jw-aspect { padding-top: 0 !important; }',
    '.jwplayer, .jw-wrapper, .jw-media, .jw-preview { width: var(--sb-player-width, 100vw) !important; height: var(--sb-player-height, 100dvh) !important; position: absolute !important; top: 0 !important; left: 0 !important; }',
    '.jw-settings-menu, .jw-settings-submenu, .jw-settings-menu *, .jw-settings-submenu *, .vjs-menu, .vjs-menu *, .plyr__menu, .plyr__menu * { pointer-events: auto !important; z-index: 99999999 !important; }',
    '.jw-settings-menu, .jw-slider-time, .jw-icon, .jw-button-container, .jw-icon-fullscreen, .jw-icon-volume, .jw-text-elapsed, .jw-text-duration, .vjs-control, .vjs-progress-control, .vjs-play-control, .vjs-volume-panel, .plyr__control { pointer-events: auto !important; }',
    '.jw-controlbar, .vjs-control-bar, .plyr__controls { bottom: 0 !important; left: 0 !important; right: 0 !important; z-index: 9999999 !important; }',
    'ins.adsbygoogle, [id*="google_ads"], [class*="ad-container"], [class*="ad-wrapper"], .ad, .ads, [class*="advert"], [class*="popup"]:not([class*="jw"]):not([class*="vjs"]), [id*="popup"], .popup-overlay { display: none !important; }',
    'a[href*="download"], a[href*="indir"], a[download] { display: none !important; pointer-events: none !important; visibility: hidden !important; width: 0 !important; height: 0 !important; overflow: hidden !important; }',
    '[class*="yardim"], [class*="indir"], [id*="yardim"], [id*="indir"] { display: none !important; pointer-events: none !important; visibility: hidden !important; }'
  ].join('\\n');
  (document.head || document.documentElement).appendChild(playerStyle);
  syncViewportVars(document);

  function forceVideoFullscreen(doc) {
    try {
      syncViewportVars(doc);
      doc.querySelectorAll('video').forEach(function(v) {
        v.style.setProperty('object-fit', '${fit}', 'important');
        v.style.setProperty('width', 'var(--sb-player-width, 100vw)', 'important');
        v.style.setProperty('height', 'var(--sb-player-height, 100dvh)', 'important');
        v.style.setProperty('position', 'absolute', 'important');
        v.style.setProperty('top', '0', 'important');
        v.style.setProperty('left', '0', 'important');
      });
      doc.querySelectorAll('.jw-aspect').forEach(function(el) {
        el.style.setProperty('padding-top', '0', 'important');
      });
      doc.querySelectorAll('.jwplayer, .jw-wrapper, .jw-media, .jw-preview, .jw-overlays, #player, #playerbase').forEach(function(el) {
        el.style.setProperty('width', 'var(--sb-player-width, 100vw)', 'important');
        el.style.setProperty('height', 'var(--sb-player-height, 100dvh)', 'important');
        el.style.setProperty('position', 'absolute', 'important');
        el.style.setProperty('top', '0', 'important');
        el.style.setProperty('left', '0', 'important');
        el.style.setProperty('visibility', 'visible', 'important');
        el.style.setProperty('display', 'block', 'important');
      });
    } catch (e) {}
  }

  function showPlayerArea() {
    var playerContainers = document.querySelectorAll('.kePlayerCont, .player-wrapper, .film-player, #player, #playerbase, [class*="player"], .video-container, .ke_post_body, video, iframe[src*="vidmoly"], iframe[src*="rapid"], iframe[src*="closeload"], iframe[src*="ok.ru"]');
    playerContainers.forEach(function(el) {
      var current = el;
      while (current && current !== document.body) {
        current.style.setProperty('display', 'block', 'important');
        current.style.setProperty('visibility', 'visible', 'important');
        current.style.setProperty('opacity', '1', 'important');
        current = current.parentElement;
      }
      document.body.style.setProperty('display', 'block', 'important');
      document.body.style.setProperty('visibility', 'visible', 'important');
    });

    forceVideoFullscreen(document);
    document.querySelectorAll('iframe').forEach(function(frame) {
      try {
        var fd = frame.contentDocument || (frame.contentWindow ? frame.contentWindow.document : null);
        if (fd) forceVideoFullscreen(fd);
      } catch (e) {}
    });
  }

  function hideProviderNotices(doc) {
    var rootDoc = doc || document;
    var blockedText = /datacenter|kaynakli|kaynaklÄ±|kaynakl[iı]|sunucu|teknik|problem|hata/i;
    rootDoc.querySelectorAll('div, span, p, strong, small').forEach(function(el) {
      try {
        if (el.closest && el.closest('.jw-controls, .jw-controlbar, .jw-settings-menu, .jw-settings-submenu, .vjs-control-bar, .plyr__controls')) return;
        var text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!text || text.length > 180 || !blockedText.test(text)) return;
        var style = getComputedStyle(el);
        var rect = el.getBoundingClientRect();
        var nearTop = rect.top < 100;
        var overlayLike = style.position === 'fixed' || style.position === 'absolute' || nearTop;
        if (overlayLike) {
          el.style.setProperty('display', 'none', 'important');
          el.style.setProperty('visibility', 'hidden', 'important');
          el.style.setProperty('pointer-events', 'none', 'important');
          el.style.setProperty('opacity', '0', 'important');
        }
      } catch (e) {}
    });
  }

  function applyProviderUiFixes() {
    bindProviderControlTapBridge(document);
    hideProviderNotices(document);
    document.querySelectorAll('iframe').forEach(function(frame) {
      try {
        var fd = frame.contentDocument || (frame.contentWindow ? frame.contentWindow.document : null);
        if (!fd) return;
        bindProviderControlTapBridge(fd);
        hideProviderNotices(fd);
      } catch (e) {}
    });
  }

  function clickRapidrame() {
    var buttons = document.querySelectorAll('button, a, [data-link], .alternative-link');
    var clicked = false;
    buttons.forEach(function(btn) {
      if (!clicked && btn.textContent && btn.textContent.toLowerCase().includes('rapidrame')) {
        btn.click();
        clicked = true;
      }
    });
    if (!clicked) {
      var firstServer = document.querySelector('.alternative-link, .server-item, [class*="server"]');
      if (firstServer) {
        firstServer.click();
        clicked = true;
      }
    }
    return clicked;
  }

  function clickPlay() {
    var hdfPlay = document.querySelector('[class*="play-icon"], [class*="play-overlay"], .hdf-play');
    if (hdfPlay) hdfPlay.click();

    var playBtns = document.querySelectorAll('.jw-display-icon-container, .jw-icon-display, .vjs-big-play-button, [class*="play-button"], .play-btn');
    playBtns.forEach(function(button) { button.click(); });

    var videos = document.querySelectorAll('video');
    videos.forEach(function(video) {
      try { video.play(); } catch (e) {}
    });

    var iframes = document.querySelectorAll('iframe');
    iframes.forEach(function(frame) {
      try {
        var frameDoc = frame.contentDocument || frame.contentWindow.document;
        var framePlay = frameDoc.querySelector('.jw-display-icon-container, .jw-icon-display, [class*="play"], video');
        if (framePlay && framePlay.click) framePlay.click();
        var frameVideo = frameDoc.querySelector('video');
        if (frameVideo) frameVideo.play().catch(function() {});
      } catch (e) {}
    });
  }

  var controlWhitelist = /jw-|vjs-|plyr|jwplayer|video-js|controlbar|slider-time|icon-fullscreen|icon-volume|icon-display|display-icon|settings-menu|play-control|progress-control|volume-panel|text-elapsed|text-duration|big-play|captions|audio-tracks|kePlayer|player-wrapper|film-player|ke-title/i;

  function nukeElement(el) {
    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('visibility', 'hidden', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
    el.style.setProperty('opacity', '0', 'important');
    el.style.setProperty('width', '0', 'important');
    el.style.setProperty('height', '0', 'important');
    el.style.setProperty('overflow', 'hidden', 'important');
    el.removeAttribute('href');
    el.onclick = function(e) { e.preventDefault(); e.stopPropagation(); return false; };
    if (el.parentElement && el.parentElement.tagName !== 'BODY') {
      var parent = el.parentElement;
      var parentText = (parent.textContent || '').trim().toLowerCase();
      var text = (el.textContent || '').trim().toLowerCase();
      if (parentText === text) {
        parent.style.setProperty('display', 'none', 'important');
        parent.style.setProperty('pointer-events', 'none', 'important');
      }
    }
  }

  function hideButtonsInDoc(doc) {
    var blockedLabels = ['yardım', 'yardim'];
    var blockedHrefPatterns = ['download', 'indir'];

    doc.querySelectorAll('a, button, span, div').forEach(function(el) {
      var text = (el.textContent || '').trim().toLowerCase();

      // Match by text content (Yardım etc.)
      if (text) {
        for (var i = 0; i < blockedLabels.length; i++) {
          if (text === blockedLabels[i] || text.indexOf(blockedLabels[i]) === 0) {
            nukeElement(el);
            return;
          }
        }
      }

      // Match by href containing download/indir patterns
      var href = (el.getAttribute('href') || '').toLowerCase();
      if (href) {
        for (var j = 0; j < blockedHrefPatterns.length; j++) {
          if (href.indexOf(blockedHrefPatterns[j]) !== -1) {
            nukeElement(el);
            return;
          }
        }
      }
    });
  }

  function injectHideStyleInDoc(doc) {
    try {
      if (doc.getElementById('sb-hide-btns')) return;
      var s = doc.createElement('style');
      s.id = 'sb-hide-btns';
      s.textContent = 'a[href*="download"], a[href*="indir"], a[download] { display:none!important; pointer-events:none!important; visibility:hidden!important; width:0!important; height:0!important; overflow:hidden!important; }';
      (doc.head || doc.documentElement).appendChild(s);
    } catch (e) {}
  }

  function hideHdfilmUiButtons() {
    hideButtonsInDoc(document);
    document.querySelectorAll('iframe').forEach(function(frame) {
      try {
        var fd = frame.contentDocument || (frame.contentWindow ? frame.contentWindow.document : null);
        if (fd) {
          injectHideStyleInDoc(fd);
          hideButtonsInDoc(fd);
        }
      } catch (e) {}
    });
  }

  function removeAdOverlays() {
    document.querySelectorAll('*').forEach(function(el) {
      try {
        var cls = (el.className || '').toString();
        var id = (el.id || '').toString();
        if (controlWhitelist.test(cls) || controlWhitelist.test(id)) return;
        if (el.tagName === 'IFRAME' || el.tagName === 'VIDEO') return;
        if (el.closest && (el.closest('.jwplayer') || el.closest('.video-js') || el.closest('.jw-wrapper') || el.closest('[class*="jw-"]'))) return;

        var style = getComputedStyle(el);
        var zIndex = parseInt(style.zIndex || '0', 10);
        if ((style.position === 'fixed' || style.position === 'absolute') && zIndex > 5000) {
          if (zIndex === 999999 || cls.includes('player') || id.includes('player')) return;
          el.style.setProperty('display', 'none', 'important');
        }
      } catch (e) {}
    });
  }

  showPlayerArea();
  applyProviderUiFixes();
  hideHdfilmUiButtons();
  monitorPlayback();

  setTimeout(function() {
    clickRapidrame();
    showPlayerArea();
    applyProviderUiFixes();
    hideHdfilmUiButtons();
    scheduleReadyFallback('rapidrame-click', 5000);
  }, 1500);

  setTimeout(function() {
    showPlayerArea();
    clickPlay();
    removeAdOverlays();
    applyProviderUiFixes();
    hideHdfilmUiButtons();
    monitorPlayback();
    scheduleReadyFallback('play-attempt', 3200);
  }, 4000);

  setTimeout(function() {
    clickPlay();
    removeAdOverlays();
    applyProviderUiFixes();
    hideHdfilmUiButtons();
    monitorPlayback();
    scheduleReadyFallback('second-play-attempt', 2200);
  }, 6000);

  setTimeout(function() {
    setProviderControlsVisible(document, false, false);
    document.querySelectorAll('iframe').forEach(function(frame) {
      try {
        var fd = frame.contentDocument || (frame.contentWindow ? frame.contentWindow.document : null);
        if (fd) setProviderControlsVisible(fd, false, false);
      } catch (e) {}
    });
  }, 7600);

  setInterval(removeAdOverlays, 2000);
  setInterval(applyProviderUiFixes, 1200);
  setInterval(hideHdfilmUiButtons, 1500);
  setInterval(monitorPlayback, 1000);

  new MutationObserver(function() {
    if (!readySent) showPlayerArea();
    removeAdOverlays();
    applyProviderUiFixes();
    hideHdfilmUiButtons();
    monitorPlayback();
  }).observe(document.documentElement, { childList: true, subtree: true });

  true;
})();
`;
}

function getDizipalInjectAfter() {
  return `
(function() {
  'use strict';

  var readySent = false;
  var notFoundSent = false;
  var readyFallbackTimer = null;
  var notFoundTimer = null;
  var lastStartAttemptAt = 0;
  var playerShellVisibleAt = 0;

  function postToApp(type, payload) {
    try {
      var message = { type: type, href: window.location.href };
      if (payload) {
        for (var key in payload) {
          if (Object.prototype.hasOwnProperty.call(payload, key)) {
            message[key] = payload[key];
          }
        }
      }
      var messageStr = JSON.stringify(message);

      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(messageStr);
      } else {
        window.top.postMessage(messageStr, '*');
      }
    } catch (e) {
      try { window.top.postMessage(JSON.stringify({ type: type }), '*'); } catch (e2) {}
    }
  }

  function clearTimers() {
    if (readyFallbackTimer) {
      clearTimeout(readyFallbackTimer);
      readyFallbackTimer = null;
    }
    if (notFoundTimer) {
      clearTimeout(notFoundTimer);
      notFoundTimer = null;
    }
  }

  function markPlaybackReady(reason) {
    if (readySent || notFoundSent) return;
    readySent = true;
    clearTimers();
    postToApp('player_ready', { reason: reason });
  }

  function markNotFound(reason) {
    if (readySent || notFoundSent) return;
    notFoundSent = true;
    clearTimers();
    postToApp('player_not_found', { reason: reason });
  }

  window.addEventListener('message', function(e) {
    try {
      if (typeof e.data === 'string') {
        var parsed = JSON.parse(e.data);
        if (parsed.type === 'player_ready') {
          markPlaybackReady(parsed.reason || 'iframe-message');
        } else if (parsed.type === 'player_not_found') {
          markNotFound(parsed.reason || 'iframe-message');
        }
      }
    } catch (err) {}
  });

  function normalizeText(value) {
    try {
      return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    } catch (e) {
      return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    }
  }

  function isStartPromptText(text) {
    var normalized = normalizeText(text);
    return (
      normalized.indexOf('videoyu baslat') !== -1 ||
      normalized.indexOf('izlemeye basla') !== -1 ||
      normalized.indexOf('izle') !== -1 ||
      normalized.indexOf('oynat') !== -1 ||
      normalized.indexOf('reklami gec') !== -1 ||
      normalized.indexOf('skip ad') !== -1 ||
      normalized.indexOf('tikla') !== -1 ||
      normalized.indexOf('baslat') !== -1 ||
      normalized === 'play' ||
      normalized === 'start'
    );
  }

  function hasVisiblePlayerContent() {
    if (window.location.hostname.indexOf('dizipal') === -1) {
      if (!playerShellVisibleAt) playerShellVisibleAt = Date.now();
      scheduleReadyFallback('dizipal-iframe-ultimate-fallback', 10000);
      return true;
    }

    var mainPlayer = document.getElementById('mainPlayer');
    var playerContent = document.getElementById('playerContent');
    var hasEmbed = !!document.querySelector('#playerContent iframe, #playerContent video, #playerContent embed, #playerContent object, #mainPlayer iframe, #mainPlayer video');
    var mainVisible = !!(mainPlayer && getComputedStyle(mainPlayer).display !== 'none' && getComputedStyle(mainPlayer).visibility !== 'hidden');
    var childCount = playerContent ? playerContent.children.length : 0;
    var promptVisible = documentHasStartPrompt(document);
    var isVisible = hasEmbed || (mainVisible && childCount > 0 && !promptVisible);

    if (isVisible && !playerShellVisibleAt) {
      playerShellVisibleAt = Date.now();
    }

    return isVisible;
  }

  function scheduleReadyFallback(reason, delay) {
    if (readySent || notFoundSent) return;
    if (readyFallbackTimer) return; // Do not constantly reset the timer!

    readyFallbackTimer = setTimeout(function() {
      readyFallbackTimer = null;
      if (!hasVisiblePlayerContent() || documentHasStartPrompt(document)) {
        return;
      }

      markPlaybackReady(reason);
    }, delay);
  }

  function scheduleNotFound(reason, delay) {
    if (readySent || notFoundSent) return;
    if (notFoundTimer) return; // Do not continuously reset

    notFoundTimer = setTimeout(function() {
      notFoundTimer = null;
      if (!hasVisiblePlayerContent()) {
        markNotFound(reason);
      }
    }, delay);
  }

  function bindVideo(video) {
    if (!video || video.__streamboxBound) return;
    video.__streamboxBound = true;

    ['loadeddata', 'canplay', 'playing'].forEach(function(eventName) {
      video.addEventListener(eventName, function() {
        if (eventName === 'playing' || video.readyState >= 2) {
          markPlaybackReady('dizipal-video-' + eventName);
        }
      });
    });

    if (video.readyState >= 2 && !video.paused) {
      markPlaybackReady('dizipal-video-ready');
    } else if (video.readyState >= 2) {
      scheduleReadyFallback('dizipal-video-buffered', 1200);
    }
  }

  function scanForVideos(rootDoc) {
    var doc = rootDoc || document;
    try {
      Array.prototype.forEach.call(doc.querySelectorAll('video'), bindVideo);
    } catch (e) {}
  }

  function resolveClickableTarget(node) {
    if (!node || typeof node.closest !== 'function') {
      return node || null;
    }

    return node.closest('button, a, [role="button"], input, label, .play-btn, .skip-btn, .jw-display-icon-container, .jw-icon-display, .vjs-big-play-button') || node;
  }

  function dispatchSyntheticTap(node) {
    if (!node || typeof node.dispatchEvent !== 'function') {
      return;
    }

    ['pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'touchend', 'click'].forEach(function(eventName) {
      try {
        node.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }));
      } catch (error) {}
    });
  }

  function clickNode(node) {
    var target = resolveClickableTarget(node);
    if (!target) return false;

    try {
      dispatchSyntheticTap(target);
      if (typeof target.focus === 'function') {
        try { target.focus(); } catch (e) {}
      }
      if (typeof target.click === 'function') {
        target.click();
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function clickPlaybackPrompts(rootDoc) {
    var doc = rootDoc || document;
    var clicked = false;
    var selectors = [
      '#playerCover',
      '.player-cover-overlay',
      '.play-btn',
      '#skipBtn',
      '.skip-btn',
      '#prerollResumeBtn',
      '.jw-display-icon-container',
      '.jw-icon-display',
      '.vjs-big-play-button',
      '[class*="play-button"]',
      '[class*="play-btn"]',
      '[class*="play_btn"]',
      '[data-action="play"]',
      'button',
      'input',
      'a',
      '[role="button"]',
      'div',
      'span'
    ];

    try {
      Array.prototype.forEach.call(doc.querySelectorAll(selectors.join(',')), function(node) {
        var text = normalizeText(node.textContent || node.innerText || node.value || node.getAttribute('aria-label') || node.getAttribute('title') || node.getAttribute('placeholder') || '');
        var className = normalizeText(node.className || '');
        var id = normalizeText(node.id || '');
        var shouldClick =
          id === 'playercover' ||
          id === 'skipbtn' ||
          id === 'prerollresumebtn' ||
          className.indexOf('play-btn') !== -1 ||
          className.indexOf('jw-display-icon-container') !== -1 ||
          className.indexOf('jw-icon-display') !== -1 ||
          className.indexOf('vjs-big-play-button') !== -1 ||
          isStartPromptText(text);

        if (shouldClick && clickNode(node)) {
          clicked = true;
        }
      });
      
      // Recursive call for accessible iframes
      Array.prototype.forEach.call(doc.querySelectorAll('iframe'), function(frame) {
        try {
          var frameDoc = frame.contentDocument || (frame.contentWindow ? frame.contentWindow.document : null);
          if (frameDoc && clickPlaybackPrompts(frameDoc)) {
            clicked = true;
          }
        } catch(e) {}
      });
    } catch (e) {}

    return clicked;
  }

  function documentHasStartPrompt(rootDoc) {
    var doc = rootDoc || document;
    try {
      return Array.prototype.some.call(doc.querySelectorAll('button, a, [role="button"], div, span'), function(node) {
        return isStartPromptText(node.textContent || node.innerText || node.value || node.getAttribute('aria-label') || node.getAttribute('title') || '');
      });
    } catch (e) {
      return false;
    }
  }

  function nudgeVideos(rootDoc) {
    var doc = rootDoc || document;
    try {
      Array.prototype.forEach.call(doc.querySelectorAll('video'), function(video) {
        bindVideo(video);
        try {
          var playResult = video.play();
          if (playResult && typeof playResult.catch === 'function') {
            playResult.catch(function() {});
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  function inspectAccessibleFrame(frame) {
    try {
      var frameDoc = frame.contentDocument || (frame.contentWindow ? frame.contentWindow.document : null);
      if (!frameDoc) return;
      scanForVideos(frameDoc);
      clickPlaybackPrompts(frameDoc);
      nudgeVideos(frameDoc);
    } catch (e) {}
  }

  function monitorIframes() {
    Array.prototype.forEach.call(document.querySelectorAll('#playerContent iframe, #mainPlayer iframe, iframe'), function(frame) {
      if (frame.__streamboxBound) return;
      frame.__streamboxBound = true;
      frame.addEventListener('load', function() {
        inspectAccessibleFrame(frame);
        scheduleReadyFallback('dizipal-iframe-load', 8000);
      });
      inspectAccessibleFrame(frame);
    });
  }

  function applyPlayerChrome() {
    if (document.getElementById('streambox-dizipal-style')) return;

    var style = document.createElement('style');
    style.id = 'streambox-dizipal-style';
    style.textContent = [
      'html, body, .site-wrapper, .main-content, .watch-page, .watch-page.film-page, .watch-page .container, .video-wrapper, .video-player-container, .video-player-wrapper, #mainPlayer, #playerContent { background: #000 !important; margin: 0 !important; padding: 0 !important; }',
      '.site-wrapper, .main-content, .watch-page, .watch-page .container, .video-wrapper, .video-player-container, .video-player-wrapper, #mainPlayer, #playerContent { width: 100vw !important; max-width: 100vw !important; }',
      '.watch-page, .watch-page .container, .video-wrapper, .video-player-container, .video-player-wrapper, #mainPlayer, #playerContent { height: 100vh !important; min-height: 100vh !important; }',
      '.video-wrapper, .video-player-container, .video-player-wrapper, #mainPlayer, #playerContent { position: fixed !important; inset: 0 !important; z-index: 999999 !important; display: flex !important; align-items: center !important; justify-content: center !important; }',
      '#playerContent iframe, #mainPlayer iframe, #playerContent video, #mainPlayer video { width: 100vw !important; height: 100vh !important; border: none !important; z-index: 10 !important; max-width: 100% !important; max-height: 100% !important; }',
      '.jw-controls, .vjs-control-bar, .jw-controlbar, .video-controls, .player-controls { z-index: 9999999 !important; visibility: visible !important; }',
      '.pageskin-desktop-wrapper, .pageskin-click-left, .pageskin-click-right, .pageskin-mobile-wrapper, .main-header, .announcement-bar, .main-footer, .mobile-bottom-nav, .footer-sticky-ad, .ad-container, .embed-text-banner, .film-info-box, .episode-navigation, .episode-panel, .comments-section, .related-section, .watch-title-top, .series-hero, .watch-hero, .modal, .fade, .show, .popup { display: none !important; }'
    ].join('\\n');
    (document.head || document.documentElement).appendChild(style);
  }

  function removeNoise() {
    var selectors = [
      '.pageskin-desktop-wrapper',
      '.pageskin-click-left',
      '.pageskin-click-right',
      '.pageskin-mobile-wrapper',
      '.main-header',
      '.announcement-bar',
      '.main-footer',
      '.mobile-bottom-nav',
      '.footer-sticky-ad',
      '.ad-container',
      '.embed-text-banner',
      '.film-info-box',
      '.episode-navigation',
      '.episode-panel',
      '.comments-section',
      '.related-section',
      '.watch-title-top',
      '.series-hero',
      '.watch-hero'
    ];

    selectors.forEach(function(selector) {
      document.querySelectorAll(selector).forEach(function(element) {
        element.style.setProperty('display', 'none', 'important');
        element.style.setProperty('visibility', 'hidden', 'important');
        element.style.setProperty('pointer-events', 'none', 'important');
      });
    });

    document.querySelectorAll('a[target="_blank"], .modal, .fade, .show, .popup, [id*="google_ads"]').forEach(function(el) {
      if (el.closest('.video-player-container') || el.closest('#mainPlayer') || el.closest('#playerContent')) return;
      // Do NOT hide elements that look like start prompts (might be the "VİDEOYU BAŞLAT" modal)
      var text = (el.textContent || '').toLowerCase();
      if (text.indexOf('videoyu') !== -1 || text.indexOf('baslat') !== -1 || text.indexOf('oynat') !== -1) return;
      
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
    });

    var clickable = document.getElementById('prerollClickable');
    if (clickable) {
      clickable.onclick = null;
      clickable.style.setProperty('pointer-events', 'none', 'important');
    }
  }

  function managePreroll(rootDoc) {
    var doc = rootDoc || document;
    try {
      var videos = doc.querySelectorAll('video');
      Array.prototype.forEach.call(videos, function(v) {
        if (v.id === 'prerollVideo' || v.className.indexOf('ad-') !== -1 || v.duration < 60) {
          v.muted = true;
          if (v.playbackRate < 8) v.playbackRate = 16.0;
        }
      });

      var skipBtn = doc.getElementById('skipBtn');
      if (skipBtn && getComputedStyle(skipBtn).display !== 'none') {
        clickNode(skipBtn);
      }

      var allNodes = doc.querySelectorAll('button, div, a, span');
      Array.prototype.forEach.call(allNodes, function(node) {
        var txt = normalizeText(node.textContent || node.innerText || '');
        if (txt.indexOf('reklami gec') !== -1 || txt.indexOf('skip ad') !== -1) {
          clickNode(node);
        }
      });
      
      Array.prototype.forEach.call(doc.querySelectorAll('iframe'), function(frame) {
        try {
          var frameDoc = frame.contentDocument || (frame.contentWindow ? frame.contentWindow.document : null);
          if (frameDoc) managePreroll(frameDoc);
        } catch(e) {}
      });
    } catch (e) {}
  }

  var windowStartPlayerCalled = false;

  function startPlayerNow(forceReason) {
    if (readySent || notFoundSent) return;

    var now = Date.now();
    if (!forceReason && now - lastStartAttemptAt < 900) {
      return;
    }

    lastStartAttemptAt = now;
    managePreroll(document);
    clickPlaybackPrompts(document);

    if (!windowStartPlayerCalled && typeof window.startPlayer === 'function') {
      try {
        window.startPlayer();
        windowStartPlayerCalled = true;
      } catch (e) {}
    }

    var cover = document.getElementById('playerCover');
    if (cover) {
      clickNode(cover);
    }

    clickPlaybackPrompts(document);
    nudgeVideos(document);
    scheduleNotFound('dizipal-start-timeout', 35000);
  }

  function monitorPlayback() {
    scanForVideos(document);
    monitorIframes();
    managePreroll(document); // Always try to skip ads in the main document recursively

    if (!readySent && !notFoundSent) {
      clickPlaybackPrompts(document);
      nudgeVideos(document);

      if (hasVisiblePlayerContent() && !documentHasStartPrompt(document)) {
        if (playerShellVisibleAt && (Date.now() - playerShellVisibleAt > 5000)) {
          markPlaybackReady('dizipal-mainplayer-visible-5s');
        }
      }

      if (documentHasStartPrompt(document)) {
        startPlayerNow(false);
      }
    }
  }

  function hookConsoleErrors() {
    var originalError = console.error;
    console.error = function() {
      try {
        var message = Array.prototype.map.call(arguments, function(value) { return String(value); }).join(' ');
        if (message.toLowerCase().indexOf('no video config') !== -1) {
          markNotFound('dizipal-no-video-config');
        }
      } catch (e) {}
      if (originalError) {
        return originalError.apply(console, arguments);
      }
    };
  }

  hookConsoleErrors();
  applyPlayerChrome();
  removeNoise();
  managePreroll();

  window.addEventListener('load', function() {
    applyPlayerChrome();
    removeNoise();
    managePreroll();
    startPlayerNow(true);
    monitorPlayback();
  });

  setTimeout(function() {
    startPlayerNow(true);
    monitorPlayback();
  }, 350);

  setTimeout(function() {
    startPlayerNow(true);
    monitorPlayback();
  }, 2200);

  setInterval(function() {
    applyPlayerChrome();
    removeNoise();
    managePreroll();
    monitorPlayback();
  }, 1000);

  new MutationObserver(function() {
    applyPlayerChrome();
    removeNoise();
    managePreroll();
    monitorPlayback();
  }).observe(document.documentElement, { childList: true, subtree: true });

  scheduleNotFound('dizipal-initial-timeout', 25000);

  // Hard fallback: if anything is on screen after 12s, dismiss spinner
  setTimeout(function() {
    if (!readySent && !notFoundSent) {
      var anyContent = document.querySelector('iframe, video, embed, object, #mainPlayer iframe, #playerContent iframe, #mainPlayer video, #playerContent video');
      if (anyContent && !documentHasStartPrompt(document)) {
        markPlaybackReady('dizipal-hard-fallback-12s');
      }
    }
  }, 12000);

  true;
})();
`;
}
