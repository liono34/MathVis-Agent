/**
 * 登录态公共工具：所有页面共用
 * 令牌存在 localStorage，请求时通过 Authorization: Bearer 头带给后端
 */
(function (global) {
  "use strict";

  var API_BASE = "http://127.0.0.1:8000";
  var TOKEN_KEY = "mathvis_token";
  var USER_KEY = "mathvis_user";

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
  function safeRemove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }

  function getToken() { return safeGet(TOKEN_KEY) || ""; }

  function getUser() {
    var raw = safeGet(USER_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function saveSession(token, user) {
    safeSet(TOKEN_KEY, token);
    safeSet(USER_KEY, JSON.stringify(user || {}));
  }

  function clearSession() {
    safeRemove(TOKEN_KEY);
    safeRemove(USER_KEY);
  }

  function authHeaders(extra) {
    var headers = extra || {};
    var token = getToken();
    if (token) headers["Authorization"] = "Bearer " + token;
    return headers;
  }

  // 没登录就直接跳登录页，返回 false 表示已跳转
  function requireLogin() {
    if (!getToken()) { location.replace("auth.html"); return false; }
    return true;
  }

  function logout() {
    var done = function () { clearSession(); location.replace("auth.html"); };
    if (!getToken()) { done(); return; }
    fetch(API_BASE + "/api/auth/logout", { method: "POST", headers: authHeaders() })
      .catch(function () {})
      .then(done);
  }

  function roleLabel(role) {
    if (role === "teacher") return "老师";
    if (role === "student") return "学生";
    return "用户";
  }

  global.MathVisAuth = {
    API_BASE: API_BASE,
    getToken: getToken,
    getUser: getUser,
    saveSession: saveSession,
    clearSession: clearSession,
    authHeaders: authHeaders,
    requireLogin: requireLogin,
    logout: logout,
    roleLabel: roleLabel
  };
})(window);
