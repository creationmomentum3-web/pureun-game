/* =========================================================
   GitHub 저장소를 데이터베이스처럼 쓰기

   원리는 단순합니다. GitHub 저장소 안의 파일을
   웹페이지에서 HTTP 요청으로 읽고 쓰는 것뿐입니다.

     읽기  GET  https://api.github.com/repos/{주인}/{저장소}/contents/{경로}
     쓰기  PUT  https://api.github.com/repos/{주인}/{저장소}/contents/{경로}

   두 가지만 기억하면 됩니다.

   1) 파일 내용은 언제나 Base64 로 주고받습니다.
      GitHub 는 사진도 텍스트도 구분 없이 "Base64 문자열"로 취급합니다.

   2) 기존 파일을 고칠 때는 sha 를 같이 보내야 합니다.
      sha 는 "내가 알고 있는 파일의 버전"이라는 뜻입니다.
      다른 사람이 그 사이 파일을 바꿨다면 sha 가 달라져서 409 오류가 납니다.
      덮어쓰기 사고를 막아주는 안전장치입니다.
========================================================= */
"use strict";

window.GH = (function () {
  const API = "https://api.github.com";
  let cfg = { owner: "", repo: "", branch: "main", token: "" };

  /* 로그인 정보는 이 브라우저에만 저장됩니다. 저장소에는 올라가지 않습니다. */
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem("pureum.gh") || "null");
      if (saved) cfg = Object.assign(cfg, saved);
    } catch (e) { /* 저장된 값이 깨졌으면 무시 */ }
    return cfg;
  }
  function save(next) {
    cfg = Object.assign(cfg, next);
    localStorage.setItem("pureum.gh", JSON.stringify(cfg));
  }
  function clear() {
    cfg = { owner: "", repo: "", branch: "main", token: "" };
    localStorage.removeItem("pureum.gh");
  }
  function isReady() { return !!(cfg.owner && cfg.repo && cfg.token); }
  function config() { return Object.assign({}, cfg); }

  async function call(path, options) {
    const res = await fetch(API + path, Object.assign({
      headers: {
        "Authorization": "Bearer " + cfg.token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    }, options || {}));

    if (res.status === 401) throw new Error("토큰이 올바르지 않거나 만료되었습니다.");
    if (res.status === 403) throw new Error("이 저장소에 쓸 권한이 없습니다. 토큰 권한을 확인해주세요.");
    if (res.status === 409) throw new Error("다른 곳에서 먼저 저장했습니다. 새로고침한 뒤 다시 저장해주세요.");
    if (res.status === 404) return null;                 // 파일이 아직 없음 — 오류가 아님
    if (!res.ok) throw new Error("GitHub 오류 " + res.status);
    if (res.status === 204) return true;
    return res.json();
  }

  const repoPath = (p) =>
    "/repos/" + cfg.owner + "/" + cfg.repo + "/contents/" + p + "?ref=" + cfg.branch;

  /* 로그인 확인: 토큰이 이 저장소에 접근되는지 실제로 물어봅니다. */
  async function verify() {
    const repo = await call("/repos/" + cfg.owner + "/" + cfg.repo);
    if (!repo) throw new Error("저장소를 찾을 수 없습니다. 주인 이름과 저장소 이름을 확인해주세요.");
    return { name: repo.full_name, branch: repo.default_branch };
  }

  /* 파일 읽기 → { text, json, sha } / 없으면 null */
  async function get(path) {
    const data = await call(repoPath(path));
    if (!data || !data.content) return null;
    const text = new TextDecoder().decode(
      Uint8Array.from(atob(data.content.replace(/\n/g, "")), (c) => c.charCodeAt(0))
    );
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* JSON 이 아닐 수도 있음 */ }
    return { text: text, json: json, sha: data.sha };
  }

  /* 파일 쓰기 (없으면 새로 만들고, 있으면 고칩니다) */
  async function put(path, base64, message, sha) {
    const body = { message: message, content: base64, branch: cfg.branch };
    if (sha) body.sha = sha;
    const out = await call("/repos/" + cfg.owner + "/" + cfg.repo + "/contents/" + path, {
      method: "PUT",
      headers: {
        "Authorization": "Bearer " + cfg.token,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!out) throw new Error("저장 경로를 찾을 수 없습니다: " + path);
    return out.content.sha;
  }

  async function putJSON(path, obj, message) {
    const existing = await get(path);
    const text = JSON.stringify(obj, null, 2);
    const base64 = btoa(String.fromCharCode.apply(null, new TextEncoder().encode(text)));
    return put(path, base64, message, existing ? existing.sha : null);
  }

  /* 폴더 목록 (없으면 빈 배열) */
  async function list(path) {
    const data = await call(repoPath(path));
    return Array.isArray(data) ? data : [];
  }

  return {
    load: load, save: save, clear: clear, isReady: isReady, config: config,
    verify: verify, get: get, put: put, putJSON: putJSON, list: list
  };
})();

/* =========================================================
   이미지 준비
   업로드 전에 브라우저에서 크기를 줄이고 WebP 로 바꿉니다.
   교사분이 스마트폰 사진(5MB)을 그대로 올려도 게임이 느려지지 않습니다.
========================================================= */
window.prepareImage = function (file, maxW) {
  maxW = maxW || 1920;
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onerror = function () { reject(new Error("파일을 읽지 못했습니다.")); };
    reader.onload = function () {
      const img = new Image();
      img.onerror = function () { reject(new Error("이미지 형식이 아닙니다.")); };
      img.onload = function () {
        const scale = Math.min(1, maxW / img.width);
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        const dataUrl = cv.toDataURL("image/webp", 0.9);
        resolve({
          base64: dataUrl.split(",")[1],   // GitHub 에 올릴 내용
          preview: dataUrl,                // 화면에 즉시 보여줄 썸네일
          width: cv.width, height: cv.height
        });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
};
