(function () {
  'use strict';

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

  const NativeClipboardItem = window.ClipboardItem;
  async function wrapClipboardItem(item) {
    if (!NativeClipboardItem || !item || typeof item !== 'object') return item;

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

  const onCopyCapture = (e) => {
    try {
    } catch {}
  };

  const onCopyBubble = (e) => {
    try {
      const dt = e.clipboardData;
      if (!dt) return;
      const changed = rewriteIfChanged(dt);
      if (changed) {
        e.stopImmediatePropagation?.();
      }
    } catch {}
  };

  window.addEventListener('copy', onCopyCapture, true); 
  window.addEventListener('copy', onCopyBubble, false);  
  window.addEventListener('cut', onCopyBubble, false);

  const origExec = safelyBind(document, 'execCommand');
  if (origExec) {
    try {
      document.execCommand = function (cmd, ...rest) {
        const res = origExec(cmd, ...rest);
        if (String(cmd).toLowerCase() === 'copy') {
          queueMicrotask(() => {
            try {
              const ev = new ClipboardEvent('copy', { bubbles: true, cancelable: true });
              if (document.dispatchEvent(ev)) {
              }
            } catch {}
          });
        }
        return res;
      };
    } catch {}
  }

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

  document.addEventListener('click', () => {}, true);
})();

