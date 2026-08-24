/* 민재 원본 스크린샷 → 변환 입력 규약(쌍코드/기기/줄id-번호.png)으로 복사하는 스테이징 스크립트.
 * (2026-08-24 세션 스크래치패드에서 tools/로 승격 — 인계가 임시폴더 경로를 쫓지 않게. §8.273 회차)
 * 입력:  C:\Users\iNakmj\Downloads\GSR 스크린샷\{핸드폰|대형 태블릿} 스크린샷\<언어명>\<화면명>.png
 * 출력:  tools\shots-staging\<pair>\<phone|tablet>\<rowid>-<n>.png  (gitignore — 커밋되지 않는다)
 * 규칙:  한국어→ko-en · 영어→en-ko · 그 외 15개 언어는 언어선택 1장을 L-en·L-ko 양쪽에 복사.
 * 모르는 파일명이 하나라도 있으면 exit 1 (조용히 빠뜨리지 않는다). 7인치 폴더는 의도적으로 무시.
 * 이어서: node tools/process-shots.mjs convert tools/shots-staging → node tools/process-shots.mjs manifest
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'C:/Users/iNakmj/Downloads/GSR 스크린샷';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'shots-staging');

const DEVICE_DIRS = { '핸드폰 스크린샷': 'phone', '대형 태블릿 스크린샷': 'tablet' };
const LANG = {
  '독일어':'de','러시아어':'ru','베트남어':'vi','스페인어':'es','아랍어':'ar','영어':'en',
  '우크라이나어':'uk','이탈리아어':'it','인도네시아어':'id','일본어':'ja','중국어':'zh',
  '태국어':'th','튀르키예어':'tr','포르투갈어':'pt','폴란드어':'pl','프랑스어':'fr','한국어':'ko',
};

// 파일명(공백 제거·확장자 제거) → [rowid, 번호]. 번호 없는 단일 컷은 1. 'SKIP'=의도적 미사용.
// 민재 지시 2026-08-24: ①언어선택 줄 = 1번 '모든언어선택'(확장 예정) · 2번 '현재 한/영'
//                      ②레벨테스트 줄 = 1번 첫화면 · 2번 스크롤 캡처(총평 전체) · 3번부터 기존 분할 컷
//                      ③줄 재편(§8.273) — 젠·대시보드 줄 삭제 → 'layout' 줄로 통합(1=대시보드·2=젠)
// ⚠️ 제3외국어 15종의 '모든언어선택' 화면은 파일명을 안 바꾼 `Screenshot_...GenRecall Dev.png`로 들어온다.
//    2026-08-24 실측: 15개 폴더 전부 그 파일이 정확히 1장이고 해상도가 모든언어선택과 일치(폰 1080×3200~3600
//    긴 캡처 · 태블릿 2960×1803). 2장 이상이면 아래 dupScreenshot 가드가 막는다.
// shift = 그 폴더에 스크롤 캡처가 실제로 있을 때만 분할 컷 번호를 민다 — 없는 폴더(예: 태블릿 작문채점)까지
// 일괄로 밀면 1번이 비어 manifest의 연속 번호 검사가 막는다.
function mapName(raw, code, shift){
  const name = raw.replace(/\.png$/i, '').replace(/\s+/g, '');
  let m;
  if (name === '모든언어선택' || /^Screenshot_\d/.test(name)) return ['langselect', 1];
  if (name.startsWith('언어선택')) return ['langselect', 2];
  // 민재 규약 2026-08-24 2차: '<언어명>언어선택' = 전 배울언어판(nameBy 번역 완비 후 재촬영 — §8.275).
  // '모든언어선택'은 첫 규칙이, '언어선택 <언어명>'(현재 한/영판)은 둘째 규칙이 먼저 잡아 여기 안 온다.
  if (name.endsWith('언어선택')) return ['langselect', 1];
  if ((m = name.match(/^작문첫화면(\d+)$/))) return ['writing', +m[1]];
  if (name === '작문홈') return ['writing', 1];
  if (name === '젠') return ['layout', 2];
  if (/^스크롤.*작문채점$/.test(name)) return ['grading', 1]; // 민재 확정 2026-08-24: 작문채점 줄의 1번
  if ((m = name.match(/^작문채점(\d+)$/))) return ['grading', +m[1] + (shift.grading ? 1 : 0)];
  if ((m = name.match(/^선생님께질문(\d+)?$/))) return ['ask', m[1] ? +m[1] : 1];
  if (name === '레벨테스트첫화면') return ['placement', 1];
  if (/^스크롤.*레벨테스트채점$/.test(name)) return ['placement', 2]; // 총평 전체(스크롤 캡처)
  if ((m = name.match(/^레벨테스트채점(\d+)$/))) return ['placement', +m[1] + (shift.placement ? 2 : 1)];
  if (name === '대시보드') return ['layout', 1];
  if (name === '즐겨찾기') return ['favorites', 1];
  if (name === '연습패턴') return ['favorites', 2];
  if ((m = name.match(/^통계(\d+)?$/))) return ['stats', m[1] ? +m[1] : 1];
  if (name === '학습이력') return ['history', 1];
  return null;
}

// 🔴 손상 원본 제외 목록 — 여기 넣기 전에 sharp 디코딩 + 육안 확인으로 판정한다.
//    (2026-08-23의 프랑스어 폰 손상본은 민재 재촬영본 '모든언어선택.png'로 교체 확인돼 목록에서 뺐다 — 2026-08-24)
const BROKEN = new Set([]);

const unknown = [];
const skipped = [];
const broken = [];
let copied = 0;
fs.rmSync(OUT, {recursive: true, force: true});

for (const [devDir, device] of Object.entries(DEVICE_DIRS)){
  const devPath = path.join(SRC, devDir);
  for (const langName of fs.readdirSync(devPath)){
    const code = LANG[langName];
    if (!code){ unknown.push(`언어 폴더 불인식: ${devDir}/${langName}`); continue; }
    const dir = path.join(devPath, langName);
    // 방향별 하위폴더('영어 배울 때'·'한국어 배울 때')는 아직 비어 있다 — 채워지면 그때 규약을 정한다.
    const files = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());
    const shots = files.filter((f) => /^Screenshot_\d/.test(f));
    if (shots.length > 1) unknown.push(`Screenshot_ 파일이 ${shots.length}장 — 어느 것이 모든언어선택인지 알 수 없다: ${devDir}/${langName}`);
    const norm = files.map((f) => f.replace(/\.png$/i, '').replace(/\s+/g, ''));
    const shift = {
      grading: norm.some((n) => /^스크롤.*작문채점$/.test(n)),
      placement: norm.some((n) => /^스크롤.*레벨테스트채점$/.test(n)),
    };
    for (const f of files){
      if (BROKEN.has(`${devDir}/${langName}/${f}`)){ broken.push(`${devDir}/${langName}/${f}`); continue; }
      const mapped = mapName(f, code, shift);
      if (mapped === 'SKIP'){ skipped.push(`${devDir}/${langName}/${f}`); continue; }
      if (!mapped){ unknown.push(`파일명 불인식: ${devDir}/${langName}/${f}`); continue; }
      const [rowId, n] = mapped;
      // 쌍 결정: ko→ko-en, en→en-ko, 그 외는 langselect만 양쪽 쌍에
      let pairs;
      if (code === 'ko') pairs = ['ko-en'];
      else if (code === 'en') pairs = ['en-ko'];
      else if (rowId === 'langselect') pairs = [`${code}-en`, `${code}-ko`];
      else { unknown.push(`예상 밖 본편 컷(언어선택 아님): ${devDir}/${langName}/${f}`); continue; }
      for (const pair of pairs){
        const outDir = path.join(OUT, pair, device);
        fs.mkdirSync(outDir, {recursive: true});
        fs.copyFileSync(path.join(dir, f), path.join(outDir, `${rowId}-${n}.png`));
        copied++;
      }
    }
  }
}

if (unknown.length){
  console.error(`🔴 스테이징 중단 사유 ${unknown.length}건:\n  ` + unknown.join('\n  '));
  process.exit(1);
}
// 후처리 — langselect는 "1번=확장 예정 · 2번=현재" 짝이라 1번이 빠지면 2번에 1번 캡션이 붙어 **틀린 설명**이 된다.
// 그래서 1번이 없는 조합은 langselect를 통째로 비운다(그 줄만 사라지고 "준비 중" 안내가 대신 뜬다).
let dropped = 0;
for (const pair of fs.readdirSync(OUT)){
  for (const device of fs.readdirSync(path.join(OUT, pair))){
    const d = path.join(OUT, pair, device);
    if (!fs.existsSync(path.join(d, 'langselect-1.png')) && fs.existsSync(path.join(d, 'langselect-2.png'))){
      fs.unlinkSync(path.join(d, 'langselect-2.png'));
      dropped++;
      console.log(`  ⚠️ ${pair}/${device}: 1번(확장 예정)이 없어 언어선택 줄을 통째로 제외`);
    }
  }
}

console.log(`✅ 스테이징 완료: ${copied - dropped}장 → ${OUT}`);
if (broken.length) console.log(`🔴 손상으로 제외 ${broken.length}건(민재 재촬영 필요):\n  ` + broken.join('\n  '));
if (skipped.length) console.log(`⏸️ 의도적 미사용 ${skipped.length}건(민재 지시 밖 — 배치 확정 대기):\n  ` + skipped.join('\n  '));
