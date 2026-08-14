import { doc, getDoc } from 'firebase/firestore'
import { beforeEach, describe, it } from 'vitest'
import { assertDenied, assertSucceeds } from './helpers/assert'
import { as, unauth, UID, setupRulesTestEnv } from './helpers/env'
import { seedAll } from './helpers/fixtures'

setupRulesTestEnv()

describe('providerProfiles — 공개/민감 문서 분리', () => {
  beforeEach(seedAll)

  it('케이스 3 — 비로그인 사용자가 private/profile 읽기', async () => {
    const db = unauth()
    await assertDenied(
      getDoc(doc(db, 'providerProfiles', UID.providerA, 'private', 'profile')),
    )
  })

  it('케이스 4 — 다른 공급자가 남의 private/profile(계좌) 읽기', async () => {
    const db = as(UID.providerB)
    await assertDenied(
      getDoc(doc(db, 'providerProfiles', UID.providerA, 'private', 'profile')),
    )
  })

  it('케이스 12 — 비로그인 사용자가 공개 프로필 읽기', async () => {
    const db = unauth()
    await assertSucceeds(getDoc(doc(db, 'providerProfiles', UID.providerA)))
  })

  it('케이스 13 — 공급자 본인이 자기 private/profile 읽기', async () => {
    const db = as(UID.providerA)
    await assertSucceeds(
      getDoc(doc(db, 'providerProfiles', UID.providerA, 'private', 'profile')),
    )
  })
})
