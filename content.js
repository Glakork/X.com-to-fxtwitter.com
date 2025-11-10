(() => {
  'use strict';
  if (window.__x_to_fx_sharefix__) return;
  window.__x_to_fx_sharefix__ = true;

  // ---- helpers ----
  const hostSwap = /(https?:\/\/)(?:www\.|mobile\.)?(?:x\.com|twitter\.com)\//gi;
  const toFx = (s) => (typeof s === 'string' ? s.replace(hostSwap, '$1fxtwitter.com/') : s);

  function hardPatchMethod(obj, key, wrapper) {
    try {
      const orig = obj[key];
      if (typeof orig !== 'function') return false;
      const patched = wrapper(orig.bind(obj));
      Object.defineProperty(obj, key, { configurable: false, enumerable: true, writable: false, value: patched });
      return true;
    } catch { return false; }
  }

  // find a tweet path near an element (or from current page)
  function findTweetPath(start) {
    try {
      const p = location.pathname;
      if (/^\/[^\/]+\/status\/\d+/.test(p)) return p;
    } catch {}
    let el = start;
    for (let i = 0; el && i < 24; i++, el = el.parentElement) {
      // strict: a direct permalink-looking anchor
      const a1 = el.querySelector?.('a[href^="/"][href*="/status/"]');
      if (a1) {
        const h = a1.getAttribute('href');
        if (h && /^\/[^\/]+\/status\/\d+/.test(h)) return h;
      }
      // x often wraps tweets in role=article
      if (el?.getAttribute?.('role') === 'article') {
        const a2 = el.querySelector?.('a[href^="/"][href*="/status/"]');
        if (a2) {
          const h = a2.getAttribute('href');
          if (h && /^\/[^\/]+\/status\/\d+/.test(h)) return h;
        }
      }
    }
    return null;
  }

  function buildFxFromPath(path) {
    if (!path) return null;
    return (location.protocol || 'https:') + '//fxtwitter.com' + path.replace(/^\/+/, '/');
  }

  // track last click/context targets to anchor the share menu to a tweet
  let lastPointerTarget = null;
  ['mousedown', 'pointerdown', 'contextmenu'].forEach(evt =>
    window.addEventListener(evt, (e) => {
      const t = e.target;
      if (t instanceof Element) lastPointerTarget = t;
    }, true)
  );

  // ----- clipboard hooks (keep as-is; they already fix video/gif) -----
  const clip = navigator.clipboard;
  if (clip) {
    hardPatchMethod(clip, 'writeText', (orig) => function (text) { return orig(toFx(text)); });

    const NativeClipboardItem = window.ClipboardItem;
    const isTextish = (m) => {
      const mm = String(m || '').toLowerCase();
      return mm === 'text/plain' || mm === 'text/html' || mm === 'text/uri-list' ||
             mm === 'text/x-moz-url' || mm === 'text/x-moz-url-priv' ||
             mm.startsWith('text/plain;') || mm.startsWith('text/html;');
    };
    const decodeBlob = async (v) => {
      const blob = typeof v === 'function' ? await v() : await v;
      if (!blob) return '';
      return blob.text ? blob.text() : String(blob);
    };

    async function wrapClipboardItem(item) {
      if (!NativeClipboardItem || !item || typeof item !== 'object') return item;
      try {
        const entries = item.types ? item.types.map((t) => [t, item.getType(t)]) : Object.entries(item);
        const map = {};
        for (const [mime, val] of entries) {
          if (isTextish(mime)) {
            map[mime] = async () => {
              const text = await decodeBlob(val);
              const out = String(mime).toLowerCase().startsWith('text/x-moz-url')
                ? text.replace(/^([^\n\r]+)([\n\r]+)(.*)$/s, (m, url, br, title) => toFx(url) + br + title)
                : toFx(text);
              return new Blob([out], { type: mime });
            };
          } else {
            map[mime] = val;
          }
        }
        return new NativeClipboardItem(map);
      } catch { return item; }
    }

    hardPatchMethod(clip, 'write', (orig) => async function (items) {
      try {
        if (Array.isArray(items)) {
          const wrapped = await Promise.all(items.map(wrapClipboardItem));
          return orig(wrapped);
        }
      } catch {}
      return orig(items);
    });

    if (window.ClipboardItem) {
      try {
        const Wrapped = function ClipboardItemShim(items) {
          const norm = {};
          try {
            for (const [k, v] of Object.entries(items || {})) {
              const key = String(k || '').toLowerCase();
              if (isTextish(key)) {
                norm[k] = async () => {
                  const text = await decodeBlob(v);
                  const out = key.startsWith('text/x-moz-url')
                    ? text.replace(/^([^\n\r]+)([\n\r]+)(.*)$/s, (m, url, br, title) => toFx(url) + br + title)
                    : toFx(text);
                  return new Blob([out], { type: k });
                };
              } else {
                norm[k] = v;
              }
            }
          } catch { return new window.ClipboardItem(items); }
          return new window.ClipboardItem(norm);
        };
        Wrapped.prototype = window.ClipboardItem.prototype;
        Object.defineProperty(window, 'ClipboardItem', { configurable: false, enumerable: false, writable: false, value: Wrapped });
      } catch {}
    }
  }

  // legacy copy path (harmless if not used)
  function rewriteEventClipboard(dt) {
    if (!dt) return;
    try {
      const types = dt.types ? Array.from(dt.types) : [];
      const txt = dt.getData('text/plain');
      const html = dt.getData('text/html');
      const uri = types.includes('text/uri-list') ? dt.getData('text/uri-list') : '';
      const moz = types.includes('text/x-moz-url') ? dt.getData('text/x-moz-url') : '';

      const newTxt = toFx(txt);
      const newHtml = toFx(html);
      if (newTxt && newTxt !== txt) dt.setData('text/plain', newTxt);
      if (newHtml && newHtml !== html) dt.setData('text/html', newHtml);
      if (uri) dt.setData('text/uri-list', toFx(uri));
      if (moz) dt.setData('text/x-moz-url', moz.replace(/^([^\n\r]+)/, (m) => toFx(m)));
    } catch {}
  }
  window.addEventListener('copy', () => {}, true);
  window.addEventListener('copy', (e) => rewriteEventClipboard(e.clipboardData), false);
  window.addEventListener('cut',  (e) => rewriteEventClipboard(e.clipboardData), false);

  // ---- targeted fix: intercept ONLY “Share → Copy link” menu item ----
  // we **don’t** block the click unless we successfully write the fx URL.
  function isShareCopyLinkItem(node) {
    if (!node) return false;
    // climb a few levels; menu items often have role="menuitem"
    let el = node;
    for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
      const role = el.getAttribute?.('role');
      const text = (el.textContent || '').toLowerCase().trim();
      const dtid = (el.getAttribute?.('data-testid') || '').toLowerCase();
      const looksMenu = role === 'menuitem' || /menu/.test(dtid);
      const saysCopyLink =
        /copy/.test(text) && /link/.test(text) && !/video|gif/.test(text); // exclude video/gif which already work
      const idish = /copy\-link/.test(dtid) || /share.*copy.*link/.test(dtid);
      if (looksMenu && (saysCopyLink || idish)) return el;
    }
    return null;
  }

  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    const item = isShareCopyLinkItem(t);
    if (!item) return;

    // compute tweet path from context (last pointer target near the tweet)
    const path = findTweetPath(lastPointerTarget || t) ||
                 (/^\/[^\/]+\/status\/\d+/.test(location.pathname) ? location.pathname : null);
    const fx = buildFxFromPath(path);

    if (!fx) return; // let X handle it if we can't be sure

    // attempt to write; only stop the event if we succeed (so the button still works if we fail)
    let blocked = false;
    const write = async () => {
      try {
        await navigator.clipboard.writeText(fx);
        blocked = true;
      } catch {
        try {
          const ta = document.createElement('textarea');
          ta.value = fx;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
          blocked = true;
        } catch {}
      }
      if (blocked) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      }
    };
    // run immediately within the same gesture
    write();
  }, true);

  // ---- rewrite anchors (unchanged) ----
  function rewriteLinks(root) {
    if (!root || !root.querySelectorAll) return;
    const links = root.querySelectorAll('a[href*="x.com/"],a[href*="twitter.com/"],a[href*="mobile.twitter.com/"]');
    for (const a of links) {
      const href = a.getAttribute('href');
      if (!href) continue;
      const newHref = toFx(href);
      if (newHref !== href) a.setAttribute('href', newHref);
    }
  }
  rewriteLinks(document);
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'childList' && m.addedNodes?.length) {
        for (const n of m.addedNodes) if (n.nodeType === 1) rewriteLinks(n);
      } else if (m.type === 'attributes' && m.attributeName === 'href') {
        const el = m.target;
        if (el && el.tagName === 'A') {
          const href = el.getAttribute('href');
          if (href) {
            const newHref = toFx(href);
            if (newHref !== href) el.setAttribute('href', newHref);
          }
        }
      }
    }
  });
  try { mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] }); } catch {}
})();
