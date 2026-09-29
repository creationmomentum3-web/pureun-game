/* =========================================================
   푸른이 콘텐츠 관리 — 화면 로직

   저장 위치 (모두 GitHub 저장소 안의 그냥 파일입니다)
     content/weekNN/...      그림
     data/weeks/weekNN.json  작업본   ← [저장] 이 여기에 씁니다
     data/live/weekNN.json   적용본   ← [게임에 적용] 이 여기로 복사합니다
     data/published.json     지금 아이들이 보는 회차 번호

   그래서 저장을 아무리 많이 해도 아이들 화면은 바뀌지 않습니다.
========================================================= */
"use strict";

const WEEK_COUNT = 16;
const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(2, "0");

let weeksInfo = {};      // { 1: {exists, status}, ... }
let liveWeek = null;     // 현재 게임에 적용된 회차
let current = null;      // 열려 있는 회차 번호
let draft = null;        // 편집 중인 내용
let dirty = false;
let busy = false;

/* ---------------------------------------------------------------- 도우미 */
/* 예전에 저장한 회차에는 마지막 화면 정보가 없으므로 기본값을 채워준다 */
function normalizeEnd() {
  if (!draft.endScreen) draft.endScreen = { image: "", text: "", hasRetryButton: false };
  const e = draft.endScreen;
  if (!e.textPos) e.textPos = { x: 0, y: 0, size: 72 };
  if (typeof e.textPos.x !== "number") e.textPos.x = 0;
  if (typeof e.textPos.y !== "number") e.textPos.y = 0;
  if (typeof e.textPos.size !== "number") e.textPos.size = 72;
}

function blankWeek(n) {
  return {
    week: n, status: "미작성", updatedAt: "",
    opening: [], middle: [], ending: [],
    round1: {
      title: "", note: "", recipeImage: "", playerImage: "",
      resultName: "", resultImage: "", showKeywordOverlay: false, keywords: []
    },
    round2: {
      title: "", note: "", recipeImage: "", playerImage: "",
      resultName: "", resultImage: "", showKeywordOverlay: true, keywords: []
    },
    endScreen: { image: "", text: "", hasRetryButton: false,
      textPos: { x: 0, y: 0, size: 72 } }
  };
}

function toast(msg, bad) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show" + (bad ? " bad" : "");
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = "toast"; }, 2800);
}

function setStatus(text) { $("#status").textContent = text; }

function markDirty() {
  dirty = true;
  setStatus("저장하지 않은 변경사항이 있습니다");
  if (current) {
    localStorage.setItem("pureum.draft." + current, JSON.stringify(draft));
  }
}

function openModal(opt) {
  return new Promise((resolve) => {
    $("#modalTitle").textContent = opt.title;
    $("#modalBody").innerHTML = opt.body;
    $("#modalYes").textContent = opt.yes || "적용하기";
    $("#modalNo").textContent = opt.no || "그만두기";
    $("#modalYes").className = "btn " + (opt.danger ? "btn-danger" : "btn-go");
    const m = $("#modal");
    m.classList.add("show");
    const done = (v) => {
      m.classList.remove("show");
      $("#modalYes").onclick = $("#modalNo").onclick = null;
      resolve(v);
    };
    $("#modalYes").onclick = () => done(true);
    $("#modalNo").onclick = () => done(false);
  });
}

/* ---------------------------------------------------------------- 로그인 */
async function tryLogin() {
  const owner = $("#fOwner").value.trim();
  const repo = $("#fRepo").value.trim();
  const token = $("#fToken").value.trim();
  if (!owner || !repo || !token) { $("#gateMsg").textContent = "세 칸을 모두 채워주세요."; return; }

  $("#btnLogin").disabled = true;
  $("#gateMsg").textContent = "확인하는 중...";
  GH.save({ owner, repo, token });
  try {
    const info = await GH.verify();
    GH.save({ branch: info.branch });
    $("#gate").classList.add("hidden");
    $("#app").classList.remove("hidden");
    await loadIndex();
  } catch (e) {
    GH.clear();
    $("#gateMsg").textContent = e.message;
  } finally {
    $("#btnLogin").disabled = false;
  }
}

/* ---------------------------------------------------------------- 회차 목록 */
async function loadIndex() {
  setStatus("회차 목록을 불러오는 중...");
  const pub = await GH.get("data/published.json");
  liveWeek = pub && pub.json ? pub.json.week : null;

  const files = await GH.list("data/weeks");
  const names = files.map((f) => f.name);

  weeksInfo = {};
  const jobs = [];
  for (let n = 1; n <= WEEK_COUNT; n++) {
    const exists = names.indexOf("week" + pad(n) + ".json") >= 0;
    weeksInfo[n] = { exists, status: exists ? "작성 중" : "미작성" };
    if (exists) {
      jobs.push(GH.get("data/weeks/week" + pad(n) + ".json").then((f) => {
        if (f && f.json && f.json.status) weeksInfo[n].status = f.json.status;
      }));
    }
  }
  await Promise.all(jobs);
  renderWeeks();
  $("#liveNow").innerHTML = '<span class="live-dot"></span>' +
    (liveWeek ? "지금 게임: " + liveWeek + "회차" : "아직 적용된 회차 없음");
  setStatus("회차를 골라주세요");
  if (current === null) openWeek(liveWeek || 1);
}

function renderWeeks() {
  const box = $("#weeks");
  box.innerHTML = "";
  for (let n = 1; n <= WEEK_COUNT; n++) {
    const info = weeksInfo[n];
    const b = document.createElement("button");
    b.className = "week" + (n === liveWeek ? " is-live" : "") + (n === current ? " is-open" : "");
    b.dataset.status = info.status;
    b.innerHTML = '<div class="n">' + n + '</div><div class="s">' +
      (n === liveWeek ? "게임 중" : info.status) + '</div>';
    b.onclick = () => openWeek(n);
    box.appendChild(b);
  }
}

/* ---------------------------------------------------------------- 회차 열기 */
async function openWeek(n) {
  if (busy) return;
  if (pendingUploads > 0) {
    toast("그림을 올리는 중입니다. 끝난 뒤에 옮겨주세요.", true);
    return;
  }
  if (dirty && current !== n) {
    const go = await openModal({
      title: current + "회차를 저장하지 않았습니다",
      body: "저장하지 않고 " + n + "회차로 넘어가면 지금 화면의 변경사항은 이 브라우저에만 남습니다.",
      yes: "넘어가기", no: "여기 있기", danger: true
    });
    if (!go) return;
  }

  busy = true;
  setStatus(n + "회차를 불러오는 중...");
  try {
    const file = await GH.get("data/weeks/week" + pad(n) + ".json");
    draft = file && file.json ? file.json : blankWeek(n);
    draft.week = n;
    normalizeEnd();

    const local = localStorage.getItem("pureum.draft." + n);
    if (local) {
      const use = await openModal({
        title: n + "회차에 저장하지 않은 작업이 있습니다",
        body: "이전에 이 브라우저에서 편집하다 저장하지 않은 내용이 남아 있습니다. 불러올까요?",
        yes: "불러오기", no: "버리기"
      });
      if (use) {
        draft = JSON.parse(local); draft.week = n;
        normalizeEnd();
      }
      else localStorage.removeItem("pureum.draft." + n);
      dirty = use;
    } else {
      dirty = false;
    }

    current = n;
    renderWeeks();
    renderAll();
    setStatus(dirty ? "저장하지 않은 변경사항이 있습니다"
      : (weeksInfo[n].exists ? "불러왔습니다" : "새 회차입니다"));
  } catch (e) {
    toast(e.message, true);
  } finally {
    busy = false;
  }
}

/* ---------------------------------------------------------------- 그리기 */
function renderAll() {
  $("#weekTitle").textContent = current + "회차";
  const total = draft.opening.length + draft.middle.length + draft.ending.length;
  $("#weekSub").textContent = weeksInfo[current].exists
    ? "이야기 " + total + "장, 키워드 " +
      (draft.round1.keywords.length + draft.round2.keywords.length) + "개"
    : "아직 아무것도 없습니다. 이전 회차를 복제하면 빠릅니다.";

  ["opening", "middle", "ending"].forEach(renderPages);
  [1, 2].forEach(renderKeywords);

  imageSlot("#dropR1recipe", () => draft.round1.recipeImage, (v) => draft.round1.recipeImage = v);
  imageSlot("#dropR1player", () => draft.round1.playerImage, (v) => draft.round1.playerImage = v);
  imageSlot("#dropR1result", () => draft.round1.resultImage, (v) => draft.round1.resultImage = v);
  imageSlot("#dropR2recipe", () => draft.round2.recipeImage, (v) => draft.round2.recipeImage = v);
  imageSlot("#dropR2player", () => draft.round2.playerImage, (v) => draft.round2.playerImage = v);
  imageSlot("#dropR2result", () => draft.round2.resultImage, (v) => draft.round2.resultImage = v);
  imageSlot("#dropEndBg", () => draft.endScreen.image, (v) => {
    draft.endScreen.image = v; drawEndPreview();
  });

  bindText("#r1title", () => draft.round1.title, (v) => draft.round1.title = v);
  bindText("#r1note", () => draft.round1.note.replace(/<br\s*\/?>/g, "\n"),
    (v) => draft.round1.note = v.replace(/\n/g, "<br>"));
  bindText("#r1resultName", () => draft.round1.resultName, (v) => draft.round1.resultName = v);
  bindText("#r2title", () => draft.round2.title, (v) => draft.round2.title = v);
  bindText("#r2note", () => draft.round2.note.replace(/<br\s*\/?>/g, "\n"),
    (v) => draft.round2.note = v.replace(/\n/g, "<br>"));
  bindText("#r2resultName", () => draft.round2.resultName, (v) => draft.round2.resultName = v);
  bindText("#endText", () => draft.endScreen.text, (v) => {
    draft.endScreen.text = v; drawEndPreview();
  });

  const ehb = $("#endHasBtn");
  ehb.checked = !!draft.endScreen.hasRetryButton;
  ehb.onchange = () => { draft.endScreen.hasRetryButton = ehb.checked; markDirty(); };

  bindEndPosition();

  const ov = $("#r2overlay");
  ov.checked = draft.round2.showKeywordOverlay !== false;
  ov.onchange = () => { draft.round2.showKeywordOverlay = ov.checked; markDirty(); };
}

function bindText(sel, get, set) {
  const el = $(sel);
  el.value = get() || "";
  el.oninput = () => { set(el.value); markDirty(); };
}

/* ---- 그림 올리기 (한 장씩 줄을 세워서 올립니다) ----
   [고친 이유]
   예전에는 그림 여러 장을 거의 동시에 GitHub 로 보냈습니다.
   GitHub 는 같은 순간에 들어온 저장 요청 중 일부를 거절하기 때문에
   어떤 장은 올라가고 어떤 장은 빈 칸으로 남았습니다.
   이제는 "올리는 줄"을 하나만 두고, 한 장이 끝나야 다음 장을 올립니다.
   실패하면 자동으로 다시 시도합니다. */
const previewCache = {};      // 그림 경로 → 화면에 보여줄 미리보기 (올리는 중이거나 방금 올린 그림)
let pendingUploads = 0;       // 아직 GitHub 에 올라가는 중인 그림 수
let uploadFailed = 0;
let uploadQueue = Promise.resolve();

function newImagePath() {
  return "content/week" + pad(current) + "/img-" + Date.now() +
    "-" + Math.random().toString(36).slice(2, 6) + ".webp";
}

async function putWithRetry(path, base64) {
  let lastErr;
  for (let i = 0; i < 4; i++) {
    try {
      return await GH.put(path, base64, "그림 추가: " + path);
    } catch (e) {
      lastErr = e;
      if (/토큰|권한/.test(e.message)) break;          // 다시 해도 소용없는 오류
      await new Promise((r) => setTimeout(r, 900 * (i + 1)));
    }
  }
  throw lastErr;
}

function showUploadStatus() {
  if (pendingUploads > 0) {
    setStatus("그림을 올리는 중... (남은 " + pendingUploads + "장)");
  } else if (uploadFailed > 0) {
    setStatus("그림 " + uploadFailed + "장을 올리지 못했습니다. 빈 칸에 다시 올려주세요");
  } else {
    setStatus("그림을 모두 올렸습니다. 저장을 눌러주세요");
  }
}

/* 그림 한 장을 "올리는 줄"에 세웁니다.
   화면에는 곧바로 그림이 나타나고(미리보기), 실제 업로드는 뒤에서 차례로 진행됩니다. */
async function queueUpload(file, set, onFail) {
  const img = await prepareImage(file);
  const path = newImagePath();
  previewCache[path] = img.preview;
  set(path);
  markDirty();
  pendingUploads++;
  showUploadStatus();

  const job = uploadQueue.then(() => putWithRetry(path, img.base64));
  uploadQueue = job.then(
    () => {},
    (e) => {
      uploadFailed++;
      set("");
      delete previewCache[path];
      markDirty();
      toast("그림 올리기에 실패했습니다: " + e.message, true);
      if (onFail) onFail();
    }
  ).then(() => {
    pendingUploads--;
    showUploadStatus();
    if (pendingUploads === 0) uploadFailed = 0;
  });
  return path;
}

/* ---- 이미지 한 칸 ---- */
function imageSlot(target, get, set, small, meta) {
  const host = typeof target === "string" ? $(target) : target;
  host.innerHTML = "";
  const box = document.createElement("div");
  box.className = "drop";
  const url = get();
  box.innerHTML = url
    ? '<img src="' + resolveUrl(url) + '" alt="" />'
    : (small ? "그림" : "여기로 그림을 끌어놓거나 눌러서 고르세요");

  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  if (meta && meta.onMany) input.multiple = true;
  box.appendChild(input);

  const handle = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => /^image\//.test(f.type));
    if (!files.length) return;
    if (files.length > 1 && meta && meta.onMany) { meta.onMany(files); return; }
    const file = files[0];
    try {
      const path = await queueUpload(file, set, () => imageSlot(host, get, set, small, meta));
      box.innerHTML = '<img src="' + resolveUrl(path) + '" alt="" />';
      box.appendChild(input);
      if (meta && meta.setName) meta.setName(file.name);
    } catch (e) {
      toast(e.message, true);
      setStatus("그림 올리기에 실패했습니다");
    }
  };

  input.onchange = () => { handle(input.files); input.value = ""; };
  box.addEventListener("dragover", (e) => {
    e.preventDefault(); e.stopPropagation(); box.classList.add("dragover");
  });
  box.addEventListener("dragleave", () => box.classList.remove("dragover"));
  box.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();            // 카드 순서 바꾸기로 잘못 전달되지 않게 막습니다
    box.classList.remove("dragover");
    handle(e.dataTransfer.files);
  });

  host.appendChild(box);
  if (!small && get()) {
    const acts = document.createElement("div");
    acts.className = "thumb-actions";
    const del = document.createElement("button");
    del.className = "btn btn-sm btn-danger";
    del.textContent = "그림 지우기";
    del.onclick = () => { set(""); markDirty(); imageSlot(host, get, set, small, meta); };
    acts.appendChild(del);
    host.appendChild(acts);
  }
}

/* 저장된 경로는 저장소 기준입니다. 관리자 화면에서는 GitHub 원본 주소로 바꿔서 봅니다.
   방금 올린 그림은 GitHub 원본 주소가 열리기까지 시간이 걸리므로 미리보기를 먼저 씁니다. */
function resolveUrl(p) {
  if (!p) return p;
  if (previewCache[p]) return previewCache[p];
  if (/^https?:|^data:/.test(p)) return p;
  const c = GH.config();
  return "https://raw.githubusercontent.com/" + c.owner + "/" + c.repo + "/" + c.branch + "/" + p;
}

/* ---- 마지막 화면: 글자 위치 맞추기 ---- */
const END_BASE_TOP = 190;     // 게임 CSS 의 기본 위치 (1920x1080 기준)
const END_BOX_W = 1000, END_BOX_H = 210;

function bindEndPosition() {
  const pos = draft.endScreen.textPos;
  const rows = [
    ["#endPosY", "#endPosYv", "y"],
    ["#endPosX", "#endPosXv", "x"],
    ["#endSize", "#endSizev", "size"]
  ];
  rows.forEach(([sel, out, key]) => {
    const el = $(sel);
    el.value = pos[key];
    $(out).textContent = pos[key] + (key === "size" ? "" : "px");
    el.oninput = () => {
      pos[key] = Number(el.value);
      $(out).textContent = pos[key] + (key === "size" ? "" : "px");
      drawEndPreview();
      markDirty();
    };
  });
  $("#endReset").onclick = () => {
    draft.endScreen.textPos = { x: 0, y: 0, size: 72 };
    bindEndPosition();
    drawEndPreview();
    markDirty();
  };
  drawEndPreview();
}

function drawEndPreview() {
  const box = $("#endPreview");
  if (!box) return;
  const e = draft.endScreen;
  box.classList.toggle("has-bg", !!e.image);
  box.style.backgroundImage = e.image ? 'url("' + resolveUrl(e.image) + '")' : "";

  const scale = box.clientWidth / 1920;     // 게임 무대를 이 상자 크기로 축소
  const pos = e.textPos;
  const t = $("#endPreviewText");
  t.textContent = e.text || "";
  t.style.width = (END_BOX_W * scale) + "px";
  t.style.height = (END_BOX_H * scale) + "px";
  t.style.top = ((END_BASE_TOP + pos.y) * scale) + "px";
  t.style.transform = "translateX(calc(-50% + " + (pos.x * scale) + "px))";

  // 게임과 똑같이, 넘치면 글자를 줄인다
  let size = pos.size;
  t.style.fontSize = (size * scale) + "px";
  while (size > 28 && (t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1)) {
    size -= 3;
    t.style.fontSize = (size * scale) + "px";
  }
}

window.addEventListener("resize", () => { if (draft) drawEndPreview(); });

/* ---- 이야기 페이지들 ---- */
const isFileDrag = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).indexOf("Files") >= 0;

function renderPages(kind) {
  const host = $("#pages" + kind.charAt(0).toUpperCase() + kind.slice(1));
  const list = draft[kind];
  host.innerHTML = "";

  list.forEach((page, i) => {
    const card = document.createElement("div");
    card.className = "page-card";
    card.draggable = true;
    card.innerHTML = '<div class="head"><span>' + (i + 1) + '장</span>' +
      '<span class="grip" title="끌어서 순서 바꾸기">⣿</span></div>';

    /* 파일명 + 크게 보기 */
    const info = document.createElement("div");
    info.className = "file-row";
    const nameEl = document.createElement("span");
    nameEl.className = "file-name";
    const zoom = document.createElement("button");
    zoom.type = "button";
    zoom.className = "zoom-btn";
    zoom.textContent = "🔍 크게 보기";
    zoom.onclick = () => openLightbox(kind, i);
    info.appendChild(nameEl);
    info.appendChild(zoom);
    const showName = () => {
      nameEl.textContent = page.image ? (page.name || "파일명 기록 없음") : "";
      nameEl.title = page.name || "";
      zoom.hidden = !page.image;
    };
    showName();

    const slot = document.createElement("div");
    card.appendChild(slot);
    imageSlot(slot, () => page.image,
      (v) => { page.image = v; if (!v) page.name = ""; showName(); },
      true,
      {
        setName: (n) => { page.name = n; showName(); },
        onMany: (files) => addPages(kind, files, page),
        onFail: () => renderPages(kind)
      });
    card.appendChild(info);

    const move = document.createElement("div");
    move.className = "move";
    const mk = (label, fn, on) => {
      const b = document.createElement("button");
      b.textContent = label; b.disabled = !on;
      b.onclick = fn; return b;
    };
    move.appendChild(mk("←", () => swapPage(kind, i, i - 1), i > 0));
    move.appendChild(mk("→", () => swapPage(kind, i, i + 1), i < list.length - 1));
    move.appendChild(mk("삭제", async () => {
      if (await openModal({
        title: (i + 1) + "장을 지울까요?", body: "이 장이 이야기에서 빠집니다.",
        yes: "지우기", no: "그만두기", danger: true
      })) { list.splice(i, 1); markDirty(); renderPages(kind); }
    }, true));
    card.appendChild(move);

    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", String(i));
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    card.addEventListener("dragover", (e) => {
      if (isFileDrag(e)) return;                 // 그림 파일을 끌어올 때는 순서 바꾸기가 아님
      e.preventDefault(); card.classList.add("drop-target");
    });
    card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
    card.addEventListener("drop", (e) => {
      if (isFileDrag(e)) return;
      e.preventDefault();
      card.classList.remove("drop-target");
      const raw = e.dataTransfer.getData("text/plain");
      if (raw === "") return;
      const from = Number(raw);
      if (Number.isInteger(from) && from !== i) {
        const [moved] = list.splice(from, 1);
        list.splice(i, 0, moved);
        markDirty();
        renderPages(kind);
      }
    });

    host.appendChild(card);
  });

  const add = document.createElement("button");
  add.className = "add-card";
  add.type = "button";
  add.textContent = "＋ 장 추가";
  add.onclick = () => { list.push({ image: "" }); markDirty(); renderPages(kind); };
  host.appendChild(add);

  /* 여러 장 한꺼번에 */
  const bulk = document.createElement("button");
  bulk.className = "add-card bulk-card";
  bulk.type = "button";
  bulk.innerHTML = '＋ 그림 여러 장<br>한꺼번에 올리기<small>파일 이름 순서(1, 2, 3…)대로 들어갑니다</small>';
  const bulkInput = document.createElement("input");
  bulkInput.type = "file";
  bulkInput.accept = "image/*";
  bulkInput.multiple = true;
  bulkInput.hidden = true;
  bulk.onclick = () => bulkInput.click();
  bulkInput.onchange = () => {
    const files = Array.from(bulkInput.files);
    bulkInput.value = "";
    addPages(kind, files);
  };
  bulk.addEventListener("dragover", (e) => { e.preventDefault(); bulk.classList.add("dragover"); });
  bulk.addEventListener("dragleave", () => bulk.classList.remove("dragover"));
  bulk.addEventListener("drop", (e) => {
    e.preventDefault();
    bulk.classList.remove("dragover");
    addPages(kind, Array.from(e.dataTransfer.files));
  });
  host.appendChild(bulk);
  host.appendChild(bulkInput);
}

/* 그림 여러 장을 파일 이름 순서(숫자 인식: 2 다음 10)로 정렬해서 장으로 만듭니다.
   장(카드)은 먼저 순서대로 전부 만들어 두고, 그림은 그 뒤에 한 장씩 채웁니다.
   그래서 용량이 작은 그림이 먼저 끝나도 순서가 뒤바뀌지 않습니다. */
async function addPages(kind, fileList, anchorPage) {
  const list = draft[kind];
  const files = Array.from(fileList).filter((f) => /^image\//.test(f.type))
    .sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }));
  if (!files.length) { toast("그림 파일이 아닙니다", true); return; }

  const pages = files.map((f) => ({ image: "", name: f.name }));
  if (anchorPage && list.indexOf(anchorPage) >= 0) {
    const at = list.indexOf(anchorPage);
    if (!anchorPage.image) {                    // 비어 있는 칸이면 첫 그림은 이 칸에 넣는다
      pages[0] = anchorPage;
      anchorPage.name = files[0].name;
      list.splice(at + 1, 0, ...pages.slice(1));
    } else {
      list.splice(at + 1, 0, ...pages);
    }
  } else {
    list.push(...pages);
  }
  markDirty();
  renderPages(kind);

  for (let k = 0; k < files.length; k++) {
    const page = pages[k];
    try {
      await queueUpload(files[k], (v) => { page.image = v; if (!v) page.name = ""; },
        () => renderPages(kind));
    } catch (e) {
      page.name = "";
      toast(files[k].name + ": " + e.message, true);
    }
    renderPages(kind);
  }
}

/* ---- 크게 보기 ---- */
function openLightbox(kind, startIndex) {
  const items = draft[kind].map((p, i) => ({ p: p, i: i })).filter((x) => x.p.image);
  if (!items.length) return;
  let pos = Math.max(0, items.findIndex((x) => x.i === startIndex));

  const ov = document.createElement("div");
  ov.className = "lightbox";
  ov.innerHTML = '<button type="button" class="lb-btn lb-prev" aria-label="이전 장">‹</button>' +
    '<figure><img alt="" /><figcaption></figcaption></figure>' +
    '<button type="button" class="lb-btn lb-next" aria-label="다음 장">›</button>' +
    '<button type="button" class="lb-btn lb-close" aria-label="닫기">×</button>';
  const img = ov.querySelector("img");
  const cap = ov.querySelector("figcaption");

  const show = () => {
    const it = items[pos];
    img.src = resolveUrl(it.p.image);
    cap.textContent = (it.i + 1) + "장" + (it.p.name ? " · " + it.p.name : "") +
      "   (" + (pos + 1) + " / " + items.length + ")";
  };
  const step = (d) => { pos = (pos + d + items.length) % items.length; show(); };
  const onKey = (e) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
  };
  function close() { document.removeEventListener("keydown", onKey); ov.remove(); }

  ov.querySelector(".lb-prev").onclick = (e) => { e.stopPropagation(); step(-1); };
  ov.querySelector(".lb-next").onclick = (e) => { e.stopPropagation(); step(1); };
  ov.onclick = (e) => { if (e.target === ov || e.target.closest(".lb-close")) close(); };
  document.addEventListener("keydown", onKey);
  document.body.appendChild(ov);
  show();
}

function swapPage(kind, a, b) {
  const list = draft[kind];
  const t = list[a]; list[a] = list[b]; list[b] = t;
  markDirty();
  renderPages(kind);
}

/* ---- 키워드 ---- */
function renderKeywords(round) {
  const host = $("#kwR" + round);
  const list = draft["round" + round].keywords;
  host.innerHTML = "";

  if (!list.length) {
    const p = document.createElement("div");
    p.className = "empty";
    p.textContent = "아직 키워드가 없습니다. 아래 버튼으로 추가해주세요.";
    host.appendChild(p);
  }

  list.forEach((kw, i) => {
    const row = document.createElement("div");
    row.className = "kw" + (kw.correct !== false ? " is-correct" : "");

    const slot = document.createElement("div");
    row.appendChild(slot);
    imageSlot(slot, () => kw.image, (v) => kw.image = v, true);

    const name = document.createElement("input");
    name.type = "text";
    name.placeholder = "키워드 이름 (예: 노랑)";
    name.value = kw.label || "";
    name.oninput = () => { kw.label = name.value; markDirty(); };
    row.appendChild(name);

    const check = document.createElement("label");
    check.className = "kw-check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = kw.correct !== false;
    cb.onchange = () => { kw.correct = cb.checked; markDirty(); renderKeywords(round); };
    check.appendChild(cb);
    check.appendChild(document.createTextNode("모아야 하는 재료"));
    row.appendChild(check);

    const del = document.createElement("button");
    del.className = "btn btn-sm btn-danger";
    del.textContent = "삭제";
    del.onclick = () => { list.splice(i, 1); markDirty(); renderKeywords(round); };
    row.appendChild(del);

    host.appendChild(row);
  });
}

/* ---------------------------------------------------------------- 저장 */
function computeStatus() {
  const r1 = draft.round1, r2 = draft.round2;
  const filled =
    draft.opening.length && draft.middle.length && draft.ending.length &&
    draft.opening.every((p) => p.image) &&
    draft.middle.every((p) => p.image) &&
    draft.ending.every((p) => p.image) &&
    [r1, r2].every((r) =>
      r.title && r.recipeImage && r.playerImage && r.resultImage &&
      r.keywords.length && r.keywords.every((k) => k.label && k.image) &&
      r.keywords.some((k) => k.correct !== false));
  return filled ? "완료" : "작성 중";
}

async function save() {
  if (busy || !current) return;
  busy = true;
  $("#btnSave").disabled = true;
  try {
    if (pendingUploads > 0) {
      setStatus("그림 올리기가 끝나길 기다리는 중...");
      while (pendingUploads > 0) await uploadQueue;
    }
    setStatus("저장하는 중...");
    draft.status = computeStatus();
    draft.updatedAt = new Date().toISOString().slice(0, 10);
    await GH.putJSON("data/weeks/week" + pad(current) + ".json", draft,
      current + "회차 저장");
    weeksInfo[current] = { exists: true, status: draft.status };
    dirty = false;
    localStorage.removeItem("pureum.draft." + current);
    renderWeeks();
    renderAll();
    const now = new Date();
    setStatus("저장됨 · " + now.getHours() + "시 " + pad(now.getMinutes()) + "분");
    toast("저장했습니다");
    return true;
  } catch (e) {
    toast(e.message, true);
    setStatus("저장하지 못했습니다");
    return false;
  } finally {
    busy = false;
    $("#btnSave").disabled = false;
  }
}

/* ---------------------------------------------------------------- 미리보기 */
function preview() {
  if (!current) return;
  const c = GH.config();
  localStorage.setItem("pureum.preview", JSON.stringify({
    data: draft,
    rawBase: "https://raw.githubusercontent.com/" + c.owner + "/" + c.repo + "/" + c.branch + "/"
  }));
  window.open("../index.html?preview=local", "_blank");
}

/* ---------------------------------------------------------------- 게임에 적용 */
async function publish() {
  if (busy || !current) return;
  if (dirty) {
    const ok = await openModal({
      title: "먼저 저장할까요?",
      body: "저장하지 않은 변경사항이 있습니다. 저장한 다음 적용합니다.",
      yes: "저장하고 계속", no: "그만두기"
    });
    if (!ok) return;
    if (!(await save())) return;
  }

  if (computeStatus() !== "완료") {
    const go = await openModal({
      title: "아직 비어 있는 칸이 있습니다",
      body: "그림이나 글이 빠진 곳이 있습니다. 이대로 적용하면 게임 화면 일부가 비어 보일 수 있습니다.",
      yes: "그래도 적용", no: "돌아가서 채우기", danger: true
    });
    if (!go) return;
  }

  const changing = liveWeek && liveWeek !== current
    ? "지금 아이들이 보는 <b>" + liveWeek + "회차</b>가 <b>" + current + "회차</b>로 바뀝니다."
    : "이 회차가 아이들이 보는 게임이 됩니다.";
  const ok = await openModal({
    title: current + "회차를 게임에 적용할까요?",
    body: changing + "<br>이전 회차 내용은 그대로 보관되며, 언제든 다시 적용할 수 있습니다.",
    yes: current + "회차 적용하기"
  });
  if (!ok) return;

  busy = true;
  $("#btnPublish").disabled = true;
  setStatus("게임에 적용하는 중...");
  try {
    await GH.putJSON("data/live/week" + pad(current) + ".json", draft,
      current + "회차 적용본 갱신");
    await GH.putJSON("data/published.json",
      { week: current, publishedAt: new Date().toISOString() },
      "게임 적용 회차를 " + current + "회차로 변경");
    liveWeek = current;
    renderWeeks();
    $("#liveNow").innerHTML = '<span class="live-dot"></span>지금 게임: ' + liveWeek + "회차";
    setStatus("적용했습니다");
    toast(current + "회차를 적용했습니다. 아이들 화면에는 1~2분 뒤 반영됩니다.");
  } catch (e) {
    toast(e.message, true);
    setStatus("적용하지 못했습니다");
  } finally {
    busy = false;
    $("#btnPublish").disabled = false;
  }
}

/* ---------------------------------------------------------------- 회차 복제 */
async function copyFrom() {
  if (pendingUploads > 0) {
    toast("그림을 올리는 중입니다. 끝난 뒤에 가져와주세요.", true);
    return;
  }
  const options = [];
  for (let n = 1; n <= WEEK_COUNT; n++) {
    if (n !== current && weeksInfo[n].exists) {
      options.push('<option value="' + n + '">' + n + "회차 (" + weeksInfo[n].status + ")</option>");
    }
  }
  if (!options.length) {
    toast("복제할 회차가 아직 없습니다", true);
    return;
  }
  const ok = await openModal({
    title: current + "회차에 복제해오기",
    body: "고른 회차의 내용을 그대로 가져옵니다. 바뀌는 그림과 글만 손보면 됩니다." +
      '<br><br><select id="copySrc" style="width:100%;padding:9px;border:1.5px solid var(--line);' +
      'border-radius:8px">' + options.join("") + "</select>",
    yes: "가져오기"
  });
  if (!ok) return;
  const src = Number(document.getElementById("copySrc") &&
    document.getElementById("copySrc").value) || Number(options[0].match(/value="(\d+)"/)[1]);

  busy = true;
  setStatus(src + "회차를 가져오는 중...");
  try {
    const file = await GH.get("data/weeks/week" + pad(src) + ".json");
    if (!file || !file.json) throw new Error(src + "회차를 읽지 못했습니다.");
    draft = JSON.parse(JSON.stringify(file.json));
    draft.week = current;
    normalizeEnd();
    draft.status = "작성 중";
    markDirty();
    renderAll();
    setStatus(src + "회차 내용을 가져왔습니다. 저장을 눌러야 남습니다.");
    toast(src + "회차를 가져왔습니다");
  } catch (e) {
    toast(e.message, true);
  } finally { busy = false; }
}

/* ---- 화면 보정 스타일 (이야기 그림을 크게, 파일명·크게보기·확대창 꾸미기) ---- */
(function injectFixStyles() {
  const s = document.createElement("style");
  s.textContent = `
  .pages{display:grid!important;grid-template-columns:repeat(auto-fill,minmax(min(400px,100%),1fr))!important;gap:18px!important}
  .page-card .drop{width:100%!important;height:auto!important;min-height:0!important;aspect-ratio:16/9}
  .page-card .drop img{width:100%;height:100%;object-fit:contain;display:block}
  .file-row{display:flex;align-items:center;gap:8px;margin:8px 0 8px;min-height:30px}
  .file-name{flex:1;min-width:0;font-size:13px;color:#6b6480;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .zoom-btn{flex:none;font:inherit;font-size:13px;padding:5px 10px;border:1.5px solid #d9d6e8;border-radius:8px;background:#fff;cursor:pointer}
  .zoom-btn:hover{background:#f3f1fb}
  .zoom-btn[hidden]{display:none}
  .bulk-card{line-height:1.5}
  .bulk-card small{display:block;margin-top:8px;font-size:12px;font-weight:400;opacity:.75}
  .bulk-card.dragover{background:#eeeaff}
  .lightbox{position:fixed;inset:0;z-index:10000;background:rgba(20,16,30,.9);display:flex;align-items:center;justify-content:center;gap:12px;padding:16px}
  .lightbox figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:10px;max-width:calc(100vw - 150px)}
  .lightbox img{max-width:100%;max-height:calc(100vh - 90px);object-fit:contain;background:#fff;border-radius:8px}
  .lightbox figcaption{color:#fff;font-size:14px}
  .lb-btn{border:0;background:rgba(255,255,255,.18);color:#fff;font-size:34px;line-height:1;width:52px;height:52px;border-radius:50%;cursor:pointer;flex:none}
  .lb-btn:hover{background:rgba(255,255,255,.32)}
  .lb-close{position:absolute;top:14px;right:14px;font-size:30px}
  `;
  document.head.appendChild(s);
})();

/* ---------------------------------------------------------------- 시작 */
$("#btnLogin").onclick = tryLogin;
$("#fToken").addEventListener("keydown", (e) => { if (e.key === "Enter") tryLogin(); });
$("#btnLogout").onclick = async () => {
  if (dirty && !(await openModal({
    title: "저장하지 않은 변경사항이 있습니다",
    body: "로그아웃하면 이 브라우저에 남은 작업은 다음에 다시 열 때 불러올 수 있습니다.",
    yes: "로그아웃", no: "돌아가기", danger: true
  }))) return;
  GH.clear();
  location.reload();
};
$("#btnSave").onclick = save;
$("#btnPreview").onclick = preview;
$("#btnPublish").onclick = publish;
$("#btnCopy").onclick = copyFrom;

document.querySelectorAll("[data-addkw]").forEach((b) => {
  b.onclick = () => {
    const r = Number(b.dataset.addkw);
    draft["round" + r].keywords.push({ label: "", image: "", correct: true });
    markDirty();
    renderKeywords(r);
  };
});

document.querySelectorAll(".steps button").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll(".steps button").forEach((x) => x.removeAttribute("aria-current"));
    b.setAttribute("aria-current", "true");
    document.getElementById(b.dataset.go).scrollIntoView({ behavior: "smooth", block: "start" });
  };
});

window.addEventListener("beforeunload", (e) => {
  if (dirty || pendingUploads > 0) { e.preventDefault(); e.returnValue = ""; }
});

(function boot() {
  const c = GH.load();
  $("#fOwner").value = c.owner || "";
  $("#fRepo").value = c.repo || "";
  if (GH.isReady()) {
    $("#gate").classList.add("hidden");
    $("#app").classList.remove("hidden");
    loadIndex().catch((e) => {
      GH.clear();
      location.reload();
    });
  }
})();
