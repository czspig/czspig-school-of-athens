(() => {
  const W = 1536, H = 1024;
  const $ = (s) => document.querySelector(s);
  const ASSETS = window.ASSETS || { sketches: [], raphael: false };
  const FIG = window.FIGURES, PLACES = window.PLACES, LINKS = window.LINKS;
  const byId = Object.fromEntries([...FIG, ...PLACES].map((f) => [f.id, f]));
  const SVGNS = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs = {}) => {
    const el = document.createElementNS(SVGNS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  };
  const isMobile = () => innerWidth <= 760;

  const vp = $("#viewport"), layer = $("#layer"), layer2 = $("#layer2");
  const painting = $("#painting");

  // 先显示小图，大图加载好后替换
  const full = new Image();
  full.onload = () => { painting.src = full.src; };
  full.src = "assets/athens.webp";

  /* ───────── 相机：平移与缩放 ───────── */
  const cam = { s: 1, x: 0, y: 0 };
  let anim = null;
  const fitScale = () => Math.min(innerWidth / W, innerHeight / H);
  const minS = () => fitScale() * 0.92;
  const maxS = () => Math.max(fitScale() * 7, 3);

  function clamp() {
    cam.s = Math.min(maxS(), Math.max(minS(), cam.s));
    const w = W * cam.s, h = H * cam.s;
    cam.x = w <= innerWidth ? (innerWidth - w) / 2 : Math.min(0, Math.max(innerWidth - w, cam.x));
    cam.y = h <= innerHeight ? (innerHeight - h) / 2 : Math.min(0, Math.max(innerHeight - h, cam.y));
  }
  function apply() {
    clamp();
    const t = `translate(${cam.x}px, ${cam.y}px) scale(${cam.s})`;
    layer.style.transform = t;
    layer2.style.transform = t;
    hideTip();
  }
  function zoomAt(px, py, factor) {
    stopAnim();
    const s = Math.min(maxS(), Math.max(minS(), cam.s * factor));
    cam.x = px - ((px - cam.x) * s) / cam.s;
    cam.y = py - ((py - cam.y) * s) / cam.s;
    cam.s = s;
    apply();
  }
  function stopAnim() { if (anim) cancelAnimationFrame(anim), (anim = null); }
  // 把画面坐标 (ix, iy) 以缩放 s 移到屏幕 (sx, sy)
  function flyTo(ix, iy, s, dur = 900, sx, sy) {
    stopAnim();
    sx ??= viewCenter().x; sy ??= viewCenter().y;
    const from = { ...cam };
    const to = { s, x: sx - ix * s, y: sy - iy * s };
    const t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur), e = ease(t);
      // 缩放用对数插值更自然
      cam.s = Math.exp(Math.log(from.s) + (Math.log(to.s) - Math.log(from.s)) * e);
      cam.x = from.x + (to.x - from.x) * e;
      cam.y = from.y + (to.y - from.y) * e;
      apply();
      anim = t < 1 ? requestAnimationFrame(step) : null;
    };
    anim = requestAnimationFrame(step);
  }
  function fit(dur = 900) { flyTo(W / 2, H / 2, fitScale(), dur, innerWidth / 2, innerHeight / 2); }
  function viewCenter() {
    if (!$("#card").hidden && !isMobile()) return { x: (innerWidth - 400) / 2, y: innerHeight / 2 };
    if (!$("#card").hidden && isMobile()) return { x: innerWidth / 2, y: innerHeight * 0.24 };
    return { x: innerWidth / 2, y: innerHeight / 2 };
  }

  // 指针：单指拖动、双指捏合、滚轮缩放
  const pts = new Map();
  let drag = null, moved = false;
  vp.addEventListener("pointerdown", (e) => {
    if (e.target.closest("#divider")) return;
    stopAnim();
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      drag.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: cam.s, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cx: cam.x, cy: cam.y };
    }
  });
  vp.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId) || !drag) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && drag.pinch) {
      const [a, b] = [...pts.values()], p = drag.pinch;
      const s = Math.min(maxS(), Math.max(minS(), (p.s * Math.hypot(a.x - b.x, a.y - b.y)) / p.d));
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      cam.x = mx - ((p.mx - p.cx) * s) / p.s;
      cam.y = my - ((p.my - p.cy) * s) / p.s;
      cam.s = s;
      moved = true;
      apply();
    } else if (pts.size === 1) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      // 真正开始拖动才捕获指针，否则点击人物的 click 会被吞掉
      if (!moved && Math.abs(dx) + Math.abs(dy) > 4) { moved = true; vp.setPointerCapture(e.pointerId); }
      if (moved) {
        vp.classList.add("dragging");
        cam.x = drag.cx + dx; cam.y = drag.cy + dy;
        apply();
      }
    }
  });
  const up = (e) => {
    pts.delete(e.pointerId);
    vp.classList.remove("dragging");
    if (pts.size === 1) {
      const [p] = pts.values();
      drag = { x: p.x, y: p.y, cx: cam.x, cy: cam.y };
    } else if (!pts.size) drag = null;
  };
  vp.addEventListener("pointerup", up);
  vp.addEventListener("pointercancel", up);
  vp.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  vp.addEventListener("dblclick", (e) => { if (!e.target.closest(".spot")) zoomAt(e.clientX, e.clientY, 2); });
  $("#zin").onclick = () => zoomAt(innerWidth / 2, innerHeight / 2, 1.5);
  $("#zout").onclick = () => zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.5);
  $("#zfit").onclick = () => fit();
  $("#labels").onclick = () => document.body.classList.toggle("show-labels");
  addEventListener("resize", apply);

  /* ───────── 热区 ───────── */
  const spotEls = {};
  const tip = $("#tip");
  function showTip(f, el) {
    const r = el.getBoundingClientRect();
    tip.innerHTML = `${f.zh}<small>${f.en}</small>`;
    tip.style.left = r.left + r.width / 2 + "px";
    tip.style.top = r.top + "px";
    tip.hidden = false;
  }
  function hideTip() { tip.hidden = true; }

  for (const f of [...FIG, ...PLACES]) {
    const isPlace = !!byId[f.id].text;
    const g = svg("g", { class: "spot" + (isPlace ? " place" : ""), "data-id": f.id });
    const ringR = isPlace ? f.r : f.r * 1.25;
    g.append(svg("circle", { class: "hit", cx: f.x, cy: f.y, r: isPlace ? f.r : f.r * 1.7 }));
    g.append(svg("circle", { class: "ring", cx: f.x, cy: f.y, r: ringR }));
    g.addEventListener("pointerenter", () => showTip(f, g.querySelector(".ring")));
    g.addEventListener("pointerleave", hideTip);
    g.addEventListener("click", () => { if (!moved) open(f.id); });
    $("#spots").append(g);
    spotEls[f.id] = g;
  }

  /* ───────── 关系线 ───────── */
  const linkEls = [];
  for (const [a, b, label] of LINKS) {
    const A = byId[a], B = byId[b];
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, d = Math.hypot(B.x - A.x, B.y - A.y);
    const bend = Math.min(60, d * 0.18);
    // 控制点沿垂线偏移，并统一向上拱，避免连线贴着人物
    const sgn = B.x - A.x >= 0 ? 1 : -1;
    const cx = mx + ((B.y - A.y) / d) * bend * sgn, cy = my - ((B.x - A.x) / d) * bend * sgn;
    const dAttr = `M${A.x},${A.y} Q${cx},${cy} ${B.x},${B.y}`;
    const line = svg("path", { d: dAttr });
    const hit = svg("path", { d: dAttr, class: "hit" });
    hit.addEventListener("pointerenter", (e) => {
      tip.innerHTML = `${A.zh} — ${B.zh}<small>${label}</small>`;
      tip.style.left = e.clientX + "px"; tip.style.top = e.clientY + "px"; tip.hidden = false;
    });
    hit.addEventListener("pointerleave", hideTip);
    $("#links").append(line, hit);
    linkEls.push({ a, b, line });
  }
  for (const id of new Set(LINKS.flat().filter((x) => byId[x]))) {
    const f = byId[id];
    $("#links").append(svg("circle", { cx: f.x, cy: f.y, r: 3 }));
  }
  function highlightLinks(id) {
    $("#links").classList.toggle("focus", !!id);
    for (const l of linkEls) l.line.classList.toggle("hl", !!id && (l.a === id || l.b === id));
  }

  /* ───────── 人物卡 ───────── */
  const card = $("#card"), body = $("#cardBody");
  const order = [...FIG.map((f) => f.id), ...PLACES.map((p) => p.id)];
  let current = null;

  function faceCanvas(f) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    c.className = "face";
    const ctx = c.getContext("2d");
    const draw = (im) => {
      const k = im.naturalWidth / W, sd = f.r * 4.2 * k;
      ctx.drawImage(im, f.x * k - sd / 2, (f.y + f.r * 0.5) * k - sd / 2, sd, sd, 0, 0, 256, 256);
    };
    // 大图没到就先用小图画，大图到了再重画
    if (full.complete && full.naturalWidth) draw(full);
    else { draw(painting); full.addEventListener("load", () => draw(full), { once: true }); }
    return c;
  }

  function open(id) {
    const f = byId[id];
    if (!f) return;
    current = id;
    for (const g of Object.values(spotEls)) g.classList.remove("on", "lit");
    spotEls[id]?.classList.add("on");
    body.innerHTML = "";
    if (f.text) {
      body.innerHTML = `<div class="who"><h2>${f.zh}</h2><div class="en">${f.en}</div></div>
        <p class="why" style="margin-top:18px">${f.text}</p>
        ${f.link ? `<a class="go" href="${f.link}" target="_blank" rel="noopener">穿过拱门 · 时间胶囊 →</a>` : ""}`;
    } else {
      const rel = LINKS.filter(([a, b]) => a === id || b === id).map(([a, b, l]) => [a === id ? b : a, l]);
      const sk = f.sketch && ASSETS.sketches.includes(f.sketch) ? window.SKETCHES[f.sketch] : null;
      body.append(faceCanvas(f));
      body.insertAdjacentHTML("beforeend", `
        <div class="who"><h2>${f.zh}</h2><div class="en">${f.en}</div>${f.years ? `<div class="yrs">${f.years}</div>` : ""}</div>
        <div class="slot">站在 <b>${f.slot}</b> 的位置<span>${f.slotNote}</span></div>
        <p class="why">${f.why}</p>
        <ul class="keys">${f.keys.map(([y, t]) => `<li><b>${y < 1000 ? "约 " + y : y}</b><span>${t}</span></li>`).join("")}</ul>
        ${f.transformer ? `<div class="sub">TRANSFORMER 八位作者</div><p class="note">${window.TRANSFORMER_AUTHORS}。画中出场三位，已一起亮起。</p>` : ""}
        ${rel.length ? `<div class="sub">画中的关系</div><div class="chips">${rel.map(([o, l]) => `<button class="chip" data-go="${o}">${byId[o].zh} <small>· ${l}</small></button>`).join("")}</div>` : ""}
        ${sk ? `<div class="sub">预备素描</div><button class="sketch-btn" data-sketch="${f.sketch}"><img src="assets/sketches/sketch-${f.sketch}.webp" alt=""><span>素描 · ${sk.title}</span></button>` : ""}`);
      if (f.transformer) FIG.filter((x) => x.transformer).forEach((x) => spotEls[x.id].classList.add("lit"));
    }
    card.hidden = false;
    body.scrollTop = 0;
    highlightLinks(id);
    hideTip();
    const s = Math.max(cam.s, fitScale() * (f.text ? 2 : 3.2));
    flyTo(f.x, f.y, Math.min(s, maxS()), 900);
  }
  function close() {
    card.hidden = true;
    current = null;
    for (const g of Object.values(spotEls)) g.classList.remove("on", "lit");
    highlightLinks(null);
  }
  body.addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]");
    if (go) return open(go.dataset.go);
    const sk = e.target.closest("[data-sketch]");
    if (sk) {
      const k = sk.dataset.sketch;
      $("#lbImg").src = `assets/sketches/sketch-${k}.webp`;
      $("#lbCap").textContent = `预备素描 · ${window.SKETCHES[k].title}`;
      $("#lightbox").hidden = false;
    }
  });
  $("#lightbox").onclick = () => ($("#lightbox").hidden = true);
  $("#cardClose").onclick = close;
  const stepCard = (d) => current && open(order[(order.indexOf(current) + d + order.length) % order.length]);
  $("#prev").onclick = () => stepCard(-1);
  $("#next").onclick = () => stepCard(1);

  /* ───────── 名录 ───────── */
  const GROUPS = [
    ["中央 · 两种手势", ["hinton", "lecun", "mccarthy", "bengio", "dario", "rosenblatt", "feifei", "sutton", "kaiming"]],
    ["左上 · 对话与进门者", ["turing", "musk", "yaoqizhi", "yaoshunyu", "polosukhin", "liangwenfeng", "yangzhilin", "zhangyiming"]],
    ["左下 · 比特的源头", ["shannon", "boole", "leibniz", "khwarizmi", "lovelace", "hassabis", "andrewng"]],
    ["台阶", ["ilya", "weizenbaum", "marcus"]],
    ["右下 · 注意力", ["vonneumann", "shazeer", "vaswani", "karpathy"]],
    ["右侧 · 建造者", ["altman", "nadella", "jensen", "brockman", "pichai", "zuckerberg", "robinli"]],
    ["两位画家", ["ai", "me"]],
    ["画中之物", ["talos", "pandora", "arch"]],
  ];
  $("#indexBody").innerHTML = GROUPS.map(([t, ids]) => `<div class="group"><h4>${t}</h4><div class="chips">${ids.map((i) => `<button class="chip" data-go="${i}">${byId[i].zh}</button>`).join("")}</div></div>`).join("");
  $("#indexBody").addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]");
    if (go) { closePanels(); open(go.dataset.go); }
  });

  /* ───────── 模式 ───────── */
  let mode = "explore";
  function setMode(m) {
    if (m === mode) m = "explore";
    mode = m;
    document.body.className = document.body.className.replace(/\bmode-\S+/g, "").trim() + " mode-" + m;
    document.querySelectorAll("#modes [data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
    $("#timeline").hidden = m !== "timeline";
    const cmp = m === "compare";
    $("#compare").hidden = $("#divider").hidden = $("#tagAI").hidden = !cmp;
    $("#spots").style.display = cmp ? "none" : "";
    if (cmp) startCompare();
    if (m === "timeline") { if (!card.hidden) close(); setYear(+$("#tlRange").value); fit(); } else stopPlay();
    if (m === "links") fit();
    hideTip();
  }
  document.querySelectorAll("#modes [data-mode]").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  document.querySelectorAll("#modes [data-panel]").forEach((b) => (b.onclick = () => { closePanels(); $("#" + b.dataset.panel).hidden = false; }));
  function closePanels() { document.querySelectorAll(".panel").forEach((p) => (p.hidden = true)); }
  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closePanels));

  /* ───────── 原作对照 ───────── */
  let split = 0.5;
  function startCompare() {
    const r = $("#raphael");
    if (!r.src) r.src = "assets/raphael.webp";
    setSplit(split);
  }
  function setSplit(v) {
    split = Math.min(0.98, Math.max(0.02, v));
    const x = split * innerWidth;
    $("#compare").style.clipPath = `inset(0 ${innerWidth - x}px 0 0)`;
    $("#divider").style.left = x + "px";
  }
  $("#divider").addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    $("#divider").setPointerCapture(e.pointerId);
    const mv = (ev) => setSplit(ev.clientX / innerWidth);
    const end = () => { $("#divider").removeEventListener("pointermove", mv); $("#divider").removeEventListener("pointerup", end); };
    $("#divider").addEventListener("pointermove", mv);
    $("#divider").addEventListener("pointerup", end);
  });
  addEventListener("resize", () => mode === "compare" && setSplit(split));

  /* ───────── 时间轴 ───────── */
  const years = [...new Set(FIG.map((f) => f.tl))].sort((a, b) => a - b);
  const range = $("#tlRange");
  range.max = years.length - 1;
  const holes = {};
  for (const f of FIG) {
    const c = svg("circle", { cx: f.x, cy: f.y + f.r * 0.8, r: 0, fill: "url(#hole)" });
    $("#holes").append(c);
    holes[f.id] = c;
  }
  const keyFor = (f) => (f.keys.find(([y]) => y === f.tl) || f.keys[0])[1];
  function setYear(i) {
    const y = years[i];
    range.value = i;
    $("#tlYear").textContent = y < 1000 ? "约 " + y : y;
    const now = FIG.filter((f) => f.tl === y);
    $("#tlText").textContent = y === 2026 ? "画家还没有画完自己。" : now.map((f) => `${f.zh}：${keyFor(f)}`).join("；");
    for (const f of FIG) {
      const shown = f.tl <= y;
      holes[f.id].setAttribute("r", shown ? f.r * 3.4 : 0);
      spotEls[f.id].classList.toggle("hidden-tl", !shown);
      spotEls[f.id].classList.toggle("new", f.tl === y);
    }
  }
  range.addEventListener("input", () => { stopPlay(); setYear(+range.value); });
  let timer = null;
  function stopPlay() { clearInterval(timer); timer = null; $("#play").textContent = "▶"; }
  $("#play").onclick = () => {
    if (timer) return stopPlay();
    if (+range.value >= years.length - 1) setYear(0);
    $("#play").textContent = "❚❚";
    timer = setInterval(() => {
      const i = +range.value + 1;
      if (i >= years.length) return stopPlay();
      setYear(i);
    }, 1700);
  };

  /* ───────── 键盘 ───────── */
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("#lightbox").hidden) return ($("#lightbox").hidden = true);
      if (document.querySelector(".panel:not([hidden])")) return closePanels();
      if (!card.hidden) return close();
      if (mode !== "explore") setMode("explore");
    }
    if (!card.hidden && e.key === "ArrowRight") stepCard(1);
    if (!card.hidden && e.key === "ArrowLeft") stepCard(-1);
  });

  /* ───────── 开场 ───────── */
  const caption = $("#caption");
  cam.s = fitScale();
  apply();
  setMode("explore");
  // 链接直达：#turing 打开人物卡，#links / #timeline / #compare 进入对应模式
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash && (byId[hash] || ["links", "timeline", "compare"].includes(hash))) {
    $("#intro").hidden = true;
    if (byId[hash]) setTimeout(() => open(hash), 50); else setMode(hash);
  }
  $("#enter").onclick = () => {
    $("#intro").classList.add("out");
    setTimeout(() => ($("#intro").hidden = true), 1300);
    const hands = byId.hinton, hands2 = byId.lecun;
    flyTo((hands.x + hands2.x) / 2, 560, fitScale() * 2.6, 2600);
    setTimeout(() => { caption.textContent = "两种手势，争论了七十年。"; caption.classList.add("on"); }, 1400);
    setTimeout(() => { caption.classList.remove("on"); fit(2200); }, 4600);
    setTimeout(() => {
      caption.textContent = "点击人物 · 滚轮或双指缩放 · 拖动平移";
      caption.classList.add("on");
      setTimeout(() => caption.classList.remove("on"), 3200);
    }, 7000);
  };
})();
