/* =========================================================
   고정 에셋 — 회차가 바뀌어도 변하지 않는 것들
   (배경 / UI 버튼 / 오답 아이템 / 튜토리얼 / 효과음 / BGM)
   관리자 페이지에서는 건드리지 않습니다.
========================================================= */
"use strict";

const F = "assets/fixed/";
const A = "assets/audio/";

window.FIXED_IMAGES = {
  mainBg:            F + "bg_main.webp",
  recipeBg:          F + "bg_recipe.webp",
  playBg:            F + "bg_play.webp",
  fail1Bg:           F + "bg_fail1.webp",
  fail2Bg:           F + "bg_fail2.webp",
  round1RevealBg:    F + "bg_reveal.webp",
  clear1Bg:          F + "bg_clear1.webp",
  clear2Bg:          F + "bg_clear2.webp",
  endBg:             F + "bg_end.webp",

  scoreboard:        F + "ui_scoreboard.webp",
  recipeScoreboard:  F + "ui_recipe_scoreboard.webp",
  heart:             F + "ui_heart.webp",
  tutorialButton:    F + "ui_btn_tutorial.webp",
  startButton:       F + "ui_btn_start.webp",
  retryButton:       F + "ui_btn_retry.webp",
  nextButton:        F + "ui_btn_next.webp",

  wrong1: F + "wrong_1.webp",
  wrong2: F + "wrong_2.webp",
  wrong3: F + "wrong_3.webp",
  wrong4: F + "wrong_4.webp",
  wrong5: F + "wrong_5.webp",
  wrong6: F + "wrong_6.webp",
  wrong7: F + "wrong_7.webp",
  wrong8: F + "wrong_8.webp"
};

window.FIXED_STORY_IMAGES = {
  tutorial_full_01: F + "tutorial_1.webp",
  tutorial_full_02: F + "tutorial_2.webp",
  tutorial_full_03: F + "tutorial_3.webp",
  tutorial_full_04: F + "tutorial_4.webp",
  tutorial_full_05: F + "tutorial_5.webp"
};

window.FIXED_COUNTDOWN = {
  "3":      A + "cd_3.mp3",
  "2":      A + "cd_2.mp3",
  "1":      A + "cd_1.mp3",
  "START!": A + "cd_start.mp3"
};

window.FIXED_BGM = {
  play:    A + "bgm_play.mp3",
  story:   A + "bgm_story.mp3",
  fail:    A + "bgm_fail.mp3",
  ambient: A + "bgm_ambient.mp3"
};

/* 오답 아이템은 매 회차 동일하므로 여기서 목록을 만든다 */
window.FIXED_WRONG_KEYWORDS = Array.from({ length: 8 }, (_, i) => ({
  id: "wrong" + (i + 1), label: "오답", asset: "wrong" + (i + 1)
}));
