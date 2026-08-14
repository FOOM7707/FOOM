/**
 * 관리자 지정 스크립트 (스키마 13번 P0 / 12-3).
 *
 * 사용법:
 *   npm run grant-admin -- --uid <uid>
 *   npm run grant-admin -- --email <이메일>
 *   npm run grant-admin -- --uid <uid> --check          현재 상태만 점검
 *   npm run grant-admin -- --uid <uid> --revoke         회수(+세션 무효화)
 *   npm run grant-admin -- --uid <uid> --revoke --role provider
 *   실서버 대상일 때는 --yes 를 함께 줘야 실행됩니다.
 *
 * 에뮬레이터 대상 실행 예:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *   GOOGLE_CLOUD_PROJECT=demo-foom npm run grant-admin -- --uid <uid>
 *
 * 이 절차를 관리자 화면에 만들지 않는 이유는 12-3에 있습니다 —
 * 화면에 두면 그 자체가 권한 상승 경로가 됩니다.
 */

import {
  grantAdmin,
  resolveUid,
  revokeAdmin,
  verifyAdminConsistency,
  type ConsistencyReport,
} from "../lib/adminGrant";

interface Args {
  uid?: string;
  email?: string;
  role?: string;
  check: boolean;
  revoke: boolean;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { check: false, revoke: false, yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case "--uid":
        args.uid = argv[++i];
        break;
      case "--email":
        args.email = argv[++i];
        break;
      case "--role":
        args.role = argv[++i];
        break;
      case "--check":
        args.check = true;
        break;
      case "--revoke":
        args.revoke = true;
        break;
      case "--yes":
        args.yes = true;
        break;
      default:
        throw new Error(`알 수 없는 인자: ${token}`);
    }
  }
  return args;
}

function printReport(report: ConsistencyReport): void {
  console.log("");
  console.log("  현재 상태");
  console.log(`    uid                   : ${report.uid}`);
  console.log(`    users/{uid} 문서       : ${report.userDocExists ? "있음" : "없음"}`);
  console.log(`    users.role            : ${report.role ?? "(없음)"}`);
  console.log(`    Custom Claims admin   : ${report.claimAdmin}`);
  console.log(`    두 값 일치            : ${report.consistent ? "예" : "아니오"}`);
  if (report.problem) {
    console.log(`    문제                  : ${report.problem}`);
  }
  console.log("");
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  const projectId =
    process.env.GCLOUD_PROJECT ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.FIREBASE_PROJECT ??
    "(미지정)";
  const usingEmulator =
    !!process.env.FIRESTORE_EMULATOR_HOST || !!process.env.FIREBASE_AUTH_EMULATOR_HOST;

  console.log(`대상 프로젝트 : ${projectId}`);
  console.log(`대상 환경     : ${usingEmulator ? "에뮬레이터" : "⚠ 실서버"}`);

  // 실서버 오조작 방지 — 관리자 권한 부여는 되돌리기 번거로운 작업이라
  // 실계정에 실행할 때는 의도를 명시적으로 받습니다.
  if (!usingEmulator && !args.yes && !args.check) {
    console.error(
      "\n실서버 대상입니다. 의도한 것이 맞으면 --yes 를 붙여 다시 실행하세요."
    );
    return 1;
  }

  const uid = await resolveUid({ uid: args.uid, email: args.email });

  if (args.check) {
    const report = await verifyAdminConsistency(uid);
    printReport(report);
    return report.consistent ? 0 : 1;
  }

  if (args.revoke) {
    if (args.role && args.role !== "consumer" && args.role !== "provider") {
      console.error("--role 은 consumer 또는 provider 만 가능합니다");
      return 1;
    }
    const result = await revokeAdmin(uid, (args.role as "consumer" | "provider") ?? "consumer");
    console.log("\n관리자 권한을 회수했습니다. 리프레시 토큰도 무효화했습니다(6-2 ②).");
    printReport(result.report);
    return result.report.consistent ? 0 : 1;
  }

  const result = await grantAdmin(uid);
  console.log("\n관리자로 지정했습니다 — users.role 과 Custom Claims 둘 다 갱신됨.");
  console.log(`  이전 role: ${result.previousRole ?? "(없음)"}`);
  printReport(result.report);
  console.log(
    "  ※ 대상자는 재로그인하거나 getIdToken(true)로 토큰을 강제 갱신해야\n" +
      "    새 권한이 반영됩니다. Custom Claims는 이미 발급된 토큰에\n" +
      "    소급 적용되지 않습니다(6-2 ②).\n"
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(`\n실패: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
