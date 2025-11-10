(function () {
  'use strict';

  // ---------- helpers ----------
  const hostSwap = /(https?:\/\/)(?:www\.|mobile\.)?(?:x\.com|twitter\.com)\//gi;
  const toFx = (val) => (typeof val === 'string' ? val.replace(hostSwap, '$1fxtwitter.com/') : val);

  const rewriteIfChanged = (dt) => {
    if (!dt) return false;
    let changed = false;

    try {
      const t = dt.getData('text/plain');
      const h = dt.getData('text/html');
      const nt = toFx(t);
      const nh = toFx(h);
      if (nt && nt !== t) { dt.setData('text/plain', nt); changed = true; }
      if (nh && nh !== h) { dt.setData('text/html', nh); changed = true; }
    } catch {}
    return changed;
  };

  const safelyBind = (obj, prop) => {
    try { const fn = obj?.[prop]; return typeof fn === 'function' ? fn.bind(obj) : null; }
    catch { return null; }
  };

  // ---------- 1) patch navigator.clipboard ----------
  const clip = navigator.clipboard;
  if (clip) {
    // writeText
    const origWriteText = safelyBind(clip, 'writeText');
    if (origWriteText) {
      try {
        clip.writeText = function (text) {
          return origWriteText(toFx(text));
        };
      } catch {}
    }

    // write(ClipboardItem[])
    const origWrite = safelyBind(clip, 'write');
    if (origWrite) {
      try {
        clip.write = async function (items) {
          try {
            if (Array.isArray(items)) {
              const wrapped = await Promise.all(items.map(wrapClipboardItem));
              return origWrite(wrapped);
            }
          } catch {}
          return origWrite(items);
        };
      } catch {}
    }
  }

  // ---------- 2) wrap ClipboardItem constructor ----------
  const NativeClipboardItem = window.ClipboardItem;
  async function wrapClipboardItem(item) {
    if (!NativeClipboardItem || !item || typeof item !== 'object') return item;

    // spec allows a map of mime -> Blob | Promise<Blob> | () => Promise<Blob>
    const types = {};
    try {
      const entries = item.types ? item.types.map((t) => [t, item.getType(t)]) : Object.entries(item);
      for (const [mime, value] of entries) {
        if (mime === 'text/plain' || mime === 'text/html') {
          types[mime] = (async () => {
            const blob = typeof value === 'function' ? await value() : await value;
            const text = await blob.text();
            return new Blob([toFx(text)], { type: mime });
          });
        } else {
          types[mime] = value;
        }
      }
      return new NativeClipboardItem(types);
    } catch {
      return item;
    }
  }

  if (NativeClipboardItem) {
    try {
      const Wrapped = function ClipboardItemShim(items) {
        // normalize to a plain object so we can intercept text types
        const norm = {};
        try {
          for (const [k, v] of Object.entries(items || {})) {
            if (k === 'text/plain' || k === 'text/html') {
              norm[k] = async () => {
                const blob = typeof v === 'function' ? await v() : await v;
                const text = await (blob?.text ? blob.text() : Promise.resolve(String(blob || '')));
                return new Blob([toFx(text)], { type: k });
              };
            } else {
              norm[k] = v;
            }
          }
        } catch { return new NativeClipboardItem(items); }
        return new NativeClipboardItem(norm);
      };
      Wrapped.prototype = NativeClipboardItem.prototype;
      Object.defineProperty(window, 'ClipboardItem', { value: Wrapped });
    } catch {}
  }

  // ---------- 3) intercept copy events (capture + bubble) ----------
  const onCopyCapture = (e) => {
    try {
      // do nothing here; let site populate first
    } catch {}
  };

  const onCopyBubble = (e) => {
    try {
      const dt = e.clipboardData;
      if (!dt) return;
      // rewrite after X has set the payload
      const changed = rewriteIfChanged(dt);
      if (changed) {
        // ensure our modified payload sticks
        e.stopImmediatePropagation?.();
      }
    } catch {}
  };

  window.addEventListener('copy', onCopyCapture, true);  // capture
  window.addEventListener('copy', onCopyBubble, false);  // bubble
  window.addEventListener('cut', onCopyBubble, false);

  // ---------- 4) patch execCommand('copy') fallback ----------
  const origExec = safelyBind(document, 'execCommand');
  if (origExec) {
    try {
      document.execCommand = function (cmd, ...rest) {
        const res = origExec(cmd, ...rest);
        // a 'copy' event should have fired; nothing to do if blocked, but try a microtask tweak
        if (String(cmd).toLowerCase() === 'copy') {
          queueMicrotask(() => {
            // try to trigger a synthetic 'copy' with our handler if the site prevented default too early
            try {
              const ev = new ClipboardEvent('copy', { bubbles: true, cancelable: true });
              if (document.dispatchEvent(ev)) {
                // no one handled it; nothing we can do without read access
              }
            } catch {}
          });
        }
        return res;
      };
    } catch {}
  }

  // ---------- 5) rewrite hrefs on the page ----------
  function rewriteLinks(root) {
    if (!root || !root.querySelectorAll) return;
    const links = root.querySelectorAll(
      'a[href*="x.com/"],a[href*="twitter.com/"],a[href*="mobile.twitter.com/"]'
    );
    for (const a of links) {
      const href = a.getAttribute('href');
      if (!href) continue;
      const newHref = toFx(href);
      if (newHref !== href) a.setAttribute('href', newHref);
    }
  }

  rewriteLinks(document);

  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'childList' && m.addedNodes?.length) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) rewriteLinks(node);
        }
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

  try {
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href']
    });
  } catch {}

  // keep a trivial listener alive to ensure our script stays active across SPA transitions
  document.addEventListener('click', () => {}, true);
})();
