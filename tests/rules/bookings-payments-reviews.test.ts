import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { beforeEach, describe, it } from 'vitest'
import { assertDenied, assertSucceeds } from './helpers/assert'
import { as, UID, setupRulesTestEnv } from './helpers/env'
import { ID, seedAll } from './helpers/fixtures'

setupRulesTestEnv()

describe('bookings / payments / reviews — 클라이언트 쓰기 전면 금지', () => {
  beforeEach(seedAll)

  it('케이스 8 — 소비자가 bookings 직접 쓰기', async () => {
    const db = as(UID.consumer1)
    await assertDenied(
      setDoc(doc(db, 'bookings', 'b-forged'), {
        consumerId: UID.consumer1,
        providerId: UID.providerA,
        status: 'confirmed',
        totalAmount: 0, // 금액 조작 시도
      }),
    )
  })

  it('케이스 8 — 소비자가 자기 bookings 문서를 수정', async () => {
    const db = as(UID.consumer1)
    await assertDenied(
      updateDoc(doc(db, 'bookings', ID.booking), { status: 'completed' }),
    )
  })

  it('케이스 8 — 소비자가 payments 직접 쓰기', async () => {
    const db = as(UID.consumer1)
    await assertDenied(
      setDoc(doc(db, 'payments', 'pay-forged'), {
        consumerId: UID.consumer1,
        status: 'paid',
        amount: 0,
      }),
    )
  })

  it('케이스 8 — 소비자가 reviews 직접 쓰기', async () => {
    const db = as(UID.consumer1)
    await assertDenied(
      setDoc(doc(db, 'reviews', 'r-forged'), {
        bookingId: ID.booking,
        programId: ID.programPublished,
        providerId: UID.providerA,
        consumerId: UID.consumer1,
        rating: 5,
      }),
    )
  })

  it('케이스 15 — 예약 당사자(소비자)가 해당 bookings 읽기', async () => {
    const db = as(UID.consumer1)
    await assertSucceeds(getDoc(doc(db, 'bookings', ID.booking)))
  })

  it('케이스 15 — 예약 당사자(공급자)가 해당 bookings 읽기', async () => {
    const db = as(UID.providerA)
    await assertSucceeds(getDoc(doc(db, 'bookings', ID.booking)))
  })

  it('케이스 15(짝) — 제3자는 남의 bookings 를 읽을 수 없음', async () => {
    const db = as(UID.consumer2)
    await assertDenied(getDoc(doc(db, 'bookings', ID.booking)))
  })

  it('케이스 15(짝) — 공급자는 남의 payments 를 읽을 수 없음', async () => {
    // payments 는 bookings 와 달리 소비자·관리자만 읽습니다
    const db = as(UID.providerA)
    await assertDenied(getDoc(doc(db, 'payments', ID.payment)))
  })
})
