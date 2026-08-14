import { doc, getDoc } from 'firebase/firestore'
import { beforeEach, describe, it } from 'vitest'
import { assertDenied, assertSucceeds } from './helpers/assert'
import { as, UID, setupRulesTestEnv } from './helpers/env'
import { ID, seedAll } from './helpers/fixtures'

setupRulesTestEnv()

describe('settlements — 공급자 본인 요약만, 건별 명세는 관리자만', () => {
  beforeEach(seedAll)

  it('케이스 9 — 공급자가 다른 공급자의 settlements 읽기', async () => {
    const db = as(UID.providerB)
    await assertDenied(getDoc(doc(db, 'settlements', ID.settlement)))
  })

  it('케이스 9(짝) — 공급자 본인은 자기 settlements 를 읽을 수 있음', async () => {
    // v9에 규칙이 아예 없어 공급자가 자기 정산을 못 보던 결함의 회귀 방지
    const db = as(UID.providerA)
    await assertSucceeds(getDoc(doc(db, 'settlements', ID.settlement)))
  })

  it('케이스 9(짝) — 공급자 본인도 건별 명세(items)는 읽을 수 없음', async () => {
    const db = as(UID.providerA)
    await assertDenied(
      getDoc(
        doc(db, 'settlements', ID.settlement, 'items', ID.settlementItem),
      ),
    )
  })
})
