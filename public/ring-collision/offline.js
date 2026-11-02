(() => {
  'use strict';
  if (window.__ringCollisionOfflineReady) return;
  window.__ringCollisionOfflineReady = true;

  const ASSETS = Object.freeze([
    '/ring-collision/styles.css',
    '/ring-collision/model.js',
    '/ring-collision/app.js'
  ]);

  function preserveControls(copy) {
    const originals = document.querySelectorAll('input, textarea, select');
    const copies = copy.querySelectorAll('input, textarea, select');
    originals.forEach((input, index) => {
      const target = copies[index];
      if (!target) return;
      if (input.tagName === 'TEXTAREA') target.textContent = input.value;
      else if (input.tagName === 'SELECT') {
        [...target.options].forEach((option, optionIndex) => {
          option.toggleAttribute('selected', input.options[optionIndex].selected);
        });
      } else if (input.type === 'checkbox' || input.type === 'radio') {
        target.toggleAttribute('checked', input.checked);
      } else if (input.type === 'file' || input.type === 'password') {
        target.removeAttribute('value');
      } else target.setAttribute('value', input.value);
    });
  }

  function buildOffline(css, model, app) {
    const copy = document.documentElement.cloneNode(true);
    preserveControls(copy);
    copy.querySelectorAll([
      'script', 'link', 'base', 'iframe', 'object', 'embed',
      '#download-offline', '#offline-status', '.site-home',
      '#pl-comments-root', '.lab-tools',
      'meta[http-equiv="Content-Security-Policy" i]',
      'meta[http-equiv="refresh" i]',
      'meta[property^="og:"]', 'meta[name^="twitter:"]'
    ].join(',')).forEach((node) => node.remove());
    // Remove resources that would otherwise resolve against file:// or the site.
    copy.querySelectorAll('[src], [srcset], [poster]').forEach((node) => {
      for (const attribute of ['src', 'srcset', 'poster']) {
        if (node.hasAttribute(attribute) && !node.getAttribute(attribute).trim().startsWith('data:')) {
          node.removeAttribute(attribute);
        }
      }
    });
    copy.querySelectorAll('a[href], [formaction], form[action]').forEach((node) => {
      if (node.hasAttribute('href') && !node.getAttribute('href').startsWith('#')) node.removeAttribute('href');
      node.removeAttribute('formaction');
      node.removeAttribute('action');
    });
    copy.querySelectorAll('svg [href], svg [xlink\\:href]').forEach((node) => {
      for (const attribute of ['href', 'xlink:href']) {
        const value = node.getAttribute(attribute);
        if (value && !value.startsWith('#') && !value.startsWith('data:')) node.removeAttribute(attribute);
      }
    });
    // The offline document can run only its embedded code and data, even if a
    // future stylesheet accidentally adds a remote font or background resource.
    const policy = document.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy';
    policy.content = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    const head = copy.querySelector('head');
    const body = copy.querySelector('body');
    if (!head || !body) throw new Error('页面结构不完整，无法打包');
    head.prepend(policy);
    const style = document.createElement('style');
    style.textContent = css.replace(/<\/style/gi, '<\\/style');
    head.append(style);
    for (const source of [model, app]) {
      const script = document.createElement('script');
      // HTML's raw-text parser recognizes this sequence even inside JS strings.
      script.textContent = source.replace(/<\/script/gi, '<\\/script');
      body.append(script);
    }
    const title = copy.querySelector('title');
    if (title && !title.textContent.includes('离线版')) title.textContent += '（离线版）';
    return '<!doctype html>\n' + copy.outerHTML;
  }

  function init() {
    const button = document.getElementById('download-offline');
    if (!button) return;
    let status = document.getElementById('offline-status');
    if (!status) {
      status = document.createElement('span');
      status.id = 'offline-status';
      button.after(status);
    }
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    let exporting = false;
    button.addEventListener('click', async () => {
      if (exporting) return;
      exporting = true;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      status.textContent = '正在打包离线文件…';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const sources = await Promise.all(ASSETS.map(async (path) => {
          const response = await fetch(path, {
            credentials: 'same-origin', mode: 'same-origin', redirect: 'error',
            cache: 'no-cache', signal: controller.signal
          });
          if (!response.ok) throw new Error(`${path} 读取失败（${response.status}）`);
          const source = await response.text();
          if (!source.trim() || /text\/html/i.test(response.headers.get('content-type') || '') || /^\s*(?:<!doctype\s+html|<html\b)/i.test(source)) {
            throw new Error(`${path} 未返回有效资源`);
          }
          return source;
        }));
        const html = buildOffline(...sources);
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = '圆环碰撞-离线版.html';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1_000);
        status.textContent = '离线文件已生成，下载后可直接双击打开。';
      } catch (error) {
        status.textContent = controller.signal.aborted
          ? '离线导出失败：资源读取超时，请稍后重试。'
          : `离线导出失败：${error.message || '无法读取页面资源'}。请确认站点资源可访问后重试。`;
      } finally {
        clearTimeout(timeout);
        controller.abort();
        exporting = false;
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
