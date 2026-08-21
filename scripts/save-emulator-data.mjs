/**
 * 개발용 에뮬레이터 데이터 저장 — `npm run emu:save`
 *
 * 계정·권한·등록한 프로그램·올린 사진을 `.emulator-data/`에 저장합니다. 다음에
 * `npm run emu`로 띄우면 그 상태에서 이어서 작업합니다.
 *
 * ## 왜 `--export-on-exit`를 쓰지 않는가 (2026-08-21 확인)
 *
 * `firebase emulators:export`는 **임시 폴더를 만든 뒤 이름을 바꾸는** 방식입니다.
 * 윈도우에서는 그 폴더를 감시하는 프로세스가 있으면 이름 바꾸기가 막히는데
 * (`EPERM: operation not permitted, rename`), 우리 환경에는 감시자가 둘 있습니다 —
 * 개발서버(Vite)가 프로젝트 루트를, 함수 에뮬레이터가 `functions/`를 봅니다.
 *
 * 문제는 실패하는 방식입니다. **CLI는 대상 폴더를 먼저 비우고 이름 바꾸기를
 * 시도하므로, 실패하면 원래 저장돼 있던 데이터까지 사라집니다.** 실제로 그렇게
 * 한 번 날렸습니다. 자동 저장(`--export-on-exit`)에 맡기면 그게 **에뮬레이터를 끄는
 * 순간**에 일어나서, 다음에 켤 때야 알게 됩니다.
 *
 * → 이 스크립트는 **이름 바꾸기를 하지 않고 복사**합니다. 만들어진 임시 폴더 자체는
 * 정상이기 때문입니다. 그리고 **새 데이터를 확인한 뒤에** 기존 것을 바꾸며, 직전
 * 상태를 `.emulator-data.bak/`에 한 판 남겨둡니다.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const TARGET = ".emulator-data";
const BACKUP = ".emulator-data.bak";
const TMP = ".emulator-data.tmp";
const PROJECT = "demo-foom";

function fail(message) {
  console.error(`\n실패: ${message}\n`);
  process.exit(1);
}

/** 이번에 만들어진 내보내기 폴더 찾기 — 이름 바꾸기가 성공했는지에 따라 자리가 다릅니다 */
function findExported() {
  if (existsSync(join(TMP, "firebase-export-metadata.json"))) return TMP;

  // 이름 바꾸기가 막힌 경우 임시 폴더가 그대로 남습니다. 만든 시각이 가장 늦은 것을
  // 씁니다 — 에뮬레이터의 실행 위치에 따라 루트나 functions/ 아래에 생깁니다.
  const candidates = [];
  for (const dir of [".", "functions"]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.startsWith("firebase-export-")) continue;
      const path = join(dir, name);
      if (existsSync(join(path, "firebase-export-metadata.json"))) {
        candidates.push({ path, at: statSync(path).mtimeMs });
      }
    }
  }
  candidates.sort((a, b) => b.at - a.at);
  return candidates[0]?.path ?? null;
}

console.log("에뮬레이터 데이터를 내보내는 중…");
rmSync(TMP, { recursive: true, force: true });

// **CLI를 직접 부릅니다** — `npx`는 윈도우에서 `npx.cmd`를 찾아야 하고 `shell: true`로
// 부르면 인자가 그대로 이어붙어 경로에 공백이 있을 때 깨집니다.
//
// 이름 바꾸기 단계에서 실패해도 폴더 자체는 만들어지므로 종료 코드를 보지 않습니다.
// 그 실패 메시지(`Export request failed`)는 우리가 복사로 처리하는 정상 경로이므로
// 보여주지 않고, **정말 못 찾았을 때만** 함께 보여줍니다.
const cli = join("node_modules", "firebase-tools", "lib", "bin", "firebase.js");
const run = spawnSync(
  process.execPath,
  [cli, "emulators:export", TMP, "--project", PROJECT, "--force"],
  { encoding: "utf8" }
);

const exported = findExported();
if (!exported) {
  console.error(`${run.stdout ?? ""}${run.stderr ?? ""}`.trim());
  fail(
    "내보낸 데이터를 찾지 못했습니다. 에뮬레이터가 켜져 있는지 확인해 주세요 (npm run emu)."
  );
}

// 계정이 실제로 들어 있는지 확인한 뒤에 기존 것을 건드립니다.
if (!existsSync(join(exported, "auth_export"))) {
  fail(`${exported}에 계정 정보가 없습니다. 기존 저장분은 그대로 두었습니다.`);
}

if (existsSync(TARGET)) {
  rmSync(BACKUP, { recursive: true, force: true });
  cpSync(TARGET, BACKUP, { recursive: true });
  rmSync(TARGET, { recursive: true, force: true });
}

cpSync(exported, TARGET, { recursive: true });
if (exported !== TMP) rmSync(exported, { recursive: true, force: true });
rmSync(TMP, { recursive: true, force: true });

console.log(`저장했습니다 → ${TARGET}/`);
console.log(`  (직전 상태는 ${BACKUP}/ 에 한 판 남아 있습니다)`);
console.log("  다음에 `npm run emu`로 띄우면 이 상태에서 이어집니다.");
