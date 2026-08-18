import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import type { Firestore } from 'firebase/firestore'
import type { FirebaseStorage } from 'firebase/storage'
import { afterAll, beforeAll, beforeEach } from 'vitest'

// 실서비스 프로젝트(foom-4092d)를 절대 쓰지 않습니다.
// Firebase는 'demo-' 접두사 프로젝트에 대해 실서버 접속을 차단하므로,
// 설정이 잘못돼도 운영 Firestore에 붙을 수 없습니다.
export const PROJECT_ID = 'demo-foom'

// 컨텍스트 5종 — 6-3 케이스가 요구하는 행위자 전부
export const UID = {
  consumer1: 'consumer1',
  consumer2: 'consumer2', // 예약·문의 당사자가 아닌 제3자 (케이스 4-1, 10)
  providerA: 'providerA',
  providerB: 'providerB', // 남의 자원에 접근을 시도하는 다른 공급자 (케이스 4, 9)
  admin1: 'admin1',
} as const

let testEnv: RulesTestEnvironment

function emulatorTarget(envName: string, defaultPort: number) {
  // emulators:exec 가 *_EMULATOR_HOST를 넣어줍니다.
  // watch 모드로 직접 돌릴 때를 위해 기본값을 둡니다.
  const raw = process.env[envName] ?? `127.0.0.1:${defaultPort}`
  const [host, port] = raw.split(':')
  return { host, port: Number(port) }
}

/** 테스트 파일 최상단에서 한 번 호출합니다. */
export function setupRulesTestEnv() {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
        ...emulatorTarget('FIRESTORE_EMULATOR_HOST', 8080),
      },
      // 파일 규칙은 firestore.rules와 **별개 파일**입니다(18-5).
      // 한 환경에 둘 다 실어야 자격증 경로처럼 Firestore 문서를 참조하는
      // 규칙(firestore.exists)을 실제로 검증할 수 있습니다.
      storage: {
        rules: readFileSync(resolve(process.cwd(), 'storage.rules'), 'utf8'),
        ...emulatorTarget('FIREBASE_STORAGE_EMULATOR_HOST', 9199),
      },
    })
  })

  // 최상단에서 등록되므로 describe 안의 beforeEach(픽스처 심기)보다 먼저 돕니다.
  beforeEach(async () => {
    await testEnv.clearFirestore()
    await testEnv.clearStorage()
  })

  afterAll(async () => {
    await testEnv.cleanup()
  })
}

/** 비로그인 클라이언트 */
export function unauth(): Firestore {
  return testEnv.unauthenticatedContext().firestore() as unknown as Firestore
}

/** 로그인한 일반 사용자 */
export function as(uid: string): Firestore {
  return testEnv.authenticatedContext(uid).firestore() as unknown as Firestore
}

/** admin: true 커스텀 클레임을 가진 계정 (6-0 원칙 4) */
export function asAdmin(): Firestore {
  return testEnv
    .authenticatedContext(UID.admin1, { admin: true })
    .firestore() as unknown as Firestore
}

// ── 파일 저장(Storage) 컨텍스트 ─────────────────────────────────────────
// Firestore와 같은 행위자 5종을 그대로 씁니다.

/** 비로그인 클라이언트 (파일) */
export function storageUnauth(): FirebaseStorage {
  return testEnv.unauthenticatedContext().storage() as unknown as FirebaseStorage
}

/** 로그인한 일반 사용자 (파일) */
export function storageAs(uid: string): FirebaseStorage {
  return testEnv.authenticatedContext(uid).storage() as unknown as FirebaseStorage
}

/** admin: true 커스텀 클레임을 가진 계정 (파일) */
export function storageAsAdmin(): FirebaseStorage {
  return testEnv
    .authenticatedContext(UID.admin1, { admin: true })
    .storage() as unknown as FirebaseStorage
}

/** 규칙을 우회해 파일을 심습니다 (읽기 규칙을 검증하려면 파일이 먼저 있어야 함) */
export function seedFile(fn: (storage: FirebaseStorage) => Promise<void>) {
  return testEnv.withSecurityRulesDisabled((ctx) =>
    fn(ctx.storage() as unknown as FirebaseStorage),
  )
}

/**
 * 규칙을 우회해 픽스처를 심습니다.
 * bookings·payments·settlements·reviews·inquiries는 규칙이 클라이언트 쓰기를
 * 전면 금지(allow write: if false)하고 있어 정상 경로로는 테스트 데이터를
 * 만들 수 없습니다.
 */
export function seed(fn: (db: Firestore) => Promise<void>) {
  return testEnv.withSecurityRulesDisabled((ctx) =>
    fn(ctx.firestore() as unknown as Firestore),
  )
}
