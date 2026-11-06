/* ============================================================
   map-notes · 统一账户入口（附加项）
   登录态只用于显示「登录 / 我的」；SDK 不可用时页面照常可用。
   同时把账户中心 Token 换成 map-notes 自己的会话 cookie，
   服务端据此只放行本人 uid。
   账户中心：https://account.chesterlee.cn
   ============================================================ */
(function () {
  var PS_ACCOUNT = {
    prod: 'https://account.chesterlee.cn',
    pageLocal: 'http://localhost:18830', // 本机：账户中心页面
    apiLocal: 'http://localhost:8942'    // 本机：账户中心接口
  };
  var PRODUCT_ID = 'map-notes';
  var TOKEN_KEY = 'ps_token';

  function isLocalHost() {
    return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  }
  function accountWeb() { return isLocalHost() ? PS_ACCOUNT.pageLocal : PS_ACCOUNT.prod; }
  function accountApi() { return isLocalHost() ? PS_ACCOUNT.apiLocal : PS_ACCOUNT.prod; }

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (err) { return ''; }
  }

  function loginPage() {
    return accountWeb() + '/login.html'
      + '?productId=' + encodeURIComponent(PRODUCT_ID)
      + '&returnUrl=' + encodeURIComponent(location.href);
  }

  function loadAuthSdk() {
    if (window.__authSdkReady) return window.__authSdkReady;
    window.__authSdkReady = new Promise(function (resolve) {
      if (!accountWeb() || !accountApi()) { resolve(null); return; }
      var script = document.createElement('script');
      script.src = 'assets/js/ps-auth.js';
      script.onload = function () {
        if (!window.PSAuth) { resolve(null); return; }
        window.PSAuth.init({
          apiBase: accountApi(),
          loginUrl: accountWeb() + '/login.html',
          productId: PRODUCT_ID
        });
        resolve(window.PSAuth);
      };
      script.onerror = function () { resolve(null); };
      document.head.appendChild(script);
    });
    return window.__authSdkReady;
  }

  /** 用账户中心 Token 换本站会话 cookie；服务端只认本人 uid */
  function establishSession(token) {
    return fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: '{}'
    }).then(function (res) {
      return res.ok;
    }).catch(function () {
      return false;
    });
  }

  var bootPromise = null;

  /** 页面启动前等它：{ sdk, user, session }，sdk 不可用时也正常返回 */
  function boot() {
    if (bootPromise) return bootPromise;
    bootPromise = loadAuthSdk().then(function (sdk) {
      if (!sdk) return { sdk: null, user: null, session: false };
      return sdk.getUser().then(function (user) {
        if (!user) return { sdk: sdk, user: null, session: false };
        var token = getToken();
        if (!token) return { sdk: sdk, user: user, session: false };
        return establishSession(token).then(function (ok) {
          return { sdk: sdk, user: user, session: ok };
        });
      });
    }).catch(function () {
      return { sdk: null, user: null, session: false };
    });
    return bootPromise;
  }

  window.MNAuth = {
    boot: boot,
    getToken: getToken,
    requireLogin: function () {
      return boot().then(function (result) {
        if (result.sdk) return result.sdk.requireLogin();
        location.href = loginPage();
      });
    }
  };

  function setupAccountEntry() {
    var el = document.getElementById('accountEntry');
    if (!el) return;
    var img = document.getElementById('accountAvatar');
    var icon = el.querySelector('.mn-avatar-icon');
    img.onerror = function () { img.hidden = true; icon.hidden = false; };

    // SDK 不可用时也给个去处：点一下直接去账户中心登录页
    el.onclick = function () { location.href = loginPage(); };

    boot().then(function (result) {
      var user = result.user;
      if (!user) {
        el.classList.remove('is-on');
        el.title = '登录统一账户';
        el.setAttribute('aria-label', '登录统一账户');
        el.onclick = function () { window.MNAuth.requireLogin(); };
        return;
      }
      if (user.avatar) {
        img.src = user.avatar;
        img.hidden = false;
        icon.hidden = true;
      }
      var name = user.nickname || '我的账户';
      el.classList.add('is-on');
      el.title = name + ' · 打开我的账户';
      el.setAttribute('aria-label', name + '，打开我的账户');
      el.onclick = function () { location.href = accountWeb() + '/account.html'; };
    }).catch(function () { /* 账户接口不可用不打扰用户 */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupAccountEntry);
  } else {
    setupAccountEntry();
  }
})();
