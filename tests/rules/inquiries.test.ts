import { doc, getDoc } from 'firebase/firestore'
import { beforeEach, describe, it } from 'vitest'
import { assertDenied, assertSucceeds } from './helpers/assert'
import { as, UID, setupRulesTestEnv } from './helpers/env'
import { ID, seedAll } from './helpers/fixtures'

setupRulesTestEnv()

describe('inquiries — 당사자만 열람', () => {
  beforeEach(seedAll)

  it('케이스 10 — 당사자가 아닌 제3자가 inquiries 읽기', async () => {
    const db = as(UID.consumer2)
    await assertDenied(getDoc(doc(db, 'inquiries', ID.inquiry)))
  })

  it('케이스 10 — 제3자가 하위 messages 읽기', async () => {
    const db = as(UID.consumer2)
    await assertDenied(
      getDoc(doc(db, 'inquiries', ID.inquiry, 'messages', ID.inquiryMessage)),
    )
  })

  it('케이스 10(짝) — 문의 당사자(소비자)는 읽을 수 있음', async () => {
    const db = as(UID.consumer1)
    await assertSucceeds(getDoc(doc(db, 'inquiries', ID.inquiry)))
  })

  it('케이스 10(짝) — 문의 당사자(공급자)는 하위 messages 를 읽을 수 있음', async () => {
    const db = as(UID.providerA)
    await assertSucceeds(
      getDoc(doc(db, 'inquiries', ID.inquiry, 'messages', ID.inquiryMessage)),
    )
  })
})
