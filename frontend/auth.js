/**
 * 登录 / 注册页逻辑：表单校验 + 调用后端 /api/auth/* 接口
 */
(function () {
  "use strict";

  var el = {
    tabLogin: document.getElementById("tabLogin"),
    tabRegister: document.getElementById("tabRegister"),
    loginForm: document.getElementById("loginForm"),
    registerForm: document.getElementById("registerForm"),
    loginSubmit: document.getElementById("loginSubmit"),
    registerSubmit: document.getElementById("registerSubmit"),
    loginUsername: document.getElementById("loginUsername"),
    loginPassword: document.getElementById("loginPassword"),
    regUsername: document.getElementById("regUsername"),
    regPassword: document.getElementById("regPassword"),
    regPassword2: document.getElementById("regPassword2"),
    roleTip: document.getElementById("roleTip"),
    authMsg: document.getElementById("authMsg")
  };

  var busy = false;

  function showMsg(text, type) {
    el.authMsg.textContent = text || "";
    el.authMsg.classList.remove("hidden", "is-error", "is-ok", "is-info");
    el.authMsg.classList.add(type === "error" ? "is-error" : (type === "ok" ? "is-ok" : "is-info"));
  }

  function hideMsg() {
    el.authMsg.classList.add("hidden");
    el.authMsg.textContent = "";
  }

  function setBusy(flag) {
    busy = flag;
    el.loginSubmit.disabled = flag;
    el.registerSubmit.disabled = flag;
  }

  function selectedRole() {
    var checked = document.querySelector('input[name="role"]:checked');
    return checked ? checked.value : "student";
  }

  function switchTab(name) {
    var isLogin = name === "login";
    el.tabLogin.classList.toggle("active", isLogin);
    el.tabRegister.classList.toggle("active", !isLogin);
    el.tabLogin.setAttribute("aria-selected", isLogin ? "true" : "false");
    el.tabRegister.setAttribute("aria-selected", isLogin ? "false" : "true");
    el.loginForm.classList.toggle("hidden", !isLogin);
    el.registerForm.classList.toggle("hidden", isLogin);
    hideMsg();
  }

  function postAuth(path, payload) {
    return fetch(window.MathVisAuth.API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () {
        return { ok: false, error: "服务返回异常，请稍后重试" };
      });
    });
  }

  function enterMain(data) {
    window.MathVisAuth.saveSession(data.token, data.user);
    showMsg("登录成功，正在进入…", "ok");
    location.replace("main.html");
  }

  function doLogin() {
    if (busy) return;
    var username = el.loginUsername.value.trim();
    var password = el.loginPassword.value;
    if (!username || !password) { showMsg("请输入用户名和密码", "error"); return; }
    hideMsg();
    setBusy(true);
    postAuth("/api/auth/login", { username: username, password: password })
      .then(function (data) {
        if (!data || data.ok !== true) throw new Error(data.error || "登录失败");
        enterMain(data);
      })
      .catch(function (err) {
        showMsg("登录失败：" + err.message, "error");
      })
      .finally(function () { setBusy(false); });
  }

  function doRegister() {
    if (busy) return;
    var username = el.regUsername.value.trim();
    var password = el.regPassword.value;
    var password2 = el.regPassword2.value;
    if (!username || !password) { showMsg("请填写用户名和密码", "error"); return; }
    if (password !== password2) { showMsg("两次输入的密码不一致", "error"); return; }
    hideMsg();
    setBusy(true);
    postAuth("/api/auth/register", { username: username, password: password, role: selectedRole() })
      .then(function (data) {
        if (!data || data.ok !== true) throw new Error(data.error || "注册失败");
        // 老师注册后是待审核状态，后端不返回令牌
        if (data.status === "pending" || !data.token) {
          el.registerForm.reset();
          el.roleTip.classList.remove("hidden");
          switchTab("login");
          el.loginUsername.value = username;
          showMsg(data.message || "注册成功，请等待管理员审核通过后再登录", "info");
          return;
        }
        enterMain(data);
      })
      .catch(function (err) {
        showMsg("注册失败：" + err.message, "error");
      })
      .finally(function () { setBusy(false); });
  }

  function bind() {
    el.tabLogin.addEventListener("click", function () { switchTab("login"); });
    el.tabRegister.addEventListener("click", function () { switchTab("register"); });

    el.loginForm.addEventListener("submit", function (e) { e.preventDefault(); doLogin(); });
    el.registerForm.addEventListener("submit", function (e) { e.preventDefault(); doRegister(); });

    // 选中老师时提示需要审核
    Array.prototype.forEach.call(document.querySelectorAll('input[name="role"]'), function (radio) {
      radio.addEventListener("change", function () {
        el.roleTip.classList.toggle("hidden", selectedRole() !== "teacher");
      });
    });

    var back = document.querySelector(".auth-foot a[href='main.html']");
    if (back) {
      back.addEventListener("click", function (e) {
        if (!window.MathVisAuth.getToken()) {
          e.preventDefault();
          showMsg("请先登录后再进入搜题页", "info");
        }
      });
    }
  }

  function init() {
    // 已登录的用户不用再看登录页
    if (window.MathVisAuth.getToken()) { location.replace("main.html"); return; }
    bind();
    el.loginUsername.focus();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
