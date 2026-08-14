/**
 * 임시 공급자 지정 스크립트 (⚠️ 정식 오픈 전 제거 대상 — 근거는 lib/providerGrant.ts).
 *
 * 사용법:
 *   npm run grant-provider -- --uid <uid> --name "체질숲 협동조합"
 *   npm run grant-provider -- --uid <uid> --check
 *
 * 에뮬레이터 대상 실행 예:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *   GOOGLE_CLOUD_PROJECT=demo-foom npm run grant-provider -- --uid naver_xxx
 *
 * 본인확인·자격증 심사를 거치지 않으므로 `approvalStatus`는 `pending`,
 * 공개 프로필의 `verified`는 false로 남습니다. 의도된 값입니다.
 */

import { db } from "../lib/firebase";
import {
  grantProvider,
  verifyProviderConsistency,
  type ProviderStatusReport,
} from "../lib/providerGrant";

interface Args {
  uid?: string;
  name?: string;
  bio?: string;
  check: boolean;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { check: false, yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case "--uid":
        args.uid = argv[++i];
        break;
      case "--name":
        args.name = argv[++i];
        break;
      case "--bio":
        args.bio = argv[++i];
        break;
      case "--check":
        args.check = true;
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

function printReport(report: ProviderStatusReport): void {
  console.log("");
  console.log("  현재 상태");
  console.log(`    uid                : ${report.uid}`);
  console.log(`    users.role         : ${report.role ?? "(없음)"}`);
  console.log(`    공개 프로필        : ${report.hasPublicProfile ? "있음" : "없음"}`);
  console.log(`    private/profile    : ${report.hasPrivateProfile ? "있음" : "없음"}`);
  console.log(`    approvalStatus     : ${report.approvalStatus ?? "(없음)"}`);
  console.log(`    verified(심사통과) : ${report.verified}`);
  console.log(`    일관성             : ${report.consistent ? "정상" : "불일치"}`);
  if (report.problem) console.log(`    문제               : ${report.problem}`);
  console.log("");
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.uid) {
    console.error("--uid 가 필요합니다");
    return 1;
  }

  const projectId =
    process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "(미지정)";
  const usingEmulator =
    !!process.env.FIRESTORE_EMULATOR_HOST || !!process.env.FIREBASE_AUTH_EMULATOR_HOST;

  console.log(`대상 프로젝트 : ${projectId}`);
  console.log(`대상 환경     : ${usingEmulator ? "에뮬레이터" : "⚠ 실서버"}`);

  const deps = { db: db() };

  if (args.check) {
    const report = await verifyProviderConsistency(args.uid, deps);
    printReport(report);
    return report.consistent ? 0 : 1;
  }

  if (!usingEmulator && !args.yes) {
    console.error(
      "\n실서버 대상입니다. 이 스크립트는 본인확인·자격증 심사를 건너뛰는 임시 경로입니다." +
        "\n의도한 것이 맞으면 --yes 를 붙여 다시 실행하세요."
    );
    return 1;
  }

  const result = await grantProvider(
    { uid: args.uid, displayName: args.name, bio: args.bio },
    deps
  );

  console.log("\n공급자로 지정했습니다.");
  console.log(`  이전 role     : ${result.previousRole ?? "(없음)"}`);
  console.log(`  프로필 생성   : ${result.createdProfile ? "새로 만듦" : "이미 있어 유지"}`);
  printReport(await verifyProviderConsistency(args.uid, deps));
  console.log(
    "  ※ 이 계정은 본인확인·자격증 심사를 거치지 않았습니다.\n" +
      "    approvalStatus=pending, verified=false 로 남습니다.\n" +
      "    정식 오픈 전에 반드시 재심사해야 합니다(15-1).\n"
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(`\n실패: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
