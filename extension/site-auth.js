/* 留个点 · 登录态转交
 * 只在 map.chesterlee.cn 上跑：把本站 localStorage 里的账户 Token 同步给扩展后台，
 * 扩展据此调 /api/notes（Bearer）。不读其他站点的任何数据。
 */
(function () {
  'use strict';

  var TOKEN_KEY = 'ps_token';
  var lastSent = null;

  function currentToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (err) { return ''; }
  }

  function relay() {
    var token = currentToken();
    if (token === lastSent) return;
    lastSent = token;
    try {
      chrome.runtime.sendMessage({ type: 'mn:token', token: token }, function () {
        void chrome.runtime.lastError;
      });
    } catch (err) {
      // 扩展被重载时当前页的上下文会失效，忽略即可
    }
  }

  relay();

  // 登录回跳是异步换票，本地存储会晚几秒才写入：分批兜底
  [1000, 2500, 5000, 9000, 15000].forEach(function (delay) {
    setTimeout(relay, delay);
  });

  window.addEventListener('storage', function (event) {
    if (!event.key || event.key === TOKEN_KEY) relay();
  });
  document.addEventListener('visibilitychange', relay);
})();
