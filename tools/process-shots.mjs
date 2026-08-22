/* 스크린샷 파이프라인 (민재 원본 → 사이트용 WebP + manifest 재생성)
 *
 * 사용법 (tools/ 폴더에서 `npm install` 1회 후, 레포 루트에서):
 *   node tools/process-shots.mjs convert <원본폴더>   원본 PNG/JPG → shots/에 축소본+원본화질 WebP 생성
 *   node tools/process-shots.mjs manifest             shots/ 폴더를 스캔해 shots/manifest.js 재생성 + 검사
 *
 * convert 입력 폴더 구조(운영자가 정리해서 넣는다):
 *   <원본폴더>/<쌍코드 예: vi-en>/<phone|tablet>/<줄id>-<번호>.png
 *   줄id = writing · settings · layout · placement · ask · favorites · stats
 *
 * 출력:
 *   shots/<쌍>/<기기>/<줄id>-<번호>.webp        (축소본 — 카루셀용)
 *   shots/<쌍>/<기기>/full/<줄id>-<번호>.webp   (원본 해상도 — 팝업 확대용)
 *
 * manifest는 "썸네일과 full이 짝을 이루고 번호가 1부터 빈틈없이 이어질 때"만 초록으로 끝난다.
 * 어긋나면 exit 1 — 깨진 이미지 링크가 배포되는 것을 여기서 막는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROW_IDS = ['writing', 'settings', 'layout', 'placement', 'ask', 'favorites', 'stats'];
const DEVICES = ['phone', 'tablet'];
const PAIR_RE = /^(ko|en|zh|ja|vi|id|th|ru|uk|pl|de|fr|es|it|pt|tr|ar)-(ko|en)$/;
const FILE_RE = new RegExp(`^(${ROW_IDS.join('|')})-([0-9]+)\\.(png|jpg|jpeg|webp)$`, 'i');

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SHOTS = path.join(REPO, 'shots');

// 축소본 폭 = 화면 표시폭(약 250/560 CSS px)의 2배(레티나). 팝업(full)은 원본 그대로.
const THUMB_WIDTH = {phone: 500, tablet: 1120};
const THUMB_QUALITY = 80;
const FULL_QUALITY = 85;

const cmd = process.argv[2];

if (cmd === 'convert'){
  const src = process.argv[3];
  if (!src || !fs.existsSync(src)){
    console.error('사용법: node tools/process-shots.mjs convert <원본폴더>');
    process.exit(1);
  }
  const sharp = (await import('sharp')).default;
  let done = 0, skipped = [];
  for (const pair of fs.readdirSync(src)){
    const pairDir = path.join(src, pair);
    if (!fs.statSync(pairDir).isDirectory()) continue;
    if (!PAIR_RE.test(pair)){ skipped.push(`쌍 폴더명 불인식: ${pair}`); continue; }
    for (const device of fs.readdirSync(pairDir)){
      const devDir = path.join(pairDir, device);
      if (!fs.statSync(devDir).isDirectory()) continue;
      if (!DEVICES.includes(device)){ skipped.push(`기기 폴더명 불인식: ${pair}/${device}`); continue; }
      for (const f of fs.readdirSync(devDir)){
        const m = f.match(FILE_RE);
        if (!m){ skipped.push(`파일명 불인식: ${pair}/${device}/${f}`); continue; }
        const rowId = m[1].toLowerCase(), num = parseInt(m[2], 10);
        const inPath = path.join(devDir, f);
        const outDir = path.join(SHOTS, pair, device);
        const fullDir = path.join(outDir, 'full');
        fs.mkdirSync(fullDir, {recursive: true});
        const base = `${rowId}-${num}.webp`;
        await sharp(inPath).resize({width: THUMB_WIDTH[device], withoutEnlargement: true})
          .webp({quality: THUMB_QUALITY}).toFile(path.join(outDir, base));
        await sharp(inPath).webp({quality: FULL_QUALITY}).toFile(path.join(fullDir, base));
        done++;
      }
    }
  }
  console.log(`변환 완료: ${done}장`);
  if (skipped.length){
    console.error(`⚠️ 건너뜀 ${skipped.length}건:\n  ` + skipped.join('\n  '));
    process.exit(1);
  }
  console.log('이어서: node tools/process-shots.mjs manifest');

} else if (cmd === 'manifest'){
  const pairs = {};
  const problems = [];
  if (fs.existsSync(SHOTS)){
    for (const pair of fs.readdirSync(SHOTS)){
      const pairDir = path.join(SHOTS, pair);
      if (!fs.statSync(pairDir).isDirectory()) continue;
      if (!PAIR_RE.test(pair)){ problems.push(`쌍 폴더명 불인식: shots/${pair}`); continue; }
      for (const device of fs.readdirSync(pairDir)){
        const devDir = path.join(pairDir, device);
        if (!fs.statSync(devDir).isDirectory()) continue;
        if (!DEVICES.includes(device)){ problems.push(`기기 폴더명 불인식: shots/${pair}/${device}`); continue; }
        const nums = {};   // rowId -> Set(번호)
        for (const f of fs.readdirSync(devDir)){
          if (f === 'full') continue;
          const m = f.match(FILE_RE);
          if (!m || !f.endsWith('.webp')){ problems.push(`파일명 불인식: shots/${pair}/${device}/${f}`); continue; }
          const rowId = m[1].toLowerCase(), num = parseInt(m[2], 10);
          (nums[rowId] ||= new Set()).add(num);
          if (!fs.existsSync(path.join(devDir, 'full', f)))
            problems.push(`full 누락: shots/${pair}/${device}/full/${f}`);
        }
        const fullDir = path.join(devDir, 'full');
        if (fs.existsSync(fullDir)){
          for (const f of fs.readdirSync(fullDir)){
            if (!fs.existsSync(path.join(devDir, f)))
              problems.push(`축소본 누락(고아 full): shots/${pair}/${device}/${f}`);
          }
        }
        const counts = {};
        for (const [rowId, set] of Object.entries(nums)){
          const n = set.size;
          for (let i = 1; i <= n; i++)
            if (!set.has(i)) problems.push(`번호 빈틈: shots/${pair}/${device}/${rowId}-${i}.webp 없음 (총 ${n}장인데 1..${n} 연속이 아님)`);
          counts[rowId] = n;
        }
        if (Object.keys(counts).length){
          (pairs[pair] ||= {})[device] = Object.fromEntries(ROW_IDS.filter(r => counts[r]).map(r => [r, counts[r]]));
        }
      }
    }
  }
  if (problems.length){
    console.error(`🔴 manifest 생성 중단 — 문제 ${problems.length}건:\n  ` + problems.join('\n  '));
    process.exit(1);
  }
  const body = `/* 스크린샷 목록 — tools/process-shots.mjs가 자동 재생성합니다. 손으로 고치지 마세요.
   구조: pairs["<모국어>-<학습언어>"][phone|tablet]["<줄id>"] = 장수
   줄id = ${ROW_IDS.join(' · ')} */
window.SHOTS_MANIFEST = ${JSON.stringify({version: 1, pairs}, null, 2)};
`;
  fs.writeFileSync(path.join(SHOTS, 'manifest.js'), body, 'utf8');
  const pairCount = Object.keys(pairs).length;
  const shotCount = Object.values(pairs).flatMap(p => Object.values(p)).flatMap(d => Object.values(d)).reduce((a, b) => a + b, 0);
  console.log(`✅ manifest 재생성: ${pairCount}쌍 · ${shotCount}장`);

} else {
  console.error('사용법: node tools/process-shots.mjs <convert <원본폴더> | manifest>');
  process.exit(1);
}
