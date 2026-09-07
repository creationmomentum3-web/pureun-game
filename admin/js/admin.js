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
    }
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

    const local = localStorage.getItem("pureum.draft." + n);
    if (local) {
      const use = await openModal({
        title: n + "회차에 저장하지 않은 작업이 있습니다",
        body: "이전에 이 브라우저에서 편집하다 저장하지 않은 내용이 남아 있습니다. 불러올까요?",
        yes: "불러오기", no: "버리기"
      });
      if (use) { draft = JSON.parse(local); draft.week = n; }
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

  bindText("#r1title", () => draft.round1.title, (v) => draft.round1.title = v);
  bindText("#r1note", () => draft.round1.note.replace(/<br\s*\/?>/g, "\n"),
    (v) => draft.round1.note = v.replace(/\n/g, "<br>"));
  bindText("#r1resultName", () => draft.round1.resultName, (v) => draft.round1.resultName = v);
  bindText("#r2title", () => draft.round2.title, (v) => draft.round2.title = v);
  bindText("#r2note", () => draft.round2.note.replace(/<br\s*\/?>/g, "\n"),
    (v) => draft.round2.note = v.replace(/\n/g, "<br>"));
  bindText("#r2resultName", () => draft.round2.resultName, (v) => draft.round2.resultName = v);

  const ov = $("#r2overlay");
  ov.checked = draft.round2.showKeywordOverlay !== false;
  ov.onchange = () => { draft.round2.showKeywordOverlay = ov.checked; markDirty(); };
}

function bindText(sel, get, set) {
  const el = $(sel);
  el.value = get() || "";
  el.oninput = () => { set(el.value); markDirty(); };
}

/* ---- 이미지 한 칸 ---- */
function imageSlot(target, get, set, small) {
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
  box.appendChild(input);

  const upload = async (file) => {
    if (!file) return;
    try {
      busy = true;
      setStatus("그림을 올리는 중...");
      const img = await prepareImage(file);
      box.innerHTML = '<img src="' + img.preview + '" alt="" />';
      box.appendChild(input);
      const path = "content/week" + pad(current) + "/img-" + Date.now() +
        "-" + Math.random().toString(36).slice(2, 6) + ".webp";
      await GH.put(path, img.base64, "그림 추가: " + path);
      set(path);
      markDirty();
      setStatus("그림을 올렸습니다");
    } catch (e) {
      toast(e.message, true);
      setStatus("그림 올리기에 실패했습니다");
    } finally { busy = false; }
  };

  input.onchange = () => upload(input.files[0]);
  box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("dragover"); });
  box.addEventListener("dragleave", () => box.classList.remove("dragover"));
  box.addEventListener("drop", (e) => {
    e.preventDefault();
    box.classList.remove("dragover");
    upload(e.dataTransfer.files[0]);
  });

  host.appendChild(box);
  if (!small && get()) {
    const acts = document.createElement("div");
    acts.className = "thumb-actions";
    const del = document.createElement("button");
    del.className = "btn btn-sm btn-danger";
    del.textContent = "그림 지우기";
    del.onclick = () => { set(""); markDirty(); imageSlot(host, get, set, small); };
    acts.appendChild(del);
    host.appendChild(acts);
  }
}

/* 저장된 경로는 저장소 기준입니다. 관리자 화면에서는 GitHub 원본 주소로 바꿔서 봅니다. */
function resolveUrl(p) {
  if (!p || /^https?:|^data:/.test(p)) return p;
  const c = GH.config();
  return "https://raw.githubusercontent.com/" + c.owner + "/" + c.repo + "/" + c.branch + "/" + p;
}

/* ---- 이야기 페이지들 ---- */
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

    const slot = document.createElement("div");
    card.appendChild(slot);
    imageSlot(slot, () => page.image, (v) => page.image = v, true);

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
    card.addEventListener("dragover", (e) => { e.preventDefault(); card.classList.add("drop-target"); });
    card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("drop-target");
      const from = Number(e.dataTransfer.getData("text/plain"));
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
  add.textContent = "＋ 장 추가";
  add.onclick = () => { list.push({ image: "" }); markDirty(); renderPages(kind); };
  host.appendChild(add);
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
  setStatus("저장하는 중...");
  try {
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
    draft.status = "작성 중";
    markDirty();
    renderAll();
    setStatus(src + "회차 내용을 가져왔습니다. 저장을 눌러야 남습니다.");
    toast(src + "회차를 가져왔습니다");
  } catch (e) {
    toast(e.message, true);
  } finally { busy = false; }
}

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
  if (dirty) { e.preventDefault(); e.returnValue = ""; }
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
