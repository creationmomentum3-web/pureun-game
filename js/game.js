"use strict";

/* 회차별 콘텐츠 — content-loader.js 가 런타임에 채워 넣는다 */
const GAME_CONFIG = { week:0, round1:null, round2:null,
  wrongKeywords:[], story:{opening:[],middle:[],ending:[]} };

/* =========================================================
   2) 게임 수치 — 속도/크기/좌표는 이 블록에서 수정
========================================================= */
const GAME_SETTINGS = {
  width: 1920,
  height: 1080,
  playerSpeed: 520,
  keywordFallSpeed: 185,
  keywordSpawnInterval: 1450,
  keywordMaxWidth: 150,
  keywordMaxHeight: 110,
  // 판정은 캐릭터 전체가 아니라 보라색 솥 입구에만 적용
  catchWidth: 154,
  catchHeight: 36,
  catchXOffsetRound1: -66,
  catchXOffsetRound2: 26,
  catchYRound1: 930,
  catchYRound2: 942,
  playerStartX: 960,
  playerMinX: 140,
  playerMaxX: 1780,
  correctTotalRound1: 4, // 1R: 4종 중 각 1개만 모으면 완료 (각 키워드는 2회 등장)
  correctTotalRound2: 4, // 2R: 4종 중 각 1개만 모으면 완료 (각 키워드는 2회 등장)
  totalKeywords: 20,
  life: 3,
  speechDuration: 800,
  lanes: [300,520,740,960,1180,1400,1620]
};

/* 에셋 — 고정분은 assets-fixed.js, 회차분은 content-loader.js 가 주입 */
const ASSETS = { story:{} };
const COUNTDOWN_VOICE = {};
const BGM_ASSETS = {};
Object.assign(ASSETS, window.FIXED_IMAGES);
Object.assign(ASSETS.story, window.FIXED_STORY_IMAGES);
Object.assign(COUNTDOWN_VOICE, window.FIXED_COUNTDOWN);
Object.assign(BGM_ASSETS, window.FIXED_BGM);

/* =========================================================
   런타임 상태
========================================================= */
const $ = (q)=>document.querySelector(q);
const $$ = (q)=>[...document.querySelectorAll(q)];
const game = $("#game");
const screens = $$(".screen");

const state = {
  screen:"mainScreen",
  currentRound:1,
  storyType:"opening",
  storyPage:0,
  storyTurning:false,
  playerX:GAME_SETTINGS.playerStartX,
  keys:{left:false,right:false},
  playing:false,
  paused:false,
  lives:GAME_SETTINGS.life,
  collected:0,
  counts:{},
  items:[],
  spawnQueue:[],
  spawned:0,
  spawnTimer:null,
  raf:null,
  lastTs:0,
  lastLane:null,
  audioOn:true,
  audioCtx:null,
  masterGain:null,
  volume:.32,
  lastNonZeroVolume:.32,
  ambientTimer:null,
  resultTimers:[]
};

let storyPageFlip=null;
let storyFlipUnlockTimer=null;

function getStoryImageKeys(){
  const t=state.storyType;
  if(!["opening","middle","ending"].includes(t)) return null;
  const pages=GAME_CONFIG.story[t]||[];
  return pages.map((_,i)=>`${t}_${i+1}`);
}
function destroyStoryPageFlip(){
  if(storyFlipUnlockTimer){
    clearTimeout(storyFlipUnlockTimer);
    storyFlipUnlockTimer=null;
  }
  if(storyPageFlip && typeof storyPageFlip.destroy === "function"){
    try{ storyPageFlip.destroy(); }catch(err){}
  }
  storyPageFlip=null;
  state.storyTurning=false;
}
function updateStoryHint(){
  const hint=$("#storyClickHint");
  if(!hint) return;
  const keys=getStoryImageKeys();
  if(!keys) return;
  hint.textContent = state.storyPage>=keys.length-1 ? "클릭해서 다음 화면으로" : "클릭해서 다음 장면 보기";
}
function syncStoryPageIndex(){
  const keys=getStoryImageKeys();
  if(!keys) return;
  if(storyPageFlip && typeof storyPageFlip.getCurrentPageIndex === "function"){
    const idx=storyPageFlip.getCurrentPageIndex();
    if(Number.isFinite(idx)) state.storyPage=idx;
  }
  const fallback=$("#storyPageFlipFallback");
  if(fallback && ASSETS.story[keys[state.storyPage]]){
    fallback.src=ASSETS.story[keys[state.storyPage]];
    fallback.alt=`스토리 장면 ${state.storyPage+1}`;
  }
  $("#storyPageNum").textContent=`${state.storyPage+1} / ${keys.length}`;
  updateStoryHint();
}
function unlockStoryAfterFlip(){
  if(storyFlipUnlockTimer) clearTimeout(storyFlipUnlockTimer);
  storyFlipUnlockTimer=setTimeout(()=>{
    syncStoryPageIndex();
    state.storyTurning=false;
    storyFlipUnlockTimer=null;
  }, 1180);
}
function initStoryPageFlip(){
  const wrap=$("#storyCuts");
  const keys=getStoryImageKeys();
  destroyStoryPageFlip();
  wrap.innerHTML="";
  wrap.style.display="block";

  const fallback=document.createElement("img");
  fallback.id="storyPageFlipFallback";
  fallback.className="story-pageflip-fallback";
  fallback.alt=`스토리 장면 ${state.storyPage+1}`;
  applyImage(fallback, ASSETS.story[keys[state.storyPage]]);
  wrap.appendChild(fallback);

  const root=document.createElement("div");
  root.id="storyPageFlipRoot";
  root.className="story-pageflip-root";
  wrap.appendChild(root);

  const hint=document.createElement("div");
  hint.id="storyClickHint";
  hint.className="story-click-hint";
  wrap.appendChild(hint);

  const clickLayer=document.createElement("button");
  clickLayer.type="button";
  clickLayer.className="story-opening-click";
  clickLayer.setAttribute("aria-label","스토리 다음 페이지");
  clickLayer.addEventListener("click",(e)=>{
    e.preventDefault();
    e.stopPropagation();
    syncStoryPageIndex();
    const total=keys.length;
    if(!state.storyTurning && state.storyPage>=total-1){
      storyNextDestination();
      return;
    }
    advanceStory();
  });
  wrap.appendChild(clickLayer);

  const pageSources=keys.map((key)=>ASSETS.story[key]).filter(Boolean);

  if(window.St && window.St.PageFlip){
    // 이미지 캔버스 재렌더링(loadFromImages)을 사용하지 않고,
    // 원본 PNG를 DOM <img>로 유지하는 soft HTML page를 사용한다.
    const htmlPages=pageSources.map((src,index)=>{
      const page=document.createElement("div");
      page.className="story-html-page";
      page.setAttribute("data-density","soft");
      const img=document.createElement("img");
      img.src=src;
      img.alt=`스토리 장면 ${index+1}`;
      img.decoding="sync";
      img.draggable=false;
      page.appendChild(img);
      root.appendChild(page);
      return page;
    });

    storyPageFlip=new window.St.PageFlip(root,{
      width:1920,
      height:1080,
      size:"stretch",
      minWidth:1920,
      maxWidth:1920,
      minHeight:1080,
      maxHeight:1080,
      drawShadow:true,
      maxShadowOpacity:0.42,
      showCover:false,
      flippingTime:1100,
      usePortrait:true,
      mobileScrollSupport:false,
      autoSize:false,
      startZIndex:1
    });
    storyPageFlip.loadFromHTML(htmlPages);
    if(typeof storyPageFlip.turnToPage === "function" && state.storyPage>0){
      storyPageFlip.turnToPage(state.storyPage);
    }
    if(typeof storyPageFlip.on === "function"){
      storyPageFlip.on("flip",()=>{ syncStoryPageIndex(); });
    }
    // StPageFlip이 초기화되면 뒤의 fallback은 필요 없지만,
    // 투명하게 남겨 두어 페이지 생성 순간의 빈 화면을 방지한다.
    requestAnimationFrame(()=>{ fallback.style.visibility="hidden"; });
    syncStoryPageIndex();
  }else{
    updateStoryHint();
  }
}

const TUTORIAL_IMAGE_KEYS=["tutorial_full_01","tutorial_full_02","tutorial_full_03","tutorial_full_04","tutorial_full_05"];
let tutorialPageIndex=0;

function syncTutorialPage(){
  const fallback=$("#tutorialFallback");
  const src=ASSETS.story[TUTORIAL_IMAGE_KEYS[tutorialPageIndex]];
  if(fallback && src){
    applyImage(fallback,src);
    fallback.alt=`게임 방법 ${tutorialPageIndex+1}`;
  }
  const guide=$("#tutorialPageGuide");
  if(guide) guide.textContent=`${tutorialPageIndex+1} / ${TUTORIAL_IMAGE_KEYS.length}`;
}
function openTutorialViewer(){
  tutorialPageIndex=0;
  const root=$("#tutorialFlipRoot");
  if(root) root.innerHTML="";
  $("#tutorialPopup").classList.add("show");
  syncTutorialPage();
}
function closeTutorialViewer(){
  $("#tutorialPopup").classList.remove("show");
}
function advanceTutorial(){
  if(tutorialPageIndex>=TUTORIAL_IMAGE_KEYS.length-1){
    closeTutorialViewer();
    return;
  }
  tutorialPageIndex++;
  syncTutorialPage();
  sfx("page");
}

function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }
function shuffle(arr){
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
function showScreen(id){
  cleanupTransient();
  screens.forEach(s=>s.classList.toggle("active",s.id===id));
  state.screen=id;
  applyBackgrounds();
  updateBgm();
}
function cleanupTransient(){
  state.resultTimers.forEach(clearTimeout); state.resultTimers=[];
}
function later(fn,ms){ const t=setTimeout(fn,ms); state.resultTimers.push(t); return t; }

/* =========================================================
   스케일링: 내부 1920×1080 고정, 전체만 동일 비율 확대/축소
========================================================= */
function resizeGame(){
  const scale=Math.min(window.innerWidth/GAME_SETTINGS.width,window.innerHeight/GAME_SETTINGS.height);
  game.style.transform=`translate(-50%,-50%) scale(${scale})`;
}
window.addEventListener("resize",resizeGame);
resizeGame();

/* =========================================================
   에셋 로딩 + 실패 시 fallback
========================================================= */
const assetStatus = new Map();
function testAsset(src){
  if(assetStatus.has(src)) return assetStatus.get(src);
  const p=new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>resolve(true);
    img.onerror=()=>{
      console.error("[ASSET ERROR]",src,"not found");
      resolve(false);
    };
    img.src=src;
  });
  assetStatus.set(src,p);
  return p;
}
async function applyImage(img,src,onFail){
  img.style.display="block";
  img.src=src;
  const ok=await testAsset(src);
  if(!ok){
    img.style.display="none";
    if(onFail) onFail();
  }
  return ok;
}
async function setBackground(el,src){
  const ok=await testAsset(src);
  el.style.backgroundImage=ok?`url("${src}")`:"";
}
function applyBackgrounds(){
  const map={
    main:ASSETS.mainBg,recipe:ASSETS.recipeBg,play:ASSETS.playBg,
    fail:state.currentRound===1?ASSETS.fail1Bg:ASSETS.fail2Bg,
    clear1:ASSETS.clear1Bg,clear2:ASSETS.clear2Bg,end:ASSETS.endBg
  };
  $$("[data-bg]").forEach(el=>setBackground(el,map[el.dataset.bg]));
}
function initStaticAssets(){
  $$("img[data-asset]").forEach(img=>{
    const key=img.dataset.asset;
    const fallbackLabel = img.parentElement ? img.parentElement.querySelector(".fallback-label") : null;
    if(fallbackLabel) fallbackLabel.style.display="flex";
    applyImage(img,ASSETS[key],()=>{
      if(fallbackLabel) fallbackLabel.style.display="flex";
    }).then(ok=>{
      if(fallbackLabel) fallbackLabel.style.display=ok?"none":"flex";
      if(key==="scoreboard"){
        const fb=$("#scoreboard .scoreboard-fallback");
        if(fb) fb.style.display=ok?"none":"block";
      }
    });
  });
}

/* =========================================================
   사운드
========================================================= */
function ensureAudio(){
  if(!state.audioCtx){
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(Ctx){
      state.audioCtx=new Ctx();
      state.masterGain=state.audioCtx.createGain();
      state.masterGain.gain.value=state.audioOn?state.volume:0;
      state.masterGain.connect(state.audioCtx.destination);
    }
  }
  if(state.audioCtx && state.audioCtx.state==="suspended") state.audioCtx.resume();
}
function updateMasterVolume(){
  ensureAudio();
  if(!state.audioCtx||!state.masterGain) return;
  const target=state.audioOn?state.volume:0;
  const now=state.audioCtx.currentTime;
  state.masterGain.gain.cancelScheduledValues(now);
  state.masterGain.gain.setTargetAtTime(target,now,.025);
  const slider=$("#volumeSlider"), label=$("#volumeValue"), toggle=$("#soundToggle");
  if(slider) slider.value=Math.round(state.volume*100);
  if(label) label.textContent=`${Math.round(state.volume*100)}%`;
  if(toggle) toggle.textContent=state.audioOn&&state.volume>0?"🔊":"🔇";
}
function tone(freq=440,duration=.1,type="sine",gain=.055,offset=0){
  if(!state.audioOn||state.volume<=0) return;
  ensureAudio();
  const ctx=state.audioCtx;
  if(!ctx||!state.masterGain) return;
  const osc=ctx.createOscillator(), g=ctx.createGain();
  osc.type=type; osc.frequency.value=freq;
  const t=ctx.currentTime+offset;
  g.gain.setValueAtTime(.0001,t);
  g.gain.exponentialRampToValueAtTime(Math.max(.0002,gain),t+.012);
  g.gain.exponentialRampToValueAtTime(.0001,t+duration);
  osc.connect(g).connect(state.masterGain);
  osc.start(t); osc.stop(t+duration+.03);
}
function poing(){
  if(!state.audioOn||state.volume<=0) return;
  ensureAudio();
  const ctx=state.audioCtx;
  if(!ctx||!state.masterGain) return;
  const t=ctx.currentTime;
  const osc=ctx.createOscillator(), g=ctx.createGain();
  osc.type="sine";
  osc.frequency.setValueAtTime(760,t);
  osc.frequency.exponentialRampToValueAtTime(1040,t+.028);
  osc.frequency.exponentialRampToValueAtTime(620,t+.105);
  g.gain.setValueAtTime(.0001,t);
  g.gain.exponentialRampToValueAtTime(.052,t+.012);
  g.gain.exponentialRampToValueAtTime(.0001,t+.125);
  osc.connect(g).connect(state.masterGain);
  osc.start(t); osc.stop(t+.14);
}
function sfx(type){
  if(type==="click"){poing();return;}
  if(type==="page"){tone(330,.08,"triangle",.022);tone(440,.10,"triangle",.017,.05)}
  if(type==="correct"){tone(880,.09,"sine",.15);tone(1109,.09,"sine",.15,.06);tone(1319,.12,"sine",.15,.12);tone(1760,.18,"sine",.12,.19)}
  if(type==="wrong"){tone(880,.09,"square",.09);tone(880,.09,"square",.09,.13)}
  if(type==="success"){tone(523,.14,"sine",.04);tone(659,.14,"sine",.04,.12);tone(784,.28,"sine",.045,.24)}
  if(type==="fail"){tone(260,.16,"triangle",.035);tone(196,.24,"triangle",.035,.13)}
  if(type==="magic"){tone(390,.15,"sine",.025);tone(520,.18,"sine",.022,.10);tone(700,.24,"sine",.022,.22)}
  if(type==="scroll"){tone(480,.1,"triangle",.025);tone(720,.22,"sine",.025,.09)}
}
const bgmEls={};
let currentBgmKey=null;
function bgmKeyForScreen(id){
  if(id==="playScreen") return "play";
  if(id==="storyScreen") return "story";
  if(id==="failScreen") return "fail";
  return "ambient";
}
function getBgmEl(key){
  if(!bgmEls[key]){
    const el=new Audio(BGM_ASSETS[key]);
    el.loop=true;
    el.preload="auto";
    bgmEls[key]=el;
  }
  return bgmEls[key];
}
function applyBgmVolume(){
  const vol=state.audioOn?state.volume:0;
  Object.values(bgmEls).forEach(el=>{ el.volume=vol; });
}
function updateBgm(){
  const key=bgmKeyForScreen(state.screen);
  if(key!==currentBgmKey){
    if(currentBgmKey&&bgmEls[currentBgmKey]) bgmEls[currentBgmKey].pause();
    currentBgmKey=key;
  }
  const el=getBgmEl(key);
  applyBgmVolume();
  if(state.audioOn&&state.volume>0){
    if(el.paused) el.play().catch(()=>{});
  }else{
    el.pause();
  }
}
function bindButtonSounds(){
  const root=$("#game");
  if(!root||root.dataset.poingBound==="1") return;
  root.dataset.poingBound="1";
  root.addEventListener("pointerdown",e=>{
    const btn=e.target.closest("button");
    if(btn) poing();
    updateBgm();
  },true);
}
$("#soundToggle").addEventListener("click",()=>{
  ensureAudio();
  if(state.audioOn){
    state.audioOn=false;
  }else{
    state.audioOn=true;
    if(state.volume<=0) state.volume=state.lastNonZeroVolume||.32;
  }
  updateMasterVolume();
  updateBgm();
});
$("#volumeSlider").addEventListener("input",e=>{
  ensureAudio();
  const v=Math.max(0,Math.min(1,Number(e.target.value)/100));
  state.volume=v;
  if(v>0){state.lastNonZeroVolume=v;state.audioOn=true;}
  else{state.audioOn=false;}
  updateMasterVolume();
  updateBgm();
});

/* =========================================================
   스토리 뷰어 — opening / middle / ending 공통
========================================================= */
function openStory(type,page=0){
  stopGame();
  destroyStoryPageFlip();
  state.storyType=type;
  state.storyPage=page;
  state.storyTurning=false;
  showScreen("storyScreen");
  renderStory();
}
function storyNextDestination(){
  destroyStoryPageFlip();
  if(state.storyType==="opening") showScreen("round1IntroScreen");
  else if(state.storyType==="middle") openRecipe(2);
  else showScreen("endScreen");
}
function renderStory(){
  const pages=GAME_CONFIG.story[state.storyType];
  const page=pages[state.storyPage];
  const shell=$(".story-shell");
  const book=$("#storyBook");
  const wrap=$("#storyCuts");
  const pageFlipMode = ["opening","middle","ending"].includes(state.storyType);

  shell.classList.toggle("opening-mode", pageFlipMode);
  book.classList.toggle("opening-mode", pageFlipMode);
  $("#storyTitle").textContent=page.title || "이야기";
  const storyKeys=getStoryImageKeys();
  $("#storyPageNum").textContent=`${state.storyPage+1} / ${storyKeys ? storyKeys.length : pages.length}`;
  wrap.innerHTML="";

  if(pageFlipMode){
    initStoryPageFlip();
    return;
  }

  destroyStoryPageFlip();
  wrap.style.display="grid";
  page.cuts.forEach(([assetKey,text,icon])=>{
    const cut=document.createElement("div"); cut.className="story-cut";
    const visual=document.createElement("div"); visual.className="story-visual";
    const placeholder=document.createElement("div"); placeholder.className="placeholder-art";
    placeholder.innerHTML=`<div class="scene-icon">${icon}</div>`;
    visual.appendChild(placeholder);
    const img=document.createElement("img");
    img.alt="스토리 이미지";
    img.style.position="absolute"; img.style.inset="0";
    visual.appendChild(img);
    const storySrc=ASSETS.story[assetKey];
    if(storySrc) applyImage(img,storySrc);
    const txt=document.createElement("div"); txt.className="story-text"; txt.textContent=text;
    cut.append(visual,txt); wrap.appendChild(cut);
  });
}
function advanceStory(){
  const pages=GAME_CONFIG.story[state.storyType];
  const storyKeys=getStoryImageKeys();
  const pageCount=storyKeys ? storyKeys.length : pages.length;
  if(state.storyTurning) return;
  if(state.storyPage>=pageCount-1){ storyNextDestination(); return; }
  sfx("page");
  const book=$("#storyBook");
  const pageFlipMode = ["opening","middle","ending"].includes(state.storyType);

  if(pageFlipMode){
    if(storyPageFlip && typeof storyPageFlip.flipNext === "function"){
      state.storyTurning=true;
      storyPageFlip.flipNext();
      unlockStoryAfterFlip();
    }else{
      state.storyPage=Math.min(state.storyPage+1,pages.length-1);
      renderStory();
    }
    return;
  }

  const swapDelay = 280;
  const animDuration = 560;
  state.storyTurning=true;
  book.classList.add("flipping");
  setTimeout(()=>{
    state.storyPage++;
    renderStory();
  },swapDelay);
  setTimeout(()=>{
    book.classList.remove("flipping");
    state.storyTurning=false;
  },animDuration);
}
$("#storyBook").addEventListener("click",advanceStory);
$("#storySkip").addEventListener("click",(e)=>{
  e.stopPropagation();
  storyNextDestination();
});

/* =========================================================
   메인 / 안내 / 레시피
========================================================= */
$("#mainStart").addEventListener("click",()=>{ensureAudio();openStory("opening",0)});
$("#tutorialBtn").addEventListener("click",openTutorialViewer);
$("#tutorialAdvance").addEventListener("click",advanceTutorial);
$("#tutorialClose").addEventListener("click",(e)=>{e.stopPropagation();closeTutorialViewer();});
$("#round1IntroStart").addEventListener("click",()=>openRecipe(1));

async function openRecipe(round){
  stopGame();
  state.currentRound=round;
  const cfg=round===1?GAME_CONFIG.round1:GAME_CONFIG.round2;
  $("#recipeTitle").textContent=cfg.title;
  $("#recipeNote").innerHTML=cfg.note||"";

  const overlay=$("#recipeKeywordOverlay");
  overlay.innerHTML="";
  if(cfg.showKeywordOverlay){
    overlay.classList.remove("hidden");
    overlay.style.setProperty("--kw-count",cfg.correctKeywords.length);
    cfg.correctKeywords.forEach(k=>{
      const el=document.createElement("img");
      el.alt=k.label||"";
      overlay.appendChild(el);
      applyImage(el,ASSETS[k.asset]);
    });
  }else{
    overlay.classList.add("hidden");
  }

  const img=$("#recipeImage"), fb=$("#recipeFallback");
  fb.classList.add("hidden");
  const ok=await applyImage(img,ASSETS[cfg.recipeAsset],()=>{
    fb.classList.remove("hidden");
    fb.innerHTML=`<h3>${round===1?"친구 레시피":"활동 레시피"}</h3><div class="kw">${cfg.correctKeywords.map(k=>`${k.label} × 1`).join("<br>")}</div>`;
  });
  if(ok) fb.classList.add("hidden");
  showScreen("recipeScreen");
}
$("#recipeStartBtn").addEventListener("click",startCountdown);

function playCountdownVoice(label){
  if(!state.audioOn) return;
  const src=COUNTDOWN_VOICE[label];
  if(!src) return;
  const el=new Audio(src);
  el.volume=1;
  el.play().catch(()=>{});
}
function startCountdown(){
  const cd=$("#countdown");
  cd.classList.add("show");
  const seq=["3","2","1","START!"]; let i=0;
  cd.textContent=seq[i];
  playCountdownVoice(seq[i]);
  const timer=setInterval(()=>{
    i++;
    if(i>=seq.length){
      clearInterval(timer); cd.classList.remove("show"); startRound(state.currentRound); return;
    }
    cd.textContent=seq[i];
    playCountdownVoice(seq[i]);
  },700);
}

/* =========================================================
   라운드 데이터 생성
========================================================= */
function makeRoundQueue(round){
  const cfg=round===1?GAME_CONFIG.round1:GAME_CONFIG.round2;
  const correct=[];
  cfg.correctKeywords.forEach(k=>{
    correct.push({...k,correct:true},{...k,correct:true});
  });
  const wrongPool=(cfg.wrongKeywords&&cfg.wrongKeywords.length)
    ? cfg.wrongKeywords : GAME_CONFIG.wrongKeywords;
  const wrongBase=[];
  const wrongCount=Math.max(1,Math.round(correct.length*1.5));
  for(let i=0;i<wrongCount;i++){
    const w=wrongPool[i%wrongPool.length];
    wrongBase.push({...w,correct:false,instance:i});
  }
  // 오답 분포를 먼저 섞어 특정 항목 몰림을 줄임
  const wrong=shuffle(wrongBase);
  const pool=[...correct,...wrong];

  function valid(list){
    if(!list.slice(0,3).some(x=>x.correct)) return false;
    let correctRun=0, wrongRun=0;
    for(let i=0;i<list.length;i++){
      const cur=list[i], prev=list[i-1];
      if(prev && cur.id===prev.id) return false;
      if(cur.correct){correctRun++;wrongRun=0}else{wrongRun++;correctRun=0}
      if(correctRun>=3) return false;
      if(wrongRun>=4) return false;
    }
    return true;
  }
  for(let tries=0;tries<3000;tries++){
    const q=shuffle(pool);
    if(valid(q)) return q;
  }
  console.warn("Constrained shuffle fallback used");
  // 안전한 fallback: 정답/오답을 번갈아 섞되 같은 id 연속 금지
  const c=shuffle(correct), w=shuffle(wrong);
  const q=[];
  while(c.length||w.length){
    if(q.length<3 && !q.some(x=>x.correct) && c.length) q.push(c.pop());
    if(w.length) q.push(w.pop());
    if(c.length) q.push(c.pop());
    if(w.length) q.push(w.pop());
  }
  return q.slice(0,20);
}

/* =========================================================
   플레이 초기화 / 실행
========================================================= */
function resetRoundState(){
  state.lives=GAME_SETTINGS.life;
  state.collected=0;
  state.counts={};
  const cfg=state.currentRound===1?GAME_CONFIG.round1:GAME_CONFIG.round2;
  cfg.correctKeywords.forEach(k=>state.counts[k.id]=0);
  state.items=[];
  state.spawned=0;
  state.spawnQueue=makeRoundQueue(state.currentRound);
  state.playerX=GAME_SETTINGS.playerStartX;
  state.keys.left=false; state.keys.right=false;
  state.lastLane=null;
  $("#playScreen").querySelectorAll(".keyword,.particle,.hit-x").forEach(e=>e.remove());
  $("#speech").style.display="none";
  updateHUD();
}
async function loadPlayer(){
  const cfg=state.currentRound===1?GAME_CONFIG.round1:GAME_CONFIG.round2;
  const img=$("#playerImg"), fb=$("#playerFallback");
  fb.classList.add("hidden");
  const ok=await applyImage(img,ASSETS[cfg.playerAsset],()=>fb.classList.remove("hidden"));
  if(ok) fb.classList.add("hidden");
}
function startRound(round){
  stopGame();
  state.currentRound=round;
  resetRoundState();
  loadPlayer();
  showScreen("playScreen");
  state.playing=true;
  state.paused=false;
  hidePauseOverlay();
  state.lastTs=performance.now();
  state.spawnTimer=setInterval(spawnNext,GAME_SETTINGS.keywordSpawnInterval);
  spawnNext();
  state.raf=requestAnimationFrame(gameLoop);
  updatePlayerVisual();
}
function stopGame(){
  state.playing=false;
  state.paused=false;
  hidePauseOverlay();
  if(state.spawnTimer){clearInterval(state.spawnTimer);state.spawnTimer=null}
  if(state.raf){cancelAnimationFrame(state.raf);state.raf=null}
  state.keys.left=false; state.keys.right=false;
}
function hidePauseOverlay(){
  const overlay=$("#pauseOverlay");
  if(overlay) overlay.classList.remove("show");
  const btn=$("#pauseBtn");
  if(btn){ btn.textContent="❚❚"; btn.setAttribute("aria-label","일시정지"); }
}
function pauseGame(){
  if(!state.playing || state.paused) return;
  state.paused=true;
  if(state.spawnTimer){clearInterval(state.spawnTimer);state.spawnTimer=null}
  if(state.raf){cancelAnimationFrame(state.raf);state.raf=null}
  state.keys.left=false; state.keys.right=false;
  const overlay=$("#pauseOverlay");
  if(overlay) overlay.classList.add("show");
  const btn=$("#pauseBtn");
  if(btn){ btn.textContent="▶"; btn.setAttribute("aria-label","계속하기"); }
}
function resumeGame(){
  if(!state.playing || !state.paused) return;
  state.paused=false;
  hidePauseOverlay();
  state.lastTs=performance.now();
  state.raf=requestAnimationFrame(gameLoop);
  if(state.spawned<state.spawnQueue.length){
    state.spawnTimer=setInterval(spawnNext,GAME_SETTINGS.keywordSpawnInterval);
  }
}
function togglePause(){
  if(!state.playing) return;
  if(state.paused) resumeGame(); else pauseGame();
}
function chooseLane(){
  const lanes=GAME_SETTINGS.lanes;
  let idx=Math.floor(Math.random()*lanes.length), guard=0;
  while(idx===state.lastLane && guard<20){
    idx=Math.floor(Math.random()*lanes.length); guard++;
  }
  state.lastLane=idx;
  return lanes[idx];
}
function spawnNext(){
  if(!state.playing || state.paused || state.spawned>=state.spawnQueue.length){
    if(state.spawnTimer){clearInterval(state.spawnTimer);state.spawnTimer=null}
    return;
  }
  const data=state.spawnQueue[state.spawned++];
  // 좌측 '남은키워드' = 앞으로 하늘에서 더 떨어질 키워드 개수
  updateHUD();
  const x=chooseLane();
  const el=document.createElement("div");
  el.className="keyword";
  el.dataset.id=data.id;
  const img=document.createElement("img");
  const src=ASSETS[data.asset];
  el.appendChild(img);
  const fallback=document.createElement("div");
  fallback.className="keyword-fallback hidden";
  fallback.textContent=data.correct?data.label:"?";
  el.appendChild(fallback);
  applyImage(img,src,()=>fallback.classList.remove("hidden")).then(ok=>{
    if(ok) fallback.classList.add("hidden");
  });
  $("#playScreen").appendChild(el);
  const item={el,data,x,y:-80,dead:false};
  state.items.push(item);
}

/* =========================================================
   게임 루프 / 충돌
========================================================= */
function getPotCatchZone(){
  const isR1=state.currentRound===1;
  return {
    x: state.playerX + (isR1?GAME_SETTINGS.catchXOffsetRound1:GAME_SETTINGS.catchXOffsetRound2),
    y: isR1?GAME_SETTINGS.catchYRound1:GAME_SETTINGS.catchYRound2,
    width: GAME_SETTINGS.catchWidth,
    height: GAME_SETTINGS.catchHeight
  };
}
function updatePlayerVisual(){
  const p=$("#player");
  p.style.left=`${state.playerX}px`;
  p.classList.remove("player-moving-left","player-moving-right");
  if(state.keys.left&&!state.keys.right) p.classList.add("player-moving-left");
  if(state.keys.right&&!state.keys.left) p.classList.add("player-moving-right");
  // 보라색 솥 입구의 실제 위치를 따라가는 보이지 않는 판정 영역
  const zone=getPotCatchZone();
  const hit=$("#catchHitbox");
  hit.style.left=`${zone.x}px`;
  hit.style.top=`${zone.y}px`;
  hit.style.width=`${zone.width}px`;
  hit.style.height=`${zone.height}px`;
}
function getRequiredCorrectTotal(){
  const cfg=state.currentRound===1?GAME_CONFIG.round1:GAME_CONFIG.round2;
  return cfg.correctKeywords.length;
}
function gameLoop(ts){
  if(!state.playing || state.paused) return;
  const dt=Math.min((ts-state.lastTs)/1000,.05);
  state.lastTs=ts;
  let dir=0;
  if(state.keys.left) dir-=1;
  if(state.keys.right) dir+=1;
  state.playerX=clamp(state.playerX+dir*GAME_SETTINGS.playerSpeed*dt,GAME_SETTINGS.playerMinX,GAME_SETTINGS.playerMaxX);
  updatePlayerVisual();

  for(const item of state.items){
    if(item.dead) continue;
    item.y+=GAME_SETTINGS.keywordFallSpeed*dt;
    item.el.style.left=`${item.x}px`;
    item.el.style.top=`${item.y}px`;
    if(collides(item)){
      catchItem(item);
    }else if(item.y>GAME_SETTINGS.height+100){
      removeItem(item);
    }
  }
  state.items=state.items.filter(i=>!i.dead);

  if(state.spawned>=state.spawnQueue.length && state.items.length===0 && state.collected<getRequiredCorrectTotal()){
    failRound();
    return;
  }
  state.raf=requestAnimationFrame(gameLoop);
}
function collides(item){
  // 캐릭터 몸/머리와 닿는 것은 무시. 키워드 중심이 보라색 솥 입구 안으로 들어와야만 담긴다.
  const zone=getPotCatchZone();
  const insideX=Math.abs(item.x-zone.x) <= zone.width/2;
  const insideY=Math.abs(item.y-zone.y) <= zone.height/2;
  return insideX && insideY;
}
function removeItem(item){
  if(item.dead) return;
  item.dead=true;
  item.el.remove();
}
function catchItem(item){
  if(item.dead) return;
  removeItem(item);
  if(item.data.correct){
    let progressed=false;
    // 1R/2R 공통: 같은 키워드가 2번 내려와도 그중 1개만 솥에 담으면 해당 키워드 완료
    if((state.counts[item.data.id]||0)===0){
      state.counts[item.data.id]=1;
      state.collected++;
      progressed=true;
    }
    // 정답의 중복 복사본을 담아도 패널티는 없다.
    sfx("correct");
    reactCorrect(item.x,item.y);
    updateHUD(progressed?item.data.id:null);
    if(state.collected>=getRequiredCorrectTotal()){
      successRound();
    }
  }else{
    // 오답은 반드시 솥 입구에 들어왔을 때만 생명 1 감소
    state.lives=Math.max(0,state.lives-1);
    sfx("wrong");
    reactWrong(item.x,item.y);
    updateHUD();
    if(state.lives<=0) failRound();
  }
}
function reactCorrect(x,y){
  const p=$("#player");
  p.classList.remove("player-jump"); void p.offsetWidth; p.classList.add("player-jump");
  showSpeech("얏호~!");
  for(let i=0;i<10;i++){
    const sp=document.createElement("div"); sp.className="particle"; sp.textContent=i%2?"✦":"✨";
    sp.style.left=`${x}px`;sp.style.top=`${y}px`;
    sp.style.setProperty("--dx",`${(Math.random()-.5)*190}px`);
    sp.style.setProperty("--dy",`${-50-Math.random()*150}px`);
    $("#playScreen").appendChild(sp); setTimeout(()=>sp.remove(),700);
  }
}
function reactWrong(x,y){
  const p=$("#player");
  p.classList.remove("player-shake"); void p.offsetWidth; p.classList.add("player-shake");
  showSpeech("이런 ㅠ");
  const xEl=document.createElement("div"); xEl.className="hit-x";xEl.textContent="X";
  xEl.style.left=`${x}px`;xEl.style.top=`${y}px`;
  $("#playScreen").appendChild(xEl);setTimeout(()=>xEl.remove(),500);
}
function showSpeech(text){
  const s=$("#speech");
  s.textContent=text;s.style.display="block";
  s.style.left=`${state.playerX}px`;s.style.top=`${GAME_SETTINGS.catchY-70}px`;
  clearTimeout(s._timer);
  s._timer=setTimeout(()=>s.style.display="none",GAME_SETTINGS.speechDuration);
}
function updateHUD(flashedId=null){
  // 남은키워드 = 아직 생성되지 않아 앞으로 하늘에서 떨어질 키워드 수
  const remainingFalling=state.spawnQueue.length
    ? Math.max(0,state.spawnQueue.length-state.spawned)
    : GAME_SETTINGS.totalKeywords;
  $("#remainingCorrect").textContent=remainingFalling;

  // 생명 UI는 항상 3개를 모두 보여주고, 잃은 생명은 검은 하트로 표시한다.
  const hearts=$("#hearts"); hearts.innerHTML="";
  const livesNow=Math.max(0,Math.min(GAME_SETTINGS.life,Number.isFinite(state.lives)?state.lives:GAME_SETTINGS.life));
  for(let i=0;i<GAME_SETTINGS.life;i++){
    const w=document.createElement("span");
    w.className="heart"+(i>=livesNow?" lost":"");
    const img=document.createElement("img");img.alt=i>=livesNow?"검정 하트":"빨간 하트";
    const fb=document.createElement("span");fb.className="heart-fallback hidden";fb.textContent="♥";
    w.append(img,fb);hearts.appendChild(w);
    applyImage(img,ASSETS.heart,()=>fb.classList.remove("hidden")).then(ok=>{if(ok)fb.classList.add("hidden")});
  }

  // 우측 레시피 UI: 1R/2R 모두 각 키워드를 하나만 담으면 완료.
  const cfg=state.currentRound===1?GAME_CONFIG.round1:GAME_CONFIG.round2;
  const list=$("#recipeStatusList");
  if(!list) return;
  list.innerHTML="";
  cfg.correctKeywords.forEach(k=>{
    const n=state.counts[k.id]||0;
    const got=n>=1;
    const line=document.createElement("div");
    line.className="progress-line"+(got?" got":"")+(flashedId===k.id?" complete":"");
    const label=document.createElement("span");
    label.className="recipe-label";
    label.textContent=k.label;
    const check=document.createElement("span");
    check.className="recipe-check";
    check.textContent=got?"✓ 완료":"○";
    line.append(label,check);
    list.appendChild(line);
  });
}

/* =========================================================
   성공 / 실패
========================================================= */
function freezeAndFadeItems(){
  state.items.forEach(item=>{
    item.el.style.transition="opacity .3s ease";
    item.el.style.opacity="0";
  });
}
function successRound(){
  if(!state.playing) return;
  stopGame();
  freezeAndFadeItems();
  sfx("success");
  showSpeech("얏호~!");
  later(()=>{
    $("#playScreen").querySelectorAll(".keyword").forEach(e=>e.remove());
    if(state.currentRound===1) showRound1Clear();
    else showScreen("round2ClearScreen");
  },340);
}
function failRound(){
  if(!state.playing) return;
  stopGame();
  sfx("fail");
  later(()=>{
    $("#playScreen").querySelectorAll(".keyword").forEach(e=>e.remove());
    showScreen("failScreen");
  },260);
}
function showRound1Clear(){
  showScreen("round1ClearScreen");
}
function showRound1Reveal(){
  showScreen("round1RevealScreen");
  const bg=$("#round1RevealSceneBg");
  const snow=$("#round1RevealSnowman");
  const bubbles=$("#round1RevealBubbles");
  bg.style.backgroundImage=`url("${ASSETS.round1RevealBg}")`;
  bubbles.innerHTML="";
  const bubbleSpecs=[
    [42,12,30,0],[95,46,24,.24],[146,12,40,.52],[206,58,26,.78],
    [264,20,34,1.02],[326,48,22,.3],[376,10,46,.64],[430,60,28,1.08],
    [120,86,20,1.22],[300,92,24,.88],[392,102,18,.5]
  ];
  bubbleSpecs.forEach(([x,bottom,size,delay])=>{
    const b=document.createElement("span");
    b.className="success-bubble";
    b.style.left=x+"px";
    b.style.bottom=bottom+"px";
    b.style.width=size+"px";
    b.style.height=size+"px";
    b.style.animationDelay=delay+"s";
    bubbles.appendChild(b);
  });
  snow.classList.remove("rise");
  void snow.offsetWidth;
  snow.classList.add("rise");
  sfx("magic");
}
$("#retryBtn").addEventListener("click",()=>openRecipe(state.currentRound));
$("#toRound1Reveal").addEventListener("click",()=>openStory("middle",0));
$("#round1RevealNext").addEventListener("click",()=>openStory("middle",0));
$("#round2Next").addEventListener("click",()=>openStory("ending",0));

/* =========================================================
   최종 결과 연출
========================================================= */
function clearRitual(){
  $("#cauldron").classList.remove("boil");
  $("#cauldron").querySelectorAll(".bubble").forEach(b=>b.remove());
  $("#scroll").className="scroll";
  $("#activityReveal").classList.remove("show");
  $("#activityImage").style.display="block";
  $("#activityFallback").classList.add("hidden");
}
function addBubbles(){
  const c=$("#cauldron");
  for(let i=0;i<12;i++){
    const b=document.createElement("div");b.className="bubble";
    const s=12+Math.random()*26;
    b.style.width=b.style.height=s+"px";
    b.style.left=(60+Math.random()*200)+"px";
    b.style.top=(-10+Math.random()*50)+"px";
    b.style.animationDelay=(Math.random()*1.4)+"s";
    c.appendChild(b);
  }
}
function runFinalReveal(){
  clearRitual();
  showScreen("finalResultScreen");
  const c=$("#cauldron"),scroll=$("#scroll"),reveal=$("#activityReveal");
  c.classList.add("boil"); addBubbles(); sfx("magic");
  later(()=>{scroll.classList.add("show");sfx("scroll")},1050);
  later(()=>{scroll.classList.add("open")},2050);
  later(async()=>{
    c.classList.remove("boil");
    reveal.classList.add("show");
    const img=$("#activityImage"),fb=$("#activityFallback");
    const ok=await applyImage(img,ASSETS.activityResult,()=>fb.classList.remove("hidden"));
    if(ok) fb.classList.add("hidden");
  },2850);
}
$("#finalNext").addEventListener("click",()=>openStory("ending",0));

/* =========================================================
   마지막 화면
========================================================= */
function resetAll(){
  stopGame();
  destroyStoryPageFlip();
  state.currentRound=1;
  state.storyType="opening";
  state.storyPage=0;
  state.storyTurning=false;
  state.playerX=GAME_SETTINGS.playerStartX;
  state.keys.left=false;
  state.keys.right=false;
  state.lives=GAME_SETTINGS.life;
  state.collected=0;
  state.counts={};
  state.items=[];
  state.spawnQueue=[];
  state.spawned=0;
  state.lastLane=null;
  tutorialPageIndex=0;
  const tutorialPopup=$("#tutorialPopup");
  if(tutorialPopup) tutorialPopup.classList.remove("show");
  $("#playScreen").querySelectorAll(".keyword,.particle,.hit-x").forEach(e=>e.remove());
  $("#speech").style.display="none";
  showScreen("mainScreen");
}
$("#replayGameBtn").addEventListener("click",resetAll);
$("#pauseBtn").addEventListener("click",togglePause);
$("#pauseResumeBtn").addEventListener("click",resumeGame);
$("#pauseRetryBtn").addEventListener("click",()=>openRecipe(state.currentRound));

/* =========================================================
   키보드 입력
========================================================= */
window.addEventListener("keydown",e=>{
  if(e.key==="Escape"){
    if(state.screen==="playScreen") togglePause();
    return;
  }
  if(state.screen!=="playScreen"||!state.playing||state.paused) return;
  if(e.key==="ArrowLeft"){e.preventDefault();state.keys.left=true}
  if(e.key==="ArrowRight"){e.preventDefault();state.keys.right=true}
});
window.addEventListener("keyup",e=>{
  if(state.screen!=="playScreen") return;
  if(e.key==="ArrowLeft"){e.preventDefault();state.keys.left=false}
  if(e.key==="ArrowRight"){e.preventDefault();state.keys.right=false}
});
window.addEventListener("blur",()=>{state.keys.left=false;state.keys.right=false});

/* =========================================================
   부팅
========================================================= */
window.PureumGame = {
  boot(){
    initStaticAssets();
    applyBackgrounds();
    updateMasterVolume();
    bindButtonSounds();
    updatePlayerVisual();
    updateBgm();
    selfCheck();
  }
};
function selfCheck(){
  const total=k=>{
    const q=makeRoundQueue(k);
    const c=q.filter(x=>x.correct).length, w=q.length-c;
    console.assert(c===GAME_CONFIG["round"+k].correctKeywords.length*2,`R${k}: 정답 수 불일치`);
    console.assert(q.slice(0,3).some(x=>x.correct),`R${k}: 앞 3개에 정답 없음`);
    return `R${k} 총 ${q.length} (정답 ${c} / 오답 ${w})`;
  };
  console.log("[SELF CHECK]", total(1), "|", total(2));
}

// 개발용 간단 검증 로그

