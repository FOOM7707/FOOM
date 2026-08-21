/**
 * 멈춰 있는 에뮬레이터 정리 — `npm run emu:kill`
 *
 * ## 언제 쓰는가
 *
 * `npm run emu`가 이렇게 멈출 때입니다.
 *
 * ```
 * !  firestore: Port 8080 is not open on localhost (127.0.0.1), could not start Firestore Emulator.
 * Error: Could not start Firestore Emulator, port taken.
 * ```
 *
 * 창을 강제로 닫거나 프로세스가 죽으면 **에뮬레이터의 자바·노드 프로세스가 남아
 * 포트를 계속 붙잡습니다.** 창은 닫혔으니 `Ctrl+C`로 끌 방법이 없고, 작업 관리자에서
 * 무엇을 죽여야 하는지도 알기 어렵습니다.
 *
 * ## 무엇을 죽이는가
 *
 * **개발용 에뮬레이터 포트를 듣고 있는 프로세스만** 죽입니다. 테스트용 포트(1xxxx)와
 * 개발서버(5173)는 건드리지 않습니다 — 테스트는 다른 포트를 쓰도록 나눠 뒀고
 * (`firebase.test.json`), 개발서버는 이 문제와 무관합니다.
 *
 * **남아 있던 데이터는 사라집니다.** 에뮬레이터는 데이터를 메모리에 들고 있어서
 * 정상 종료가 아니면 저장되지 않습니다 — 마지막 `npm run emu:save` 시점으로
 * 돌아갑니다.
 */

import { execFileSync } from "node:child_process";

/** 개발용 에뮬레이터 포트 (firebase.json). 테스트용 1xxxx는 일부러 제외합니다 */
const PORTS = [
  { port: 4000, name: "에뮬레이터 UI" },
  { port: 4400, name: "허브" },
  { port: 4500, name: "로그" },
  { port: 5001, name: "함수" },
  { port: 8080, name: "Firestore" },
  { port: 9099, name: "인증" },
  { port: 9150, name: "Firestore(웹소켓)" },
  { port: 9199, name: "저장소" },
];

function listening() {
  // netstat은 윈도우·리눅스 모두 있고 출력 형식이 같습니다(마지막 칸이 PID).
  const out = execFileSync("netstat", ["-ano"], { encoding: "utf8" });
  const rows = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.includes("LISTENING")) continue;
    const parts = line.trim().split(/\s+/);
    const local = parts[1] ?? "";
    const pid = Number(parts[parts.length - 1]);
    const port = Number(local.slice(local.lastIndexOf(":") + 1));
    if (!Number.isFinite(pid) || !Number.isFinite(port)) continue;
    rows.push({ port, pid });
  }
  return rows;
}

const rows = listening().filter((r) => PORTS.some((p) => p.port === r.port));
if (rows.length === 0) {
  console.log("붙잡고 있는 프로세스가 없습니다. 바로 `npm run emu`로 띄우면 됩니다.");
  process.exit(0);
}

const pids = [...new Set(rows.map((r) => r.pid))];
for (const { port, pid } of rows) {
  const name = PORTS.find((p) => p.port === port)?.name ?? "";
  console.log(`  ${port} (${name}) — PID ${pid}`);
}

for (const pid of pids) {
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), "/F", "/T"], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGKILL");
    }
    console.log(`정리했습니다 — PID ${pid}`);
  } catch {
    console.error(
      `PID ${pid}를 정리하지 못했습니다. 다른 사용자의 프로세스이거나 이미 종료됐을 수 있습니다.`
    );
  }
}

console.log("\n이제 `npm run emu`로 다시 띄우면 됩니다.");
console.log("(저장하지 않은 변경분은 사라졌습니다 — 마지막 `npm run emu:save` 시점부터입니다)");
