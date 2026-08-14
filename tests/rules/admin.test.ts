import {
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore'
import { beforeEach, describe, it } from 'vitest'
import { assertDenied, assertSucceeds } from './helpers/assert'
import { asAdmin, UID, setupRulesTestEnv } from './helpers/env'
import { ID, seedAll } from './helpers/fixtures'

setupRulesTestEnv()

describe('케이스 14 — admin:true 클레임 계정의 컬렉션 읽기 (경로 지정 조회)', () => {
  beforeEach(seedAll)

  // 6-1 656~660줄: 관리자 화면은 /admin/* 서버 API(Admin SDK)로 조회하므로
  // 클라이언트 컬렉션그룹 쿼리를 쓰지 않습니다. 그래서 여기는 전부 경로 지정입니다.
  const paths: Array<[label: string, segments: string[]]> = [
    ['users', ['users', UID.consumer1]],
    ['users/private/identity', ['users', UID.consumer1, 'private', 'identity']],
    ['providerProfiles', ['providerProfiles', UID.providerA]],
    [
      'providerProfiles/private/profile',
      ['providerProfiles', UID.providerA, 'private', 'profile'],
    ],
    [
      'providerProfiles/violations',
      ['providerProfiles', UID.providerA, 'violations', ID.violation],
    ],
    ['programs (draft)', ['programs', ID.programDraft]],
    [
      'programs/schedules (published)',
      ['programs', ID.programPublished, 'schedules', ID.scheduleOfPublished],
    ],
    [
      'programs/schedules (draft)',
      ['programs', ID.programDraft, 'schedules', ID.scheduleOfDraft],
    ],
    [
      'programs/scheduleTemplates',
      ['programs', ID.programDraft, 'scheduleTemplates', ID.scheduleTemplate],
    ],
    ['bookings', ['bookings', ID.booking]],
    ['payments', ['payments', ID.payment]],
    ['settlements', ['settlements', ID.settlement]],
    [
      'settlements/items',
      ['settlements', ID.settlement, 'items', ID.settlementItem],
    ],
    ['reviews', ['reviews', ID.review]],
    ['inquiries', ['inquiries', ID.inquiry]],
    [
      'inquiries/messages',
      ['inquiries', ID.inquiry, 'messages', ID.inquiryMessage],
    ],
    ['voucherAds (inactive)', ['voucherAds', ID.voucherAdInactive]],
    ['termsAgreements', ['termsAgreements', ID.termsAgreement]],
    ['notificationLogs', ['notificationLogs', ID.notificationLog]],
    ['aggregates', ['aggregates', 'searchIndex']],
  ]

  for (const [label, segments] of paths) {
    it(`관리자가 ${label} 읽기`, async () => {
      const db = asAdmin()
      const [first, ...rest] = segments
      await assertSucceeds(getDoc(doc(db, first, ...rest)))
    })
  }

  it('관리자도 컬렉션그룹 schedules 쿼리는 published 필터가 있어야 통과', async () => {
    // 재귀 와일드카드 규칙에는 isAdmin() 절이 일부러 없습니다(6-1 656~660줄).
    const db = asAdmin()
    await assertSucceeds(
      getDocs(
        query(
          collectionGroup(db, 'schedules'),
          where('programStatus', '==', 'published'),
        ),
      ),
    )
  })

  it('관리자가 필터 없이 컬렉션그룹 schedules 를 쿼리하면 거부 (의도된 설계)', async () => {
    const db = asAdmin()
    await assertDenied(getDocs(collectionGroup(db, 'schedules')))
  })
})
