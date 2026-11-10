(function () {
  // Living light over the Stall artwork: slow-rising amber fireflies with
  // a soft twinkle, drawn on a canvas inside the art frame. Procedural and
  // real time, in the spirit of the AgentPepe pond fx: pauses when the tab
  // is hidden or the stage scrolls off screen, and stays fully off for
  // visitors who prefer reduced motion.
  var stage = document.getElementById("artStage");
  var canvas = document.getElementById("artFx");
  if (!stage || !canvas) return;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Gentle pointer tilt on the frame (desktop, fine pointers only).
  var frame = stage.closest ? stage.closest(".art-frame") : null;
  if (!reduce && frame && window.matchMedia && window.matchMedia("(pointer: fine)").matches) {
    var tiltRaf = null;
    stage.addEventListener("mousemove", function (e) {
      if (tiltRaf) return;
      tiltRaf = requestAnimationFrame(function () {
        tiltRaf = null;
        var r = stage.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var dx = (e.clientX - r.left) / r.width - 0.5;
        var dy = (e.clientY - r.top) / r.height - 0.5;
        frame.style.transform = "rotateY(" + (dx * 5).toFixed(2) + "deg) rotateX(" + (-dy * 5).toFixed(2) + "deg)";
      });
    });
    stage.addEventListener("mouseleave", function () { frame.style.transform = ""; });
  }

  var ctx = canvas.getContext("2d");
  if (!ctx || reduce) return;

  // Pre-rendered soft glow sprite, so each firefly is one cheap drawImage.
  var sprite = document.createElement("canvas");
  sprite.width = sprite.height = 64;
  var sctx = sprite.getContext("2d");
  var grad = sctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255, 240, 190, 1)");
  grad.addColorStop(0.35, "rgba(242, 194, 48, 0.55)");
  grad.addColorStop(1, "rgba(232, 169, 12, 0)");
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 64, 64);

  var W = 0, H = 0, parts = [], visible = false, rafId = null, last = 0;

  function spawn(anywhere) {
    return {
      x: Math.random() * W,
      y: anywhere ? Math.random() * H : H + 12 + Math.random() * 30,
      r: 3 + Math.random() * 8,
      vy: 7 + Math.random() * 15,
      sway: 6 + Math.random() * 16,
      swaySpeed: 0.3 + Math.random() * 0.7,
      phase: Math.random() * Math.PI * 2,
      twinkle: 0.6 + Math.random() * 1.8,
      alpha: 0.35 + Math.random() * 0.45
    };
  }

  function resize() {
    var r = stage.getBoundingClientRect();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(60, Math.round(r.width));
    H = Math.max(60, Math.round(r.height));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var count = Math.max(20, Math.min(44, Math.floor(W / 16)));
    parts = [];
    for (var i = 0; i < count; i++) parts.push(spawn(true));
  }

  function tick(now) {
    rafId = requestAnimationFrame(tick);
    var dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    ctx.clearRect(0, 0, W, H);
    var t = now / 1000;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      p.y -= p.vy * dt;
      if (p.y < -16) parts[i] = p = spawn(false);
      var x = p.x + Math.sin(t * p.swaySpeed + p.phase) * p.sway;
      var tw = 0.55 + 0.45 * Math.sin(t * p.twinkle * 2.2 + p.phase * 3);
      ctx.globalAlpha = Math.max(0, p.alpha * tw);
      var d = p.r * 2;
      ctx.drawImage(sprite, x - p.r, p.y - p.r, d, d);
    }
    ctx.globalAlpha = 1;
  }

  function start() {
    if (rafId || !visible || document.hidden) return;
    last = performance.now();
    rafId = requestAnimationFrame(tick);
  }
  function stop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  resize();
  var rt = null;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(resize, 180);
  });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible) start(); else stop();
    }, { threshold: 0.05 }).observe(stage);
  } else {
    visible = true;
    start();
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else start();
  });
})();
