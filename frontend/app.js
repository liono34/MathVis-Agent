(function () {
  "use strict";
  var API_BASE = "http://127.0.0.1:8000";
  var SESSION_KEY = "mathvis_session_id";

  var el = {
    input: document.getElementById("questionInput"),
    submitBtn: document.getElementById("submitBtn"),
    resetBtn: document.getElementById("resetBtn"),
    ocrBtn: document.getElementById("ocrBtn"),
    statusText: document.getElementById("statusText"),
    errorBanner: document.getElementById("errorBanner"),
    textPanel: document.getElementById("textPanel"),
    analysisText: document.getElementById("analysisText"),
    metaLine: document.getElementById("metaLine"),
    resultArea: document.querySelector(".result-area"),
    threejsPanel: document.getElementById("threejsPanel"),
    threejsHolder: document.getElementById("threejsCanvasHolder"),
    dropzone: document.getElementById("dropzone"),
    imageInput: document.getElementById("imageInput"),
    dzEmpty: document.getElementById("dzEmpty"),
    dzPreview: document.getElementById("dzPreview"),
    imagePreview: document.getElementById("imagePreview"),
    imageName: document.getElementById("imageName"),
    removeImageBtn: document.getElementById("removeImageBtn"),
    btnScreenshot: document.getElementById("btnScreenshot"),
    btnRecordStart: document.getElementById("btnRecordStart"),
    btnRecordStop: document.getElementById("btnRecordStop"),
    recordStatus: document.getElementById("recordStatus"),
    paramControlPanel: document.getElementById("paramControlPanel")
  };

  var selectedFile = null;
  var lastOcrText = null;
  var ocrInSession = false;
  var busy = false;

  var currentGeo = null;
  var renderMode = null;
  var threeScene = null;
  var threeCamera = null;
  var threeRenderer = null;
  var threeMesh = null;
  var canvas2d = null;
  var ctx2d = null;
  var mediaRecorder = null;
  var recordedChunks = [];
  var isRecording = false;

  function getOrCreateSessionId() {
    var sid = null;
    try { sid = localStorage.getItem(SESSION_KEY); } catch(e) {}
    if (!sid) {
      sid = "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
      try { localStorage.setItem(SESSION_KEY, sid); } catch(e) {}
    }
    return sid;
  }

  function setStatus(text, loading) {
    el.statusText.textContent = text || "";
    el.statusText.classList.toggle("loading", !!loading);
  }

  function showBanner(msg, isErr) {
    el.errorBanner.classList.remove("hidden");
    el.errorBanner.classList.toggle("success", !isErr);
    el.errorBanner.textContent = msg;
  }

  function hideBanner() {
    el.errorBanner.classList.add("hidden");
    el.errorBanner.textContent = "";
  }

  function setBusy(flag) {
    busy = flag;
    el.submitBtn.disabled = flag;
    el.ocrBtn.disabled = flag || !selectedFile;
    el.resetBtn.disabled = flag;
  }

  function postJSON(url) {
    return fetch(url, { method: "POST" }).then(function(r) {
      return r.json().catch(function() { return {ok:false, error:"请求失败"}; });
    });
  }

  function postImage(url, file) {
    var fd = new FormData();
    fd.append("file", file, file.name);
    return fetch(url, { method: "POST", body: fd }).then(function(r) {
      return r.json().catch(function() { return {ok:false, error:"上传失败"}; });
    });
  }

  function runAgent(sid) {
    return postJSON(API_BASE + "/api/agent-run?session_id=" + encodeURIComponent(sid));
  }

  function run() {
    if (busy) return;
    var question = el.input.value.trim();
    var sid = getOrCreateSessionId();
    if (!question && selectedFile) { uploadAndRun(sid); return; }
    if (!question) { setStatus("请先输入题目或上传图片"); el.input.focus(); return; }
    hideBanner();
    setStatus("正在请求…", true);
    setBusy(true);
    var needSave = !(ocrInSession && el.input.value === lastOcrText);
    var step = needSave
      ? postJSON(API_BASE + "/api/text-question?session_id=" + encodeURIComponent(sid) + "&question=" + encodeURIComponent(question))
      : Promise.resolve({ok:true});
    step.then(function(saved) {
      if (!saved || saved.ok !== true) throw new Error(saved.error || "保存失败");
      return runAgent(sid);
    }).then(handleResult).catch(function(err) {
      showBanner("请求失败:" + err.message, true);
    }).finally(function() {
      setStatus("就绪"); setBusy(false);
    });
  }

  function uploadAndRun(sid) {
    hideBanner();
    setStatus("图片识别中…", true);
    setBusy(true);
    postImage(API_BASE + "/api/upload-image?session_id=" + encodeURIComponent(sid), selectedFile)
      .then(function(data) {
        if (!data || data.ok !== true) throw new Error(data.error || "识别失败");
        var text = (data.ocr_text || "").trim();
        if (!text) throw new Error("未识别出文字");
        el.input.value = text;
        lastOcrText = text;
        ocrInSession = true;
        setStatus("识别完成,正在推导…", true);
        return runAgent(sid);
      }).then(handleResult).catch(function(err) {
        showBanner("失败:" + err.message, true);
      }).finally(function() {
        setStatus("就绪"); setBusy(false);
      });
  }

  function destroyThree() {
    if (threeRenderer) {
      threeRenderer.dispose();
      if (threeRenderer.domElement.parentNode) threeRenderer.domElement.parentNode.removeChild(threeRenderer.domElement);
    }
    threeScene = threeCamera = threeRenderer = threeMesh = null;
  }

  function destroy2d() {
    if (canvas2d && canvas2d.parentNode) canvas2d.parentNode.removeChild(canvas2d);
    canvas2d = null; ctx2d = null;
  }

  function stopRecord() {
    if (isRecording && mediaRecorder) mediaRecorder.stop();
    isRecording = false; mediaRecorder = null; recordedChunks = [];
    el.btnRecordStart.classList.remove("hidden");
    el.btnRecordStop.classList.add("hidden");
    el.recordStatus.classList.add("hidden");
  }

  function clearParamPanel() { el.paramControlPanel.innerHTML = ""; }

  function buildParams(params, onChange) {
    clearParamPanel();
    if (!params || typeof params !== "object") return;
    Object.keys(params).forEach(function(key) {
      var row = document.createElement("div"); row.className = "param-row";
      var label = document.createElement("label"); label.className = "param-label"; label.textContent = key;
      var num = document.createElement("input"); num.type = "number"; num.step = "0.1"; num.value = Number(params[key]);
      var rng = document.createElement("input"); rng.type = "range"; rng.min = "-10"; rng.max = "10"; rng.step = "0.1"; rng.value = Number(params[key]);
      function sync(v) {
        num.value = v; rng.value = v; params[key] = Number(v); onChange();
      }
      num.addEventListener("input", function() { sync(this.value); });
      rng.addEventListener("input", function() { sync(this.value); });
      row.appendChild(label); row.appendChild(num); row.appendChild(rng);
      el.paramControlPanel.appendChild(row);
    });
  }

  function init3D(geoObj) {
    destroyThree(); destroy2d(); clearParamPanel();
    if (!geoObj || !geoObj.shape) return;
    var w = el.threejsHolder.clientWidth, h = el.threejsHolder.clientHeight;
    if (!w || !h) { w = 800; h = 420; }
    threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color(0xf6f8fa);
    threeCamera = new THREE.PerspectiveCamera(60, w/h, 0.1, 500);
    threeRenderer = new THREE.WebGLRenderer({antialias:true, preserveDrawingBuffer:true});
    threeRenderer.setSize(w, h);
    el.threejsHolder.appendChild(threeRenderer.domElement);

    function makeParam(surfaceFunc, seg) {
      seg = seg || 64;
      var geo = new THREE.PlaneGeometry(1, 1, seg, seg);
      var pos = geo.attributes.position;
      for (var i = 0; i < pos.count; i++) {
        var u = pos.getX(i) * Math.PI;
        var v = pos.getY(i) * Math.PI * 2;
        var p = surfaceFunc(u, v);
        pos.setXYZ(i, p[0], p[1], p[2]);
      }
      geo.computeVertexNormals();
      return geo;
    }

    function rebuild() {
      if (threeMesh) threeScene.remove(threeMesh);
      var s = geoObj.shape, p = geoObj.params;
      var g;

      if (s === "cuboid") {
        g = new THREE.BoxGeometry(p.width||2, p.height||2, p.depth||2);
      } else if (s === "sphere") {
        g = new THREE.SphereGeometry(p.radius||1, 64, 64);
      } else if (s === "cylinder") {
        g = new THREE.CylinderGeometry(p.radius||1, p.radius||1, p.height||2, 64);
      } else if (s === "cone") {
        g = new THREE.ConeGeometry(p.radius||1, p.height||2, 64);
      } else if (s === "ellipsoid") {
        var a = p.a||2, b = p.b||3, c = p.c||1.5;
        g = makeParam(function(u, v) {
          return [a * Math.sin(u) * Math.cos(v),
                  b * Math.sin(u) * Math.sin(v),
                  c * Math.cos(u)];
        }, 64);
      } else if (s === "hyperboloid1") {
        var a = p.a||1.5, b = p.b||2, c = p.c||1.5;
        var zMax = 2.5;
        g = makeParam(function(u, v) {
          var z = u * 2 * zMax - zMax;
          var r = Math.sqrt(1 + (z*z)/(c*c));
          return [a * r * Math.cos(v), b * r * Math.sin(v), z];
        }, 64);
      } else if (s === "hyperboloid2") {
        var a = p.a||1.5, b = p.b||2, c = p.c||1.5;
        var zMin = c * 1.2;
        g = makeParam(function(u, v) {
          var z = zMin + u * 3;
          var r = Math.sqrt((z*z)/(c*c) - 1);
          return [a * r * Math.cos(v), b * r * Math.sin(v), z];
        }, 64);
      } else if (s === "paraboloid") {
        var a = p.a||1.5, b = p.b||2, height = p.height||4;
        var rMax = Math.sqrt(height);
        g = makeParam(function(u, v) {
          var r = u * rMax;
          return [r * Math.cos(v) * a, r * Math.sin(v) * b, r*r];
        }, 64);
      } else if (s === "torus") {
        g = new THREE.TorusGeometry(p.R||2, p.r||0.6, 32, 120);
      } else {
        g = new THREE.BoxGeometry(1,1,1);
      }

      threeMesh = new THREE.Mesh(g, new THREE.MeshNormalMaterial({side:THREE.DoubleSide}));
      threeScene.add(threeMesh);
      var edges = new THREE.EdgesGeometry(g, 15);
      threeMesh.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({color:0x333333, transparent:true, opacity:0.25})));

      var vals = Object.values(p).map(Number);
      var maxDim = Math.max.apply(null, vals) * 2.5 || 5;
      threeCamera.position.set(maxDim*0.7, maxDim*0.7, maxDim*0.9);
      threeCamera.lookAt(0,0,0);
    }

    rebuild();
    buildParams(geoObj.params, rebuild);
    function anim() {
      if (!threeRenderer) return;
      requestAnimationFrame(anim);
      if (threeMesh) { threeMesh.rotation.y += 0.004; }
      threeRenderer.render(threeScene, threeCamera);
    }
    anim();
  }

  // 函数表达式解析器（注意顺序：先log再ln，避免Math.log被二次替换）
  function evalFunc(funcStr, x) {
    if (!funcStr) return null;
    try {
      var expr = String(funcStr)
        .replace(/\\/g, "")
        .replace(/\s+/g, "")
        .replace(/log10\(/g, "Math.log10(")
        .replace(/log\(/g, "Math.log(")
        .replace(/ln\(/g, "Math.log(")
        .replace(/lnx/g, "Math.log(x)")
        .replace(/sin\(/g, "Math.sin(")
        .replace(/cos\(/g, "Math.cos(")
        .replace(/tan\(/g, "Math.tan(")
        .replace(/sqrt\(/g, "Math.sqrt(")
        .replace(/exp\(/g, "Math.exp(")
        .replace(/π/g, "Math.PI")
        .replace(/pi/gi, "Math.PI")
        .replace(/\^/g, "**")
        .replace(/x/g, "(" + x + ")");
      var val = eval(expr);
      if (isFinite(val)) return val;
      return null;
    } catch(e) {
      return null;
    }
  }

  function init2D(animObj) {
    destroyThree(); destroy2d(); clearParamPanel();
    console.log("2D渲染数据:", animObj);
    var w = el.threejsHolder.clientWidth, h = el.threejsHolder.clientHeight;
    if (!w || !h) { w = 800; h = 420; }
    canvas2d = document.createElement("canvas");
    canvas2d.width = w; canvas2d.height = h;
    canvas2d.style.background = "#ffffff";
    el.threejsHolder.appendChild(canvas2d);
    ctx2d = canvas2d.getContext("2d");

    var pad = 50;
    var plotW = w - pad*2;
    var plotH = h - pad*2;

    // 为积分/函数类型构造可调参数
    if (animObj.type === "integral") {
      animObj.params = { a: Number(animObj.a)||0, b: Number(animObj.b)||1 };
    } else if (animObj.type === "function") {
      animObj.params = {
        xMin: Number(animObj.xMin)||-5,
        xMax: Number(animObj.xMax)||5
      };
    }

    function makeScale(xMin, xMax, yMin, yMax) {
      return {
        x: function(x) { return pad + (x - xMin)/(xMax - xMin) * plotW; },
        y: function(y) { return h - pad - (y - yMin)/(yMax - yMin) * plotH; }
      };
    }

    function drawAxes(xMin, xMax, yMin, yMax) {
      var sc = makeScale(xMin, xMax, yMin, yMax);
      ctx2d.strokeStyle = "#333"; ctx2d.lineWidth = 1.5;
      ctx2d.beginPath();
      ctx2d.moveTo(sc.x(xMin), sc.y(0));
      ctx2d.lineTo(sc.x(xMax), sc.y(0));
      ctx2d.stroke();
      ctx2d.beginPath();
      ctx2d.moveTo(sc.x(0), sc.y(yMin));
      ctx2d.lineTo(sc.x(0), sc.y(yMax));
      ctx2d.stroke();
      ctx2d.fillStyle = "#666"; ctx2d.font = "12px sans-serif";
      for (var x = Math.ceil(xMin); x <= xMax; x++) {
        ctx2d.beginPath();
        ctx2d.moveTo(sc.x(x), sc.y(0)-4);
        ctx2d.lineTo(sc.x(x), sc.y(0)+4);
        ctx2d.stroke();
        ctx2d.fillText(x.toString(), sc.x(x)-3, sc.y(0)+16);
      }
      for (var y = Math.ceil(yMin); y <= yMax; y++) {
        ctx2d.beginPath();
        ctx2d.moveTo(sc.x(0)-4, sc.y(y));
        ctx2d.lineTo(sc.x(0)+4, sc.y(y));
        ctx2d.stroke();
        ctx2d.fillText(y.toString(), sc.x(0)+8, sc.y(y)+4);
      }
      return sc;
    }

    function draw() {
      ctx2d.clearRect(0,0,w,h);
      var type = animObj.type;

      if (type === "function") {
        var func = animObj.func || "x";
        var xMin = animObj.params.xMin, xMax = animObj.params.xMax;
        var yMin = Infinity, yMax = -Infinity;
        var steps = 300;
        for (var i = 0; i <= steps; i++) {
          var x = xMin + (xMax-xMin)*i/steps;
          var y = evalFunc(func, x);
          if (y !== null && isFinite(y)) {
            if (y < yMin) yMin = y;
            if (y > yMax) yMax = y;
          }
        }
        if (!isFinite(yMin) || !isFinite(yMax)) { yMin = -1; yMax = 1; }
        var yRange = yMax - yMin || 1;
        yMin -= yRange*0.15; yMax += yRange*0.15;
        var sc = drawAxes(xMin, xMax, yMin, yMax);
        ctx2d.strokeStyle = "#2563eb"; ctx2d.lineWidth = 2.5;
        ctx2d.beginPath();
        var started = false;
        for (var i = 0; i <= steps; i++) {
          var x = xMin + (xMax-xMin)*i/steps;
          var y = evalFunc(func, x);
          if (y === null || !isFinite(y)) { started = false; continue; }
          var px = sc.x(x), py = sc.y(y);
          if (!started) { ctx2d.moveTo(px, py); started = true; }
          else ctx2d.lineTo(px, py);
        }
        ctx2d.stroke();
        ctx2d.fillStyle = "#2563eb"; ctx2d.font = "italic 14px serif";
        ctx2d.fillText("y = " + func, sc.x(xMax)-120, sc.y(yMax)-10);

      } else if (type === "integral") {
        var func = animObj.func || "x";
        var a = animObj.params.a, b = animObj.params.b;
        var xMin = Math.min(a,b) - 1, xMax = Math.max(a,b) + 1;
        var yMin = Infinity, yMax = -Infinity;
        var steps = 300;
        for (var i = 0; i <= steps; i++) {
          var x = xMin + (xMax-xMin)*i/steps;
          var y = evalFunc(func, x);
          if (y !== null && isFinite(y)) {
            if (y < yMin) yMin = y;
            if (y > yMax) yMax = y;
          }
        }
        if (!isFinite(yMin) || !isFinite(yMax)) { yMin = -1; yMax = 1; }
        var yRange = yMax - yMin || 1;
        yMin = Math.min(0, yMin) - yRange*0.15;
        yMax = yMax + yRange*0.15;
        var sc = drawAxes(xMin, xMax, yMin, yMax);

        // 积分阴影
        ctx2d.fillStyle = "rgba(37,99,235,0.25)";
        ctx2d.beginPath();
        ctx2d.moveTo(sc.x(a), sc.y(0));
        for (var i = 0; i <= steps; i++) {
          var x = a + (b-a)*i/steps;
          var y = evalFunc(func, x);
          if (y === null) y = 0;
          ctx2d.lineTo(sc.x(x), sc.y(y));
        }
        ctx2d.lineTo(sc.x(b), sc.y(0));
        ctx2d.closePath();
        ctx2d.fill();

        // 函数曲线
        ctx2d.strokeStyle = "#2563eb"; ctx2d.lineWidth = 2.5;
        ctx2d.beginPath();
        var started = false;
        for (var i = 0; i <= steps; i++) {
          var x = xMin + (xMax-xMin)*i/steps;
          var y = evalFunc(func, x);
          if (y === null || !isFinite(y)) { started = false; continue; }
          var px = sc.x(x), py = sc.y(y);
          if (!started) { ctx2d.moveTo(px, py); started = true; }
          else ctx2d.lineTo(px, py);
        }
        ctx2d.stroke();

        ctx2d.fillStyle = "#b91c1c"; ctx2d.font = "13px sans-serif";
        ctx2d.fillText("a=" + a, sc.x(a)-8, sc.y(0)+18);
        ctx2d.fillText("b=" + b, sc.x(b)-8, sc.y(0)+18);

      } else if (type === "circle") {
        var r = animObj.params.radius || 2;
        var lim = r * 1.5;
        var sc = drawAxes(-lim, lim, -lim, lim);
        ctx2d.strokeStyle = "#2563eb"; ctx2d.lineWidth = 2.5;
        ctx2d.beginPath();
        ctx2d.arc(sc.x(0), sc.y(0), r * plotW/(2*lim), 0, Math.PI*2);
        ctx2d.stroke();
        ctx2d.fillStyle = "#2563eb"; ctx2d.font = "14px sans-serif";
        ctx2d.fillText("r = " + r, sc.x(r)+5, sc.y(0));

      } else if (type === "ellipse") {
        var a = animObj.params.a || 3, b = animObj.params.b || 2;
        var lim = Math.max(a,b) * 1.5;
        var sc = drawAxes(-lim, lim, -lim, lim);
        ctx2d.strokeStyle = "#2563eb"; ctx2d.lineWidth = 2.5;
        ctx2d.beginPath();
        ctx2d.ellipse(sc.x(0), sc.y(0), a*plotW/(2*lim), b*plotH/(2*lim), 0, 0, Math.PI*2);
        ctx2d.stroke();
        ctx2d.fillStyle = "#2563eb"; ctx2d.font = "14px sans-serif";
        ctx2d.fillText("a = " + a + ", b = " + b, sc.x(a)+5, sc.y(0));

      } else if (type === "triangle") {
        var p1 = animObj.p1 || [0,0], p2 = animObj.p2 || [4,0], p3 = animObj.p3 || [2,3];
        var xs = [p1[0], p2[0], p3[0]], ys = [p1[1], p2[1], p3[1]];
        var xMin = Math.min.apply(null, xs)-1, xMax = Math.max.apply(null, xs)+1;
        var yMin = Math.min.apply(null, ys)-1, yMax = Math.max.apply(null, ys)+1;
        var sc = drawAxes(xMin, xMax, yMin, yMax);
        ctx2d.strokeStyle = "#2563eb"; ctx2d.lineWidth = 2.5;
        ctx2d.fillStyle = "rgba(37,99,235,0.15)";
        ctx2d.beginPath();
        ctx2d.moveTo(sc.x(p1[0]), sc.y(p1[1]));
        ctx2d.lineTo(sc.x(p2[0]), sc.y(p2[1]));
        ctx2d.lineTo(sc.x(p3[0]), sc.y(p3[1]));
        ctx2d.closePath();
        ctx2d.fill();
        ctx2d.stroke();

      } else {
        drawAxes(-5, 5, -5, 5);
      }
    }

    draw();
    if (animObj.params) buildParams(animObj.params, draw);
  }

  function screenshot() {
    var dom = null;
    if (renderMode === "3d" && threeRenderer) dom = threeRenderer.domElement;
    else if (renderMode === "2d" && canvas2d) dom = canvas2d;
    if (!dom) { showBanner("暂无画布可截图", true); return; }
    var a = document.createElement("a");
    a.href = dom.toDataURL("image/png");
    a.download = "canvas-screenshot.png";
    a.click();
  }

  function startRec() {
    if (isRecording) return;
    var dom = null;
    if (renderMode === "3d" && threeRenderer) dom = threeRenderer.domElement;
    else if (renderMode === "2d" && canvas2d) dom = canvas2d;
    if (!dom) { showBanner("暂无画布可录制", true); return; }
    try {
      var stream = dom.captureStream(30);
      mediaRecorder = new MediaRecorder(stream, {mimeType:"video/webm"});
      recordedChunks = [];
      mediaRecorder.ondataavailable = function(e) { if (e.data.size>0) recordedChunks.push(e.data); };
      mediaRecorder.onstop = function() {
        var blob = new Blob(recordedChunks, {type:"video/webm"});
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url; a.download = "canvas-record.webm"; a.click();
        URL.revokeObjectURL(url);
      };
      mediaRecorder.start();
      isRecording = true;
      el.btnRecordStart.classList.add("hidden");
      el.btnRecordStop.classList.remove("hidden");
      el.recordStatus.classList.remove("hidden");
    } catch(e) { showBanner("录制失败:" + e.message, true); }
  }

  function handleResult(data) {
    console.log("后端完整返回:", data);
    if (!data || data.ok !== true) { showBanner(data.error || "大模型调用失败", true); return; }
    renderResult(data);
  }

  function renderResult(data) {
    currentGeo = data.geo || null;
    var hasGeo = !!currentGeo;
    var hasAnim = !!(data.threejs_anim && data.threejs_anim.type);
    var show = hasGeo || hasAnim;
    el.threejsPanel.classList.toggle("hidden", !show);
    el.resultArea.classList.toggle("has-canvas", show);
    if (hasGeo) { renderMode = "3d"; init3D(currentGeo); }
    else if (hasAnim) { renderMode = "2d"; init2D(data.threejs_anim); }
    else { renderMode = null; destroyThree(); destroy2d(); clearParamPanel(); }

    var text = (data.analysis || "").trim();
    if (text) {
      el.textPanel.classList.remove("hidden");
      el.analysisText.textContent = text;
      el.metaLine.textContent = data.hit_kb ? "命中知识库" : "大模型生成";
      hideBanner();
    } else {
      showBanner("返回空分析结果,请重试", true);
    }
  }

  function pickFile(file) {
    if (!file) return;
    if (file.size > 10*1024*1024) { showBanner("图片超过10MB", true); return; }
    selectedFile = file;
    el.imagePreview.src = URL.createObjectURL(file);
    el.imageName.textContent = file.name;
    el.dzEmpty.classList.add("hidden");
    el.dzPreview.classList.remove("hidden");
    el.ocrBtn.disabled = busy;
  }

  function removeImg() {
    selectedFile = null;
    el.dzEmpty.classList.remove("hidden");
    el.dzPreview.classList.add("hidden");
    el.ocrBtn.disabled = true;
  }

  function clearAll() {
    el.input.value = "";
    hideBanner();
    el.textPanel.classList.add("hidden");
    el.analysisText.textContent = "";
    el.threejsPanel.classList.add("hidden");
    el.resultArea.classList.remove("has-canvas");
    lastOcrText = null; ocrInSession = false;
    removeImg();
    stopRecord();
    destroyThree(); destroy2d(); clearParamPanel();
    renderMode = null; currentGeo = null;
  }

  function resetSession() {
    if (!confirm("确定清空当前会话?")) return;
    setBusy(true); setStatus("清空中…", true);
    fetch(API_BASE + "/api/session/" + encodeURIComponent(getOrCreateSessionId()), {method:"DELETE"})
      .then(function() { clearAll(); setStatus("已清空"); })
      .catch(function() { clearAll(); setStatus("已清空(后端未连接)"); })
      .finally(function() { setBusy(false); el.input.focus(); });
  }

  function bind() {
    el.submitBtn.addEventListener("click", run);
    el.resetBtn.addEventListener("click", resetSession);
    el.ocrBtn.addEventListener("click", function(){ if(selectedFile) uploadAndRun(getOrCreateSessionId()); });
    el.btnScreenshot.addEventListener("click", screenshot);
    el.btnRecordStart.addEventListener("click", startRec);
    el.btnRecordStop.addEventListener("click", stopRecord);
    el.input.addEventListener("keydown", function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(); }
    });
    el.input.addEventListener("input", function() {
      if (el.input.value !== lastOcrText) ocrInSession = false;
    });
    el.dropzone.addEventListener("click", function() { el.imageInput.click(); });
    el.imageInput.addEventListener("change", function() { pickFile(el.imageInput.files[0]); });
    el.removeImageBtn.addEventListener("click", function(e) { e.stopPropagation(); removeImg(); });
    el.dropzone.addEventListener("dragover", function(e) { e.preventDefault(); el.dropzone.classList.add("dragover"); });
    el.dropzone.addEventListener("dragleave", function(e) { e.preventDefault(); el.dropzone.classList.remove("dragover"); });
    el.dropzone.addEventListener("drop", function(e) {
      e.preventDefault(); el.dropzone.classList.remove("dragover");
      var f = e.dataTransfer.files[0]; if (f) pickFile(f);
    });
  }

  function init() { bind(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();


