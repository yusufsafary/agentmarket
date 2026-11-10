// Agent Market smoothness layer: scroll reveal + light hero parallax.
// Presentation only. Nothing here touches wallet, mint, presale or swap
// logic, and every effect degrades to a fully visible, static page when
// JS, IntersectionObserver or motion permission is unavailable.
(function () {
  var reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // ---- Scroll reveal -------------------------------------------------------
  // Sections, consoles, cards and bands fade and rise 14px as they enter
  // the viewport, with a light stagger between grouped siblings. The .rv
  // class is added from here, never in the HTML, so the default state of
  // every element is visible. After the reveal finishes the classes are
  // stripped again so hover transforms behave exactly as before.
  var TARGETS = ".sec-h, .console, .facts-band, .steps-l li, .perk, .prompt-box, .ag-card, .bowl-cap > div, .dp-faq details";
  var els = Array.prototype.slice.call(document.querySelectorAll(TARGETS));
  if (els.length && !reduce && "IntersectionObserver" in window) {
    var byParent = new Map();
    els.forEach(function (el) {
      var sibs = byParent.get(el.parentNode) || [];
      el.style.transitionDelay = Math.min(sibs.length, 5) * 60 + "ms";
      sibs.push(el);
      byParent.set(el.parentNode, sibs);
      el.classList.add("rv");
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        io.unobserve(el);
        el.classList.add("in");
        setTimeout(function () {
          el.classList.remove("rv", "in");
          el.style.transitionDelay = "";
        }, 1200);
      });
    }, { threshold: 0.1, rootMargin: "0px 0px -5% 0px" });
    els.forEach(function (el) { io.observe(el); });
  }

  // ---- Light parallax on the specimen column --------------------------------
  // The sticky artwork column drifts a few px against the scroll, transform
  // only. Off on small screens, coarse pointers and reduced motion. The
  // tilt interaction lives on the .specimen card itself, so the two never
  // fight over the same transform.
  var art = document.querySelector(".mt-art");
  if (art && !reduce && window.matchMedia && window.matchMedia("(pointer: fine)").matches) {
    var ticking = false;
    function update() {
      ticking = false;
      if (window.innerWidth <= 920) { art.style.transform = ""; return; }
      var r = art.getBoundingClientRect();
      var center = r.top + r.height / 2 - window.innerHeight / 2;
      var shift = Math.max(-10, Math.min(10, -center * 0.018));
      art.style.transform = "translateY(" + shift.toFixed(1) + "px)";
    }
    function onScroll() {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    update();
  }
})();
