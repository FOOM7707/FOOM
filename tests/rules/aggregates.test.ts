import { doc, getDoc, setDoc } from 'firebase/firestore'
import { beforeEach, describe, it } from 'vitest'
import { assertDenied, assertSucceeds } from './helpers/assert'
import { as, asAdmin, unauth, UID, setupRulesTestEnv } from './helpers/env'
import { seedAll } from './helpers/fixtures'

setupRulesTestEnv()

describe('aggregates (v13) — 읽기는 전체 공개, 쓰기는 서버 배치 전용', () => {
  beforeEach(seedAll)

  it('케이스 19 — 비로그인 클라이언트가 aggregates/searchIndex 쓰기', async () => {
    const db = unauth()
    await assertDenied(
      setDoc(doc(db, 'aggregates', 'searchIndex'), { programs: ['조작'] }),
    )
  })

  it('케이스 19 — 로그인한 공급자가 aggregates/searchIndex 쓰기', async () => {
    const db = as(UID.providerA)
    await assertDenied(
      setDoc(doc(db, 'aggregates', 'searchIndex'), { programs: ['조작'] }),
    )
  })

  it('케이스 19 — 관리자에게도 클라이언트 쓰기를 열지 않음', async () => {
    // aggregates 는 voucherAds 와 달리 관리자 예외가 없습니다.
    // rebuildSearchIndex 배치(Admin SDK)만 씁니다.
    const db = asAdmin()
    await assertDenied(
      setDoc(doc(db, 'aggregates', 'searchIndex'), { programs: [] }),
    )
  })

  it('케이스 21 — 비로그인 사용자가 aggregates/scheduleCalendar 읽기', async () => {
    const db = unauth()
    await assertSucceeds(getDoc(doc(db, 'aggregates', 'scheduleCalendar')))
  })
})
