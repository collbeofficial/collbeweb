(() => {
  "use strict";
  const DATA = window.CB_DATA;
  const pages = [...document.querySelectorAll(".page")];
  const routeLinks = [...document.querySelectorAll("[data-route]")];
  let currentRoute = "intro";
  let currentProjectId = 1;
  let currentMemberIndex = 0;

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrapIndex = (n, len) => ((n % len) + len) % len;

  function activatePage(name) {
    pages.forEach(p => p.classList.toggle("is-active", p.dataset.page === name));
    currentRoute = name;
    if (name !== "intro") document.getElementById("introVideo")?.pause();
    if (name === "main") startMorph(); else stopMorph();
  }

  function navigate(route, push = true) {
    if (route === "intro") {
      activatePage("intro");
      document.getElementById("introVideo")?.play().catch(() => {});
      if (push) history.pushState(null, "", "#intro");
      return;
    }

    if (route === "main") {
      activatePage("main");
      if (push) history.pushState(null, "", "#main");
    } else if (route === "works") {
      activatePage("works");
      renderWorks();
      if (push) history.pushState(null, "", "#works");
    } else if (route === "magazine") {
      activatePage("magazine");
      renderMagazines();
      if (push) history.pushState(null, "", "#magazine");
    } else if (route === "about") {
      activatePage("about");
      if (push) history.pushState(null, "", "#about");
    } else if (route.startsWith("project-")) {
      currentProjectId = Number(route.split("-")[1]) || 1;
      const project = DATA.projects.find(p => p.id === currentProjectId);
      if (!project || project.locked) return navigate("works", push);
      activatePage("project");
      renderProject(project);
      if (push) history.pushState(null, "", `#project-${currentProjectId}`);
    } else if (route.startsWith("member/")) {
      const [, pRaw, memberRaw] = route.split("/");
      currentProjectId = Number(pRaw) || 1;
      currentMemberIndex = Number(memberRaw) || 0;
      activatePage("member");
      renderMember(currentProjectId, currentMemberIndex);
      if (push) history.pushState(null, "", `#member/${currentProjectId}/${currentMemberIndex}`);
    }
    window.scrollTo(0, 0);
  }

  function routeFromHash() {
    const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (!hash) return "intro";
    return hash;
  }

  routeLinks.forEach(el => {
    el.addEventListener("click", e => {
      const route = el.dataset.route;
      if (!route) return;
      e.preventDefault();
      navigate(route);
    });
  });

  document.getElementById("introEnter").addEventListener("click", () => navigate("main"));
  window.addEventListener("popstate", () => navigate(routeFromHash(), false));

  /* ---------------- MAIN MORPH CANVAS ---------------- */
  // IMPORTANT: the site is often opened directly with file:// in Safari.
  // Reading pixels from an imported PNG after drawing it to canvas can taint
  // the canvas under file://, so the logo silhouette is pre-sampled in
  // logo-points.js instead of being read at runtime.
  const morph = {
    canvas: document.getElementById("morphCanvas"),
    ctx: null,
    particles: [],
    textTargets: [],
    logoTargets: [],
    scatterTargets: [],
    raf: 0,
    running: false,
    width: 0,
    height: 0,
    dpr: 1,
    resizeTimer: null,
    startedAt: 0
  };

  function seededShuffle(arr) {
    let seed = 11731;
    for (let i = arr.length - 1; i > 0; i--) {
      seed = (seed * 9301 + 49297) % 233280;
      const j = Math.floor((seed / 233280) * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function sampleCanvasMask(drawFn, count, bounds) {
    const c = document.createElement("canvas");
    c.width = Math.max(2, Math.round(bounds.w));
    c.height = Math.max(2, Math.round(bounds.h));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, c.width, c.height);
    drawFn(ctx, c);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const points = [];
    const step = bounds.step || 5;
    for (let y = 0; y < c.height; y += step) {
      for (let x = 0; x < c.width; x += step) {
        const a = img.data[(y * c.width + x) * 4 + 3];
        if (a > 70) points.push({ x, y });
      }
    }
    seededShuffle(points);
    if (!points.length) return Array.from({ length: count }, () => ({ x: c.width / 2, y: c.height / 2 }));
    const sampled = [];
    const stride = Math.max(1, Math.floor(points.length / count));
    for (let i = 0; i < count; i++) sampled.push(points[(i * stride) % points.length]);
    return sampled;
  }

  function buildMorphTargets() {
    if (!morph.ctx || morph.width < 2 || morph.height < 2) return;
    const w = morph.width;
    const h = morph.height;
    const particleCount = w < 700 ? 360 : 700;
    const textRaw = window.CB_MAIN_TEXT_POINTS || [];
    morph.textTargets = Array.from({ length: particleCount }, (_, i) => {
      const pt = textRaw.length ? textRaw[i % textRaw.length] : [.5, .5];
      return { x: pt[0] * w, y: pt[1] * h };
    });

    const raw = window.CB_MAIN_LOGO_POINTS || [];
    const box = Math.min(w * .38, h * .56, 500);
    const left = w / 2 - box / 2;
    const top = h / 2 - box / 2;
    morph.logoTargets = Array.from({ length: particleCount }, (_, i) => {
      const pt = raw.length ? raw[i % raw.length] : [.5, .5];
      return { x: left + pt[0] * box, y: top + pt[1] * box };
    });

    morph.scatterTargets = Array.from({ length: particleCount }, (_, i) => {
      const angle = i * 2.399963229728653;
      const r = (0.10 + Math.sqrt((i + 1) / particleCount) * .48) * Math.min(w, h);
      return {
        x: w / 2 + Math.cos(angle) * r * 1.28,
        y: h / 2 + Math.sin(angle) * r * .82
      };
    });

    const chars = ("collectivebehavior".repeat(60)).split("");
    if (morph.particles.length !== particleCount) {
      morph.particles = Array.from({ length: particleCount }, (_, i) => {
        const t = morph.textTargets[i] || { x: w / 2, y: h / 2 };
        return {
          x: t.x + (Math.random() - .5) * 6,
          y: t.y + (Math.random() - .5) * 6,
          vx: 0,
          vy: 0,
          char: chars[i % chars.length],
          size: w < 700 ? 10 + Math.random() * 6 : 11 + Math.random() * 10,
          alpha: .46 + Math.random() * .48
        };
      });
    }
  }

  function resizeMorph() {
    const rect = morph.canvas.getBoundingClientRect();
    morph.dpr = Math.min(window.devicePixelRatio || 1, 2);
    morph.width = Math.max(1, rect.width || window.innerWidth);
    morph.height = Math.max(1, rect.height || window.innerHeight);
    morph.canvas.width = Math.round(morph.width * morph.dpr);
    morph.canvas.height = Math.round(morph.height * morph.dpr);
    morph.ctx = morph.canvas.getContext("2d");
    morph.ctx.setTransform(morph.dpr, 0, 0, morph.dpr, 0, 0);
    buildMorphTargets();
  }

  function easeInOut(t) { return t < .5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2; }

  function getMorphTarget(i, elapsed) {
    const cycle = 14200;
    const t = elapsed % cycle;
    const text = morph.textTargets[i] || { x: morph.width / 2, y: morph.height / 2 };
    const logo = morph.logoTargets[i] || text;
    const scatter = morph.scatterTargets[i] || text;

    let from, to, k;
    if (t < 2600) return text;
    if (t < 3900) {
      k = easeInOut((t - 2600) / 1300); from = text; to = scatter;
    } else if (t < 6000) {
      k = easeInOut((t - 3900) / 2100); from = scatter; to = logo;
    } else if (t < 9000) {
      const angle = ((t - 6000) / 3000) * Math.PI * 2;
      const dx = logo.x - morph.width / 2;
      const dy = logo.y - morph.height / 2;
      return {
        x: morph.width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle),
        y: morph.height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle)
      };
    } else if (t < 10300) {
      k = easeInOut((t - 9000) / 1300); from = logo; to = scatter;
    } else if (t < 12600) {
      k = easeInOut((t - 10300) / 2300); from = scatter; to = text;
    } else return text;
    return { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k) };
  }

  function morphFrame(now) {
    if (!morph.running) return;
    const ctx = morph.ctx;
    if (!ctx) { morph.raf = requestAnimationFrame(morphFrame); return; }
    const elapsed = now - morph.startedAt;
    ctx.clearRect(0, 0, morph.width, morph.height);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, morph.width, morph.height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (let i = 0; i < morph.particles.length; i++) {
      const p = morph.particles[i];
      const target = getMorphTarget(i, elapsed);
      const ax = (target.x - p.x) * .019;
      const ay = (target.y - p.y) * .019;
      p.vx = (p.vx + ax) * .875;
      p.vy = (p.vy + ay) * .875;
      p.x += p.vx;
      p.y += p.vy;
      const speed = Math.hypot(p.vx, p.vy);
      const size = p.size * clamp(1 - speed * .011, .62, 1.08);
      ctx.globalAlpha = clamp(p.alpha + speed * .006, .28, .96);
      ctx.fillStyle = "#050505";
      ctx.font = `500 ${size}px Pretendard, Arial, sans-serif`;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(clamp(p.vx * .025, -.42, .42));
      ctx.fillText(p.char, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    morph.raf = requestAnimationFrame(morphFrame);
  }

  function startMorph() {
    if (morph.running) return;
    morph.running = true;
    morph.startedAt = performance.now();
    resizeMorph();
    morph.raf = requestAnimationFrame(morphFrame);
    // Rebuild the text mask once Pretendard has finished loading, without
    // blocking the animation if the CDN is slow or unavailable.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (morph.running && currentRoute === "main") buildMorphTargets();
      }).catch(() => {});
    }
  }

  function stopMorph() {
    morph.running = false;
    cancelAnimationFrame(morph.raf);
  }

  window.addEventListener("resize", () => {
    clearTimeout(morph.resizeTimer);
    morph.resizeTimer = setTimeout(() => {
      if (currentRoute === "main") resizeMorph();
      if (currentRoute === "works") layoutWorks();
      if (currentRoute === "magazine") layoutMagazines();
    }, 120);
  });

  /* ---------------- WORKS ORBIT ---------------- */
  const works = {
    root: document.getElementById("worksOrbit"),
    stage: document.getElementById("worksStage"),
    title: document.getElementById("worksTitle"),
    items: [],
    rotation: 0,
    targetRotation: 0,
    pointerX: null,
    raf: 0,
    active: false,
    hoveringLogo: false,
    snapTimer: 0,
    lastInput: performance.now()
  };

  function renderWorks() {
    if (works.items.length) { works.active = true; works.raf = requestAnimationFrame(worksLoop); return; }
    works.root.innerHTML = "";
    DATA.projects.forEach((project, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `orbit-item${project.locked ? " locked" : ""}`;
      btn.dataset.index = String(i);
      btn.setAttribute("aria-label", project.title);
      btn.innerHTML = `<img src="${project.logo}" alt="" draggable="false" />`;
      btn.addEventListener("pointerenter", () => {
        works.hoveringLogo = true;
        focusProject(i);
      });
      btn.addEventListener("pointerleave", () => {
        works.hoveringLogo = false;
        scheduleWorksSnap();
      });
      btn.addEventListener("click", () => {
        // Clicking a visible logo should always be easy: hover focuses it, click opens it.
        focusProject(i);
        if (project.locked) {
          btn.classList.remove("is-shaking");
          void btn.offsetWidth;
          btn.classList.add("is-shaking");
          return;
        }
        navigate(`project-${project.id}`);
      });
      works.root.appendChild(btn);
      works.items.push(btn);
    });
    works.active = true;
    bindWorksInput();
    layoutWorks();
    works.raf = requestAnimationFrame(worksLoop);
  }

  let worksBound = false;
  function scheduleWorksSnap() {
    clearTimeout(works.snapTimer);
    works.snapTimer = window.setTimeout(() => {
      if (currentRoute !== "works" || works.hoveringLogo) return;
      focusProject(getFocusedProjectIndex());
    }, 220);
  }

  function bindWorksInput() {
    if (worksBound) return;
    worksBound = true;
    works.stage.addEventListener("pointermove", e => {
      if (works.hoveringLogo) {
        works.pointerX = e.clientX;
        return;
      }
      if (works.pointerX !== null) {
        const dx = e.clientX - works.pointerX;
        // Much lower sensitivity than v1. Tiny cursor jitter no longer spins the carousel.
        if (Math.abs(dx) > 1.5) {
          works.targetRotation += dx * .00072;
          works.lastInput = performance.now();
          scheduleWorksSnap();
        }
      }
      works.pointerX = e.clientX;
    });
    works.stage.addEventListener("pointerleave", () => {
      works.pointerX = null;
      works.hoveringLogo = false;
      scheduleWorksSnap();
    });
    works.stage.addEventListener("wheel", e => {
      e.preventDefault();
      if (works.hoveringLogo) return;
      works.targetRotation += (e.deltaY + e.deltaX) * .00042;
      works.lastInput = performance.now();
      scheduleWorksSnap();
    }, { passive: false });
  }

  function focusProject(index) {
    const n = DATA.projects.length;
    const step = (Math.PI * 2) / n;
    const base = -index * step;
    let best = base;
    while (best - works.targetRotation > Math.PI) best -= Math.PI * 2;
    while (works.targetRotation - best > Math.PI) best += Math.PI * 2;
    works.targetRotation = best;
    works.lastInput = performance.now();
  }

  function getFocusedProjectIndex() {
    let best = 0, bestScore = Infinity;
    const n = DATA.projects.length;
    const step = (Math.PI * 2) / n;
    for (let i = 0; i < n; i++) {
      const a = works.rotation + i * step;
      const normalized = Math.atan2(Math.sin(a), Math.cos(a));
      const score = Math.abs(normalized);
      if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  function layoutWorks() {
    if (!works.items.length) return;
    const rect = works.stage.getBoundingClientRect();
    const n = works.items.length;
    const step = (Math.PI * 2) / n;
    const rx = Math.min(rect.width * .31, 430);
    const ry = Math.min(rect.height * .22, 170);
    let focused = 0, focusScore = Infinity;

    works.items.forEach((el, i) => {
      const a = works.rotation + i * step;
      const x = Math.sin(a) * rx;
      const y = Math.cos(a) * ry - rect.height * .045;
      const depth = (Math.cos(a) + 1) / 2;
      const scale = .62 + depth * .62;
      const opacity = .28 + depth * .72;
      el.style.setProperty("--x", `${x}px`);
      el.style.setProperty("--y", `${y}px`);
      el.style.setProperty("--scale", scale.toFixed(3));
      el.style.opacity = opacity.toFixed(3);
      el.style.zIndex = String(Math.round(depth * 100));
      const score = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
      if (score < focusScore) { focusScore = score; focused = i; }
    });
    works.items.forEach((el, i) => el.classList.toggle("is-focused", i === focused));
    works.title.textContent = DATA.projects[focused].title;
  }

  function worksLoop() {
    if (!works.active || currentRoute !== "works") return;
    // No unattended auto-spin: the composition stays clickable until the user moves it.
    works.rotation += (works.targetRotation - works.rotation) * .065;
    layoutWorks();
    works.raf = requestAnimationFrame(worksLoop);
  }

  /* ---------------- PROJECT / PUZZLE ---------------- */
  const puzzleWrap = document.getElementById("puzzleWrap");
  const memberHoverLabel = document.getElementById("memberHoverLabel");
  const projectCopy = document.getElementById("projectCopy");

  const PUZZLE_COLS = 4;
  const PUZZLE_ROWS = 2;
  const PUZZLE_SIZE = 400;
  // Shared global edge directions. Adjacent pieces follow the exact same curve,
  // so the cuts read as real interlocking jigsaw seams instead of straight slices.
  const V_EDGE = [
    [ 1, -1,  1],
    [-1,  1, -1]
  ];
  const H_EDGE = [[-1, 1, -1, 1]];

  function hJigsawEdge(x0, x1, y, sign) {
    const dx = x1 - x0;
    const a = x0 + dx * .34;
    const b = x0 + dx * .43;
    const c = x0 + dx * .50;
    const d = x0 + dx * .57;
    const e = x0 + dx * .66;
    const amp = 23 * sign;
    return `L ${a} ${y} C ${b} ${y} ${b} ${y + amp} ${c} ${y + amp} C ${d} ${y + amp} ${d} ${y} ${e} ${y} L ${x1} ${y}`;
  }

  function vJigsawEdge(y0, y1, x, sign) {
    const dy = y1 - y0;
    const a = y0 + dy * .34;
    const b = y0 + dy * .43;
    const c = y0 + dy * .50;
    const d = y0 + dy * .57;
    const e = y0 + dy * .66;
    const amp = 23 * sign;
    return `L ${x} ${a} C ${x} ${b} ${x + amp} ${b} ${x + amp} ${c} C ${x + amp} ${d} ${x} ${d} ${x} ${e} L ${x} ${y1}`;
  }

  function buildJigsawPath(col, row) {
    const cw = PUZZLE_SIZE / PUZZLE_COLS;
    const ch = PUZZLE_SIZE / PUZZLE_ROWS;
    const x0 = col * cw, x1 = (col + 1) * cw;
    const y0 = row * ch, y1 = (row + 1) * ch;
    let d = `M ${x0} ${y0}`;
    // top: left -> right
    d += row === 0 ? ` L ${x1} ${y0}` : ` ${hJigsawEdge(x0, x1, y0, H_EDGE[row - 1][col])}`;
    // right: top -> bottom
    d += col === PUZZLE_COLS - 1 ? ` L ${x1} ${y1}` : ` ${vJigsawEdge(y0, y1, x1, V_EDGE[row][col])}`;
    // bottom: right -> left
    d += row === PUZZLE_ROWS - 1 ? ` L ${x0} ${y1}` : ` ${hJigsawEdge(x1, x0, y1, H_EDGE[row][col])}`;
    // left: bottom -> top
    d += col === 0 ? ` L ${x0} ${y0}` : ` ${vJigsawEdge(y1, y0, x0, V_EDGE[row][col - 1])}`;
    return `${d} Z`;
  }

  const PUZZLE_PATHS = Array.from({ length: DATA.members.length }, (_, i) => {
    const col = i % PUZZLE_COLS;
    const row = Math.floor(i / PUZZLE_COLS);
    return { col, row, d: buildJigsawPath(col, row) };
  });



  const PROJECT_LOGO_COLORS = {
    1: "#ea33f7",
    2: "#441541",
    3: "#8d8d8d"
  };

  const LOGO_GHOSTS = {
    1: "assets/logos/project-1-ghost.png",
    2: "assets/logos/project-2-ghost.png",
    3: "assets/logos/project-3.png"
  };

  const LOGO_MEMBER_PIECES = {
  "1": [
    {
      "x": 34.5,
      "y": 26.0,
      "w": 31.0,
      "h": 16.0,
      "fr": -17,
      "br": "62% 38% 54% 46% / 58% 44% 56% 42%"
    },
    {
      "x": 52.0,
      "y": 20.5,
      "w": 28.0,
      "h": 15.0,
      "fr": -4,
      "br": "52% 48% 60% 40% / 46% 58% 42% 54%"
    },
    {
      "x": 71.5,
      "y": 29.0,
      "w": 22.5,
      "h": 21.0,
      "fr": 11,
      "br": "46% 54% 44% 56% / 58% 42% 62% 38%"
    },
    {
      "x": 24.0,
      "y": 48.5,
      "w": 19.5,
      "h": 31.0,
      "fr": 12,
      "br": "58% 42% 50% 50% / 40% 60% 44% 56%"
    },
    {
      "x": 31.0,
      "y": 67.0,
      "w": 24.0,
      "h": 19.5,
      "fr": -18,
      "br": "60% 40% 52% 48% / 52% 48% 62% 38%"
    },
    {
      "x": 46.5,
      "y": 53.0,
      "w": 13.5,
      "h": 28.5,
      "fr": 10,
      "br": "44% 56% 42% 58% / 62% 38% 52% 48%"
    },
    {
      "x": 64.0,
      "y": 50.5,
      "w": 20.5,
      "h": 17.0,
      "fr": -13,
      "br": "52% 48% 60% 40% / 46% 54% 44% 56%"
    },
    {
      "x": 68.5,
      "y": 72.5,
      "w": 28.5,
      "h": 31.5,
      "fr": -20,
      "br": "44% 56% 64% 36% / 42% 58% 52% 48%"
    }
  ],
  "2": [
    {
      "x": 34.5,
      "y": 26.0,
      "w": 31.0,
      "h": 16.0,
      "fr": -17,
      "br": "62% 38% 54% 46% / 58% 44% 56% 42%"
    },
    {
      "x": 52.0,
      "y": 20.5,
      "w": 28.0,
      "h": 15.0,
      "fr": -4,
      "br": "52% 48% 60% 40% / 46% 58% 42% 54%"
    },
    {
      "x": 71.5,
      "y": 29.0,
      "w": 22.5,
      "h": 21.0,
      "fr": 11,
      "br": "46% 54% 44% 56% / 58% 42% 62% 38%"
    },
    {
      "x": 24.0,
      "y": 48.5,
      "w": 19.5,
      "h": 31.0,
      "fr": 12,
      "br": "58% 42% 50% 50% / 40% 60% 44% 56%"
    },
    {
      "x": 31.0,
      "y": 67.0,
      "w": 24.0,
      "h": 19.5,
      "fr": -18,
      "br": "60% 40% 52% 48% / 52% 48% 62% 38%"
    },
    {
      "x": 46.5,
      "y": 53.0,
      "w": 13.5,
      "h": 28.5,
      "fr": 10,
      "br": "44% 56% 42% 58% / 62% 38% 52% 48%"
    },
    {
      "x": 64.0,
      "y": 50.5,
      "w": 20.5,
      "h": 17.0,
      "fr": -13,
      "br": "52% 48% 60% 40% / 46% 54% 44% 56%"
    },
    {
      "x": 68.5,
      "y": 72.5,
      "w": 28.5,
      "h": 31.5,
      "fr": -20,
      "br": "44% 56% 64% 36% / 42% 58% 52% 48%"
    }
  ]
};

  const LOGO_SCATTER_OFFSETS = [
    { tx: -155, ty: -118, r: -24 },
    { tx: 126, ty: -142, r: 18 },
    { tx: 180, ty: -24, r: 22 },
    { tx: -168, ty: 52, r: -20 },
    { tx: -72, ty: 138, r: 16 },
    { tx: -24, ty: -96, r: 24 },
    { tx: 132, ty: 72, r: -18 },
    { tx: 110, ty: 142, r: -22 }
  ];

  function renderProject(project) {
    puzzleWrap.innerHTML = "";

    const stage = document.createElement("div");
    stage.className = "logo-assemble-stage";
    stage.setAttribute("role", "group");
    stage.setAttribute("aria-label", `${project.shortTitle} 구성원 작업 로고 조각`);
    stage.style.setProperty("--project-accent", PROJECT_LOGO_COLORS[project.id] || "#8d8d8d");

    DATA.members.forEach((member, i) => {
      const pieceSet = LOGO_MEMBER_PIECES[project.id] || LOGO_MEMBER_PIECES[1];
      const pieceData = pieceSet[i % pieceSet.length];
      const scatter = LOGO_SCATTER_OFFSETS[i % LOGO_SCATTER_OFFSETS.length];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "logo-assemble-piece";
      btn.setAttribute("aria-label", `${member} 작업 보기`);
      btn.style.setProperty("--x", `${pieceData.x}%`);
      btn.style.setProperty("--y", `${pieceData.y}%`);
      btn.style.setProperty("--w", `${pieceData.w}%`);
      btn.style.setProperty("--h", `${pieceData.h}%`);
      btn.style.setProperty("--fr", `${pieceData.fr}deg`);
      btn.style.setProperty("--piece-radius", pieceData.br);
      btn.style.setProperty("--sr", `${scatter.r}deg`);
      btn.style.setProperty("--tx", `${scatter.tx}px`);
      btn.style.setProperty("--ty", `${scatter.ty}px`);
      btn.style.setProperty("--delay", `${140 + i * 90}ms`);
      btn.dataset.member = member;
      const body = document.createElement("span");
      body.className = "logo-piece-body";
      btn.appendChild(body);

      const showName = () => memberHoverLabel.textContent = member;
      const resetName = () => memberHoverLabel.textContent = "hover a piece";
      btn.addEventListener("pointerenter", showName);
      btn.addEventListener("pointerleave", resetName);
      btn.addEventListener("focus", showName);
      btn.addEventListener("blur", resetName);
      btn.addEventListener("click", () => navigate(`member/${project.id}/${i}`));
      btn.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`member/${project.id}/${i}`); }
      });

      stage.appendChild(btn);
    });

    puzzleWrap.appendChild(stage);
    memberHoverLabel.textContent = "hover a piece";
    requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.add("is-assembled")));

    projectCopy.innerHTML = `
      <div class="project-no">PROJECT ${project.id}</div>
      <h1>${project.shortTitle}</h1>
      <div class="project-intro">${project.intro.map(p => `<p>${p}</p>`).join("")}</div>
      <div class="project-divider" aria-hidden="true"></div>
      <div class="project-body">${project.body.map(p => `<p>${p}</p>`).join("")}</div>
      <p class="piece-note">흩어진 8개의 조각이 로고를 이루며 각 구성원의 작업을 나타냅니다. 조각 위에 마우스를 올려 이름을 확인하고 클릭하세요.</p>
    `;
  }

  const MEMBER_WORK_TITLES = {
    1: {
      "권보경": "우리는 형태 속의 나",
      "김유민": "우리가 되는 방식",
      "김지현": "〈헤어질 결심〉 프레임, 시선 그리고 그 속의 색",
      "김창수": "The Uniform",
      "이지은": "집단 속에서 우리는 어디로 가는가",
      "이현수": "The Call Room",
      "양정원": "사적인 규칙과 공적인 기호",
      "임사라": "네가 내 집단이면 좋겠어"
    },
    2: {
      "권보경": "무형의 단어들 (Shapeless Words)",
      "김유민": "우리 사이 틈에",
      "김지현": "someone",
      "김창수": "The Keepsake",
      "이지은": "시선 視線 | 눈이 가는 길",
      "이현수": "Para-moji",
      "양정원": "모르겠어요😭",
      "임사라": "이상 표현적인 초여름"
    }
  };

  let memberCarouselCleanup = null;

  function renderMember(projectId, memberIndex) {
    if (memberCarouselCleanup) {
      memberCarouselCleanup();
      memberCarouselCleanup = null;
    }

    const project = DATA.projects.find(p => p.id === projectId) || DATA.projects[0];
    const member = DATA.members[wrapIndex(memberIndex, DATA.members.length)];
    const root = document.getElementById("memberLayout");
    const assets = DATA.memberWorks?.[project.id]?.[member] || [];
    const memberTitle = MEMBER_WORK_TITLES[project.id]?.[member] || "";

    if (!assets.length) {
      root.innerHTML = `
        <section class="member-empty-state">
          <button class="member-back-button" type="button">← WORKS</button>
          <h1>${member}</h1>
          <p>작업 이미지가 아직 등록되지 않았습니다.</p>
        </section>`;
      root.querySelector('.member-back-button')?.addEventListener('click', () => navigate(`project-${project.id}`));
      return;
    }

    const media = assets.map((item, i) => {
      if (item.type === 'video') {
        return `<article class="member-slide member-slide-video-wrap" data-slide="${i}" data-type="video"><video class="member-slide-media member-slide-video" src="${item.src}" muted loop playsinline preload="metadata" aria-label="${member} 작업 영상 ${i + 1}"></video></article>`;
      }
      return `<article class="member-slide" data-slide="${i}" data-type="image"><img class="member-slide-media member-slide-image" src="${item.src}" alt="${member} 작업 이미지 ${i + 1}" ${i > 2 ? 'loading="lazy"' : ''} decoding="async" /></article>`;
    }).join('');

    const progress = assets.map((_, i) => `<button class="member-progress-segment" type="button" data-go-slide="${i}" aria-label="${i + 1}번째 작업 보기"></button>`).join('');

    root.innerHTML = `
      <section class="member-carousel-shell" data-project="${project.id}">
        <button class="member-back-button" type="button">← WORKS</button>
        <div class="member-carousel-left">
          <div class="member-stage" id="memberStage">
            <div class="member-slide-track" id="memberSlideTrack">${media}</div>
          </div>
          <div class="member-progress" aria-label="작업 진행 상태">${progress}</div>
        </div>
        <aside class="member-info-panel">
          <div class="member-info-top">
            <div class="member-project-label">PROJECT ${project.id}</div>
            <div class="member-project-title">${project.shortTitle}</div>
          </div>
          <div class="member-info-bottom">
            <div class="member-slide-counter"><span id="memberCurrentSlide">01</span> / ${String(assets.length).padStart(2, '0')}</div>
            <h1>${member}</h1>
            ${memberTitle ? `<div class="member-member-title">${memberTitle}</div>` : ''}
          </div>
        </aside>
      </section>`;

    const stage = root.querySelector('#memberStage');
    const slides = [...root.querySelectorAll('.member-slide')];
    const videos = [...root.querySelectorAll('.member-slide-video')];
    const currentEl = root.querySelector('#memberCurrentSlide');
    const progressEls = [...root.querySelectorAll('.member-progress-segment')];
    let slideIndex = 0;
    let slideWidth = 1;
    let rafId = 0;
    let isDragging = false;
    let pointerId = null;
    let pointerStartX = 0;
    let scrollStartX = 0;

    const syncVideos = () => {
      videos.forEach(video => {
        const idx = Number(video.closest('.member-slide')?.dataset.slide || 0);
        video.muted = true;
        video.defaultMuted = true;
        video.playsInline = true;
        if (Math.abs(idx - slideIndex) <= 1) video.play().catch(() => {});
        else video.pause();
      });
    };

    const updateActiveUI = nextIndex => {
      slideIndex = Math.max(0, Math.min(assets.length - 1, nextIndex));
      currentEl.textContent = String(slideIndex + 1).padStart(2, '0');
      slides.forEach((slide, i) => slide.classList.toggle('is-active', i === slideIndex));
      progressEls.forEach((segment, i) => segment.classList.toggle('is-active', i === slideIndex));
      syncVideos();
    };

    const updateMeasurements = () => {
      const stageHeight = stage.clientHeight || 520;
      stage.style.setProperty('--member-page-width', `${Math.round(stageHeight * 0.8)}px`);
      slideWidth = slides[0]?.getBoundingClientRect().width || stage.clientWidth || 1;
    };

    const syncFromScroll = () => {
      rafId = 0;
      updateMeasurements();
      const nextIndex = Math.round(stage.scrollLeft / slideWidth);
      updateActiveUI(nextIndex);
    };

    const requestSync = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(syncFromScroll);
    };

    const goToSlide = (nextIndex, behavior = 'smooth') => {
      updateMeasurements();
      const bounded = Math.max(0, Math.min(assets.length - 1, nextIndex));
      stage.scrollTo({ left: bounded * slideWidth, behavior });
      updateActiveUI(bounded);
    };

    progressEls.forEach(el => el.addEventListener('click', () => goToSlide(Number(el.dataset.goSlide))));
    root.querySelector('.member-back-button')?.addEventListener('click', () => navigate(`project-${project.id}`));

    const onWheel = e => {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 4) return;
      e.preventDefault();
      stage.scrollLeft += delta;
      requestSync();
    };
    stage.addEventListener('wheel', onWheel, { passive: false });

    const onPointerDown = e => {
      isDragging = true;
      pointerId = e.pointerId;
      pointerStartX = e.clientX;
      scrollStartX = stage.scrollLeft;
      stage.classList.add('is-dragging');
      stage.setPointerCapture?.(pointerId);
    };

    const onPointerMove = e => {
      if (!isDragging) return;
      const dx = e.clientX - pointerStartX;
      stage.scrollLeft = scrollStartX - dx;
      requestSync();
    };

    const endDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      stage.classList.remove('is-dragging');
      pointerId = null;
      requestSync();
    };

    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    stage.addEventListener('pointerleave', endDrag);
    stage.addEventListener('scroll', requestSync, { passive: true });

    const onKey = e => {
      if (currentRoute !== `member/${project.id}/${memberIndex}` && !currentRoute.startsWith('member/')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goToSlide(slideIndex - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goToSlide(slideIndex + 1); }
    };

    const onResize = () => {
      updateMeasurements();
      goToSlide(slideIndex, 'auto');
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);

    updateMeasurements();
    goToSlide(0, 'auto');

    memberCarouselCleanup = () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      if (rafId) cancelAnimationFrame(rafId);
      videos.forEach(v => v.pause());
    };
  }

  /* ---------------- MAGAZINES ---------------- */
  const shelf = document.getElementById("magazineShelf");
  const magViewer = document.getElementById("magViewer");
  const viewerFrame = document.getElementById("viewerFrame");
  const viewerMeta = document.getElementById("viewerMeta");
  const viewerPrev = document.getElementById("viewerPrev");
  const viewerNext = document.getElementById("viewerNext");
  const viewerClose = document.getElementById("viewerClose");
  let magRendered = false;
  let viewerMagIndex = 0;
  let viewerPageIndex = 0;
  let magFocusTitle = null;
  let magFocusCredit = null;
  let viewerCleanup = null;
  const magState = {
    items: [],
    rotation: 0,
    targetRotation: 0,
    hoveringCard: null,
    dragActive: false,
    dragPointerId: null,
    dragStartX: 0,
    dragStartRotation: 0,
    lastInput: 0,
    active: false,
    raf: 0,
    bound: false
  };

  function getMagPage(page) {
    return typeof page === 'string' ? { type: 'image', src: page } : page;
  }

  function ensureMagazineTitle() {
    if (magFocusTitle) return;
    const row = document.querySelector('.magazine-heading-row');
    const wrap = document.createElement('div');
    wrap.className = 'magazine-focus-head';
    magFocusTitle = document.createElement('div');
    magFocusTitle.className = 'magazine-focus-title';
    magFocusTitle.textContent = 'MAGAZINE';
    magFocusCredit = document.createElement('div');
    magFocusCredit.className = 'magazine-focus-credit';
    magFocusCredit.innerHTML = '<span>Contents By</span> —';
    wrap.appendChild(magFocusTitle);
    wrap.appendChild(magFocusCredit);
    row?.appendChild(wrap);
    row?.querySelector('.magazine-help')?.replaceChildren(document.createTextNode('drag / wheel to browse · click to open'));
  }

  function bindMagazineInput() {
    if (magState.bound) return;
    magState.bound = true;

    const endDrag = () => {
      magState.dragActive = false;
      magState.dragPointerId = null;
      shelf.classList.remove('is-dragging');
    };

    shelf.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      magState.dragActive = true;
      magState.dragPointerId = e.pointerId;
      magState.dragStartX = e.clientX;
      magState.dragStartRotation = magState.targetRotation;
      magState.lastInput = performance.now();
      shelf.classList.add('is-dragging');
      shelf.setPointerCapture?.(e.pointerId);
    });

    shelf.addEventListener('pointermove', e => {
      if (!magState.dragActive) return;
      const dx = e.clientX - magState.dragStartX;
      magState.targetRotation = magState.dragStartRotation + dx * .0085;
      magState.lastInput = performance.now();
    });

    shelf.addEventListener('pointerup', endDrag);
    shelf.addEventListener('pointercancel', endDrag);
    shelf.addEventListener('pointerleave', () => {
      if (!magState.dragActive) magState.hoveringCard = null;
    });

    shelf.addEventListener('wheel', e => {
      e.preventDefault();
      magState.targetRotation += (e.deltaY + e.deltaX) * .00065;
      magState.lastInput = performance.now();
    }, { passive: false });

    window.addEventListener('resize', () => {
      if (currentRoute === 'magazine') layoutMagazines();
      if (magViewer.classList.contains('is-open')) updateViewer('auto');
    });
  }

  function setMagazineTargetToIndex(index) {
    const n = DATA.magazines.length || 1;
    const step = (Math.PI * 2) / n;
    const rawTarget = -index * step;
    const turn = Math.PI * 2;
    const current = magState.targetRotation;
    let best = rawTarget;
    while (best - current > Math.PI) best -= turn;
    while (best - current < -Math.PI) best += turn;
    magState.targetRotation = best;
    magState.lastInput = performance.now();
  }

  function renderMagazines() {
    ensureMagazineTitle();
    if (!magRendered) {
      magRendered = true;
      shelf.innerHTML = '';
      DATA.magazines.forEach((mag, i) => {
        const card = document.createElement('article');
        card.className = 'mag-card';
        card.dataset.index = String(i);
        card.tabIndex = 0;
        card.setAttribute('aria-label', `${mag.title} 열기`);
        card.innerHTML = `
          <div class="mag-card-cover ${mag.cover ? '' : 'mag-empty'}">
            ${mag.cover ? `<img src="${mag.cover}" alt="${mag.title} cover" draggable="false" />` : `<span>MAGAZINE</span>`}
          </div>
          <div class="mag-card-meta"><span>${mag.title}</span><small>Contents By ${mag.author || ''}</small></div>
        `;
        card.addEventListener('pointerenter', () => {
          magState.hoveringCard = i;
          setMagazineTargetToIndex(i);
        });
        card.addEventListener('pointerleave', () => {
          if (!magState.dragActive && magState.hoveringCard === i) {
            magState.hoveringCard = null;
            magState.lastInput = performance.now();
          }
        });
        card.addEventListener('click', e => {
          if (magState.dragActive) return;
          openViewer(i, 0);
        });
        card.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openViewer(i, 0);
          }
          if (e.key === 'ArrowLeft') { e.preventDefault(); setMagazineTargetToIndex(i - 1); }
          if (e.key === 'ArrowRight') { e.preventDefault(); setMagazineTargetToIndex(i + 1); }
        });
        shelf.appendChild(card);
      });
      magState.items = [...shelf.querySelectorAll('.mag-card')];
      bindMagazineInput();
    }
    magState.active = true;
    if (!magState.lastInput) magState.lastInput = performance.now();
    layoutMagazines();
    if (!magState.raf) magazineLoop();
  }

  function layoutMagazines() {
    if (!magRendered) return;
    const cards = magState.items;
    const rect = shelf.getBoundingClientRect();
    const n = cards.length;
    if (!n) return;

    const step = (Math.PI * 2) / n;
    const rx = Math.min(rect.width * .30, 390);
    const ry = Math.min(rect.height * .18, 135);
    let focused = 0, focusScore = Infinity;

    cards.forEach((card, i) => {
      const a = magState.rotation + i * step;
      const x = Math.sin(a) * rx;
      const y = Math.cos(a) * ry - rect.height * .015;
      const depth = (Math.cos(a) + 1) / 2;
      const scale = .72 + depth * .38;
      const opacity = .36 + depth * .64;
      const rot = Math.sin(a) * 8;
      card.style.setProperty('--x', `${x.toFixed(2)}px`);
      card.style.setProperty('--y', `${y.toFixed(2)}px`);
      card.style.setProperty('--rot', `${rot.toFixed(2)}deg`);
      card.style.setProperty('--scale', scale.toFixed(3));
      card.style.opacity = opacity.toFixed(3);
      card.style.zIndex = String(Math.round(depth * 100));
      const score = Math.abs(a % (Math.PI * 2));
      const normalized = Math.min(score, Math.abs(score - Math.PI * 2));
      if (normalized < focusScore) { focusScore = normalized; focused = i; }
    });

    cards.forEach((card, i) => card.classList.toggle('is-focused', i === focused));
    const focusMag = DATA.magazines[focused];
    if (magFocusTitle) magFocusTitle.textContent = focusMag?.title || 'MAGAZINE';
    if (magFocusCredit) magFocusCredit.innerHTML = `<span>Contents By</span> ${focusMag?.author || '—'}`;
  }

  function magazineLoop() {
    if (!magState.active || currentRoute !== 'magazine') {
      magState.raf = 0;
      return;
    }
    if (!magState.dragActive && magState.hoveringCard === null && performance.now() - magState.lastInput > 1400) {
      magState.targetRotation += .00175;
    }
    magState.rotation += (magState.targetRotation - magState.rotation) * .08;
    layoutMagazines();
    magState.raf = requestAnimationFrame(magazineLoop);
  }

  function buildViewer(mag) {
    if (viewerCleanup) {
      viewerCleanup();
      viewerCleanup = null;
    }

    const pages = mag.pages.map(getMagPage);
    const slides = pages.map((page, i) => page.type === 'video'
      ? `<article class="viewer-page" data-page="${i}" data-type="video"><video class="viewer-page-media" src="${page.src}" muted loop playsinline preload="metadata" aria-label="${mag.title} page ${i + 1}"></video></article>`
      : `<article class="viewer-page" data-page="${i}" data-type="image"><img class="viewer-page-media" src="${page.src}" alt="${mag.title} page ${i + 1}" ${i > 2 ? 'loading="lazy"' : ''} decoding="async" /></article>`
    ).join('');
    const progress = pages.map((_, i) => `<button class="viewer-progress-segment" type="button" data-viewer-go="${i}" aria-label="${i + 1}페이지 보기"></button>`).join('');

    viewerFrame.innerHTML = `
      <div class="viewer-scroll-stage" id="viewerStage">
        <div class="viewer-scroll-track" id="viewerTrack">${slides}</div>
      </div>
      <div class="viewer-progress" id="viewerProgress">${progress}</div>`;

    const stage = viewerFrame.querySelector('#viewerStage');
    const slidesEls = [...viewerFrame.querySelectorAll('.viewer-page')];
    const videos = [...viewerFrame.querySelectorAll('video')];
    const progressEls = [...viewerFrame.querySelectorAll('.viewer-progress-segment')];
    let pageWidth = 1;
    let rafId = 0;
    let isDragging = false;
    let dragStartX = 0;
    let scrollStartX = 0;

    const syncVideos = () => {
      videos.forEach(video => {
        const idx = Number(video.closest('.viewer-page')?.dataset.page || 0);
        video.muted = true;
        video.defaultMuted = true;
        video.playsInline = true;
        if (Math.abs(idx - viewerPageIndex) <= 1) video.play().catch(() => {});
        else video.pause();
      });
    };

    const updateMeasurements = () => {
      const stageHeight = stage.clientHeight || Math.min(window.innerHeight * .82, 760);
      stage.style.setProperty('--viewer-page-width', `${Math.round(stageHeight * 0.8)}px`);
      pageWidth = slidesEls[0]?.getBoundingClientRect().width || stage.clientWidth || 1;
    };

    const setActive = index => {
      viewerPageIndex = Math.max(0, Math.min(pages.length - 1, index));
      viewerMeta.textContent = `${mag.title} · ${viewerPageIndex + 1} / ${pages.length}`;
      progressEls.forEach((segment, i) => segment.classList.toggle('is-active', i === viewerPageIndex));
      syncVideos();
      viewerPrev.disabled = viewerPageIndex <= 0;
      viewerNext.disabled = viewerPageIndex >= pages.length - 1;
    };

    const syncFromScroll = () => {
      rafId = 0;
      updateMeasurements();
      const nextIndex = Math.round(stage.scrollLeft / pageWidth);
      setActive(nextIndex);
    };

    const requestSync = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(syncFromScroll);
    };

    const goTo = (index, behavior = 'smooth') => {
      updateMeasurements();
      const bounded = Math.max(0, Math.min(pages.length - 1, index));
      stage.scrollTo({ left: bounded * pageWidth, behavior });
      setActive(bounded);
    };

    progressEls.forEach(el => el.addEventListener('click', () => goTo(Number(el.dataset.viewerGo))));

    const onWheel = e => {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 3) return;
      e.preventDefault();
      stage.scrollLeft += delta;
      requestSync();
    };
    const onPointerDown = e => {
      if (e.button !== 0) return;
      isDragging = true;
      dragStartX = e.clientX;
      scrollStartX = stage.scrollLeft;
      stage.classList.add('is-dragging');
      stage.setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = e => {
      if (!isDragging) return;
      stage.scrollLeft = scrollStartX - (e.clientX - dragStartX);
      requestSync();
    };
    const endDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      stage.classList.remove('is-dragging');
      requestSync();
    };
    const onResize = () => goTo(viewerPageIndex, 'auto');

    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    stage.addEventListener('pointerleave', endDrag);
    stage.addEventListener('scroll', requestSync, { passive: true });
    window.addEventListener('resize', onResize);

    viewerPrev.onclick = () => goTo(viewerPageIndex - 1);
    viewerNext.onclick = () => goTo(viewerPageIndex + 1);

    viewerCleanup = () => {
      window.removeEventListener('resize', onResize);
      videos.forEach(v => v.pause());
      if (rafId) cancelAnimationFrame(rafId);
    };

    updateMeasurements();
    goTo(viewerPageIndex, 'auto');
  }

  function openViewer(magIndex, pageIndex = 0) {
    viewerMagIndex = magIndex;
    viewerPageIndex = pageIndex;
    const mag = DATA.magazines[viewerMagIndex];
    buildViewer(mag);
    magViewer.classList.add("is-open");
    magViewer.setAttribute("aria-hidden", "false");
  }

  function closeViewer() {
    magViewer.classList.remove("is-open");
    magViewer.setAttribute("aria-hidden", "true");
    if (viewerCleanup) viewerCleanup();
  }

  function updateViewer(behavior = 'auto') {
    if (!magViewer.classList.contains('is-open')) return;
    const stage = viewerFrame.querySelector('#viewerStage');
    const slides = viewerFrame.querySelectorAll('.viewer-page');
    if (!stage || !slides.length) return;
    const pageWidth = slides[0].getBoundingClientRect().width || stage.clientWidth || 1;
    stage.style.setProperty('--viewer-page-width', `${Math.round((stage.clientHeight || 760) * 0.8)}px`);
    stage.scrollTo({ left: viewerPageIndex * pageWidth, behavior });
  }

  viewerClose.addEventListener("click", closeViewer);
  magViewer.addEventListener("click", e => { if (e.target === magViewer) closeViewer(); });
  window.addEventListener("keydown", e => {
    if (!magViewer.classList.contains("is-open")) return;
    if (e.key === "Escape") closeViewer();
    if (e.key === "ArrowLeft") { e.preventDefault(); viewerPrev.click(); }
    if (e.key === "ArrowRight") { e.preventDefault(); viewerNext.click(); }
  });

  /* INITIAL ROUTE */
  const initial = routeFromHash();
  navigate(initial, false);
})();
