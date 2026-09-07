# 푸른이의 마법 레시피 — 회차 관리 버전

게임 하나에 16회차 콘텐츠를 갈아 끼우는 구조입니다.
설정 방법은 `설치안내.md` 를 보세요.

## 주소

```
/                  현재 적용된 회차 (아이들용)
/?week=3           3회차 직접 실행
/admin/            관리자 페이지 (로그인 필요)
```

## 폴더

```
index.html              게임 화면
css/style.css           게임 디자인 (원본 그대로)
js/game.js              게임 로직 (원본 그대로 + 하드코딩 4곳만 수정)
js/assets-fixed.js      회차와 무관한 고정 에셋 경로
js/content-loader.js    회차 데이터를 읽어 게임에 넣어주는 부분
assets/                 배경, UI, 오답 그림, 튜토리얼, 음원, 폰트
content/weekNN/         회차별 그림
data/weeks/weekNN.json  작업본  ← [저장]
data/live/weekNN.json   적용본  ← [게임에 적용]
data/published.json     지금 아이들이 보는 회차
admin/                  관리자 페이지
```

## 로컬에서 확인하려면

`index.html` 을 더블클릭하면 동작하지 않습니다. 브라우저가 `file://` 에서
JSON 읽기를 막기 때문입니다.

```bash
python3 -m http.server 8000
# http://localhost:8000
```
