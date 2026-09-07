/* =========================================================
   회차 콘텐츠 로더
   게임(game.js)은 자기가 몇 회차를 돌리는지 모릅니다.
   이 파일이 JSON을 읽어 GAME_CONFIG / ASSETS 를 채워준 뒤 게임을 시작시킵니다.

   주소에 따라 무엇을 읽을지 달라집니다.
     /                → data/published.json 의 회차를 data/live/ 에서   (아이들용)
     /?week=3         → 3회차를 data/live/ 에서                         (과거 회차 다시 보기)
     /?preview=3      → 3회차 "작업본"을 data/weeks/ 에서               (관리자 미리보기)
========================================================= */
"use strict";

(function () {
  const pad = (n) => String(n).padStart(2, "0");

  function resolveTarget() {
    const q = new URLSearchParams(location.search);
    const preview = q.get("preview");
    if (preview === "local") return { local: true, preview: true };
    if (preview && /^\d+$/.test(preview)) {
      return { week: Number(preview), dir: "weeks", preview: true };
    }
    const week = q.get("week");
    if (week && /^\d+$/.test(week)) {
      return { week: Number(week), dir: "live", preview: false };
    }
    return null;
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(url.split("/").pop() + " (" + res.status + ")");
    return res.json();
  }

  function applyContent(data) {
    GAME_CONFIG.week = data.week;

    // 스토리: 배열 길이가 곧 페이지 수. 개수 제한 없음.
    ["opening", "middle", "ending"].forEach((type) => {
      const pages = data[type] || [];
      GAME_CONFIG.story[type] = pages.map((p, i) => ({
        title: "", cuts: [[type + "_" + (i + 1), "", ""]]
      }));
      pages.forEach((p, i) => { ASSETS.story[type + "_" + (i + 1)] = p.image; });
    });

    [1, 2].forEach((n) => {
      const r = data["round" + n];
      const prefix = "r" + n + "_";
      ASSETS["recipe" + n] = r.recipeImage;
      ASSETS["player" + n] = r.playerImage;

      const all = r.keywords || [];
      const toEntry = (kind) => (k, i) => {
        const assetKey = prefix + kind + i;
        ASSETS[assetKey] = k.image;
        return { id: assetKey, label: k.label || "", asset: assetKey };
      };
      const correct = all.filter((k) => k.correct !== false).map(toEntry("ok"));
      const wrong = all.filter((k) => k.correct === false).map(toEntry("no"));

      GAME_CONFIG["round" + n] = {
        title: r.title || "",
        note: r.note || "",
        resultName: r.resultName || "",
        recipeAsset: "recipe" + n,
        playerAsset: "player" + n,
        showKeywordOverlay: r.showKeywordOverlay !== false,
        correctKeywords: correct,
        wrongKeywords: wrong          // 비어 있으면 공통 오답 8개를 씁니다
      };
    });

    ASSETS.round1RevealSnowman = data.round1.resultImage;
    ASSETS.activityResult = data.round2.resultImage;
    GAME_CONFIG.wrongKeywords = window.FIXED_WRONG_KEYWORDS;
  }

  /* 관리자 미리보기는 GitHub Pages 배포를 기다리지 않고
     raw.githubusercontent.com 주소로 그림을 바로 불러옵니다. */
  function rebaseImages(data, base) {
    const fix = (p) => (!p || /^https?:|^data:/.test(p)) ? p : base + p;
    ["opening", "middle", "ending"].forEach(function (t) {
      (data[t] || []).forEach(function (p) { p.image = fix(p.image); });
    });
    [1, 2].forEach(function (n) {
      const r = data["round" + n];
      r.recipeImage = fix(r.recipeImage);
      r.playerImage = fix(r.playerImage);
      r.resultImage = fix(r.resultImage);
      (r.keywords || []).forEach(function (k) { k.image = fix(k.image); });
    });
    return data;
  }

  function readLocalPreview() {
    const raw = localStorage.getItem("pureum.preview");
    if (!raw) throw new Error("미리볼 내용이 없습니다.");
    const box = JSON.parse(raw);
    return rebaseImages(box.data, box.rawBase || "");
  }

  function preload(data) {
    const urls = [];
    ["opening", "middle", "ending"].forEach(function (t) {
      (data[t] || []).forEach(function (p) { urls.push(p.image); });
    });
    [1, 2].forEach(function (n) {
      const r = data["round" + n];
      urls.push(r.recipeImage, r.playerImage, r.resultImage);
      (r.keywords || []).forEach(function (k) { urls.push(k.image); });
    });
    return Promise.all(urls.filter(Boolean).map(function (src) {
      return new Promise(function (done) {
        const img = new Image();
        img.onload = img.onerror = done;
        img.src = src;
      });
    }));
  }

  function showError(msg, hint) {
    const box = document.getElementById("bootLoading");
    if (!box) return;
    box.innerHTML =
      '<div style="text-align:center;line-height:1.7">콘텐츠를 불러오지 못했습니다.' +
      '<div style="font-size:17px;opacity:.75;margin-top:14px">' + msg + '</div>' +
      (hint ? '<div style="font-size:15px;opacity:.55;margin-top:8px">' + hint + '</div>' : '') +
      '</div>';
  }

  function previewBadge(week) {
    const tag = document.createElement("div");
    tag.textContent = week + "회차 미리보기 — 아직 게임에 적용되지 않았습니다";
    tag.style.cssText =
      "position:fixed;left:0;right:0;top:0;z-index:99999;background:#6B4E9B;color:#fff;" +
      "font:600 14px/1 system-ui,sans-serif;padding:9px 14px;text-align:center";
    document.body.appendChild(tag);
  }

  (async function start() {
    try {
      let target = resolveTarget();
      if (!target) {
        const pub = await fetchJSON("data/published.json");
        target = { week: pub.week, dir: "live", preview: false };
      }
      const data = target.local
        ? readLocalPreview()
        : await fetchJSON("data/" + target.dir + "/week" + pad(target.week) + ".json");
      if (target.local) target.week = data.week;
      applyContent(data);
      await preload(data);
      window.PureumGame.boot();
      const box = document.getElementById("bootLoading");
      if (box) box.remove();
      if (target.preview) previewBadge(target.week);
      console.log("[CONTENT] " + target.week + "회차 (" + (target.dir || "미리보기") + ") 로드 완료");
    } catch (e) {
      console.error("[CONTENT]", e);
      showError(e.message, "관리자 페이지에서 이 회차를 저장했는지 확인해주세요.");
    }
  })();
})();
