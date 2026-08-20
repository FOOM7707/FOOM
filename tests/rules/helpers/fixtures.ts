import { doc, setDoc, Timestamp } from 'firebase/firestore'
import { seed, UID } from './env'

/**
 * 픽스처는 "규칙이 실제로 읽는 필드"만 담습니다.
 * 스키마 2번의 전체 필드를 재현하지 않는 것은 의도적입니다 — 규칙 테스트가
 * 스키마 변경마다 깨지면 정작 규칙을 못 고치게 됩니다.
 * 여기 쓰인 필드는 전부 6-1 규칙 본문에 등장하는 것들입니다.
 */

export const ID = {
  programDraft: 'p-draft',
  programDraftMinimal: 'p-draft-minimal',
  programPublished: 'p-published',
  scheduleOfPublished: 's-published',
  scheduleOfDraft: 's-draft',
  scheduleTemplate: 'tpl1',
  booking: 'b1',
  payment: 'pay1',
  settlement: 's-providerA',
  settlementItem: 'item1',
  review: 'r1',
  inquiry: 'i1',
  inquiryMessage: 'm1',
  violation: 'v1',
  voucherAdInactive: 'ad-inactive',
  termsAgreement: 'ta1',
  notificationLog: 'log1',
} as const

export function seedAll() {
  return seed(async (db) => {
    const now = Timestamp.now()

    // ---- users ----
    await setDoc(doc(db, 'users', UID.consumer1), {
      role: 'consumer',
      status: 'active',
      authProvider: 'kakao',
      nickname: '소비자1',
    })
    // 실명·CI는 본문이 아니라 private 하위 문서에 (v11)
    await setDoc(doc(db, 'users', UID.consumer1, 'private', 'identity'), {
      realName: '홍길동',
      ci: 'CI_VALUE_NEVER_EXPOSED',
    })

    // ---- providerProfiles ----
    await setDoc(doc(db, 'providerProfiles', UID.providerA), {
      displayName: '체질숲 A',
      status: 'approved',
    })
    await setDoc(
      doc(db, 'providerProfiles', UID.providerA, 'private', 'profile'),
      { bankAccount: '123-456-789', bankName: '국민은행' },
    )
    await setDoc(
      doc(db, 'providerProfiles', UID.providerA, 'violations', ID.violation),
      { reason: 'no-show', createdAt: now },
    )

    // ---- programs ----
    // draft — 케이스 6·16·17·18·20이 공유합니다.
    // 값 검증에 걸리는 필드를 모두 채운 "정상 draft"
    await setDoc(doc(db, 'programs', ID.programDraft), {
      providerId: UID.providerA,
      status: 'draft',
      title: '숲해설 초안',
      category: '숲해설',
      price: 20000,
      capacity: 20,
      minCapacity: 5,
      rainAlternative: 'indoor',
      targetAgeMin: 5,
      targetAgeMax: 12,
      updatedAt: now,
    })

    // 케이스 22 — 값 검증 대상 필드가 하나도 없는 draft.
    // 6-1의 값 검증이 get(키, 기본값)이 아니라 직접 참조였을 때
    // 이 문서는 제목조차 고칠 수 없었습니다.
    await setDoc(doc(db, 'programs', ID.programDraftMinimal), {
      providerId: UID.providerA,
      status: 'draft',
      title: '이제 막 만든 초안',
    })

    // published — 케이스 5·11
    await setDoc(doc(db, 'programs', ID.programPublished), {
      providerId: UID.providerA,
      status: 'published',
      title: '산림치유 프로그램',
      category: '산림치유',
      price: 35000,
      capacity: 15,
      minCapacity: 4,
      rainAlternative: 'reschedule',
      updatedAt: now,
    })

    // ---- pendingEdit (v23) ----
    // 게시 중 프로그램의 승인 대기 수정본. 심사 전 내용이라 손님에게 보이면 안 됩니다.
    await setDoc(
      doc(db, 'programs', ID.programPublished, 'pendingEdit', 'current'),
      {
        title: '심사 전 제목',
        price: 99000,
        changedFields: ['title', 'price'],
        submittedBy: UID.providerA,
        submittedAt: now,
      },
    )

    // ---- schedules ----
    // 재귀 와일드카드 규칙이 programStatus만 보고 판단하므로 비정규화 저장(2-4)
    await setDoc(
      doc(db, 'programs', ID.programPublished, 'schedules', ID.scheduleOfPublished),
      {
        programId: ID.programPublished,
        programStatus: 'published',
        startAt: now,
        remainingSlots: 10,
      },
    )
    await setDoc(
      doc(db, 'programs', ID.programDraft, 'schedules', ID.scheduleOfDraft),
      {
        programId: ID.programDraft,
        programStatus: 'draft',
        startAt: now,
        remainingSlots: 20,
      },
    )
    await setDoc(
      doc(
        db,
        'programs',
        ID.programDraft,
        'scheduleTemplates',
        ID.scheduleTemplate,
      ),
      { timeOfDay: '10:00', weekdays: [1, 3, 5] },
    )

    // ---- bookings / payments ----
    await setDoc(doc(db, 'bookings', ID.booking), {
      consumerId: UID.consumer1,
      providerId: UID.providerA,
      programId: ID.programPublished,
      status: 'confirmed',
      unitPrice: 35000,
      totalAmount: 70000,
    })
    await setDoc(doc(db, 'payments', ID.payment), {
      consumerId: UID.consumer1,
      bookingId: ID.booking,
      status: 'paid',
      amount: 70000,
    })

    // ---- settlements ----
    await setDoc(doc(db, 'settlements', ID.settlement), {
      providerId: UID.providerA,
      status: 'pending',
      totalAmount: 70000,
    })
    await setDoc(
      doc(db, 'settlements', ID.settlement, 'items', ID.settlementItem),
      { bookingId: ID.booking, amount: 70000 },
    )

    // ---- reviews ----
    await setDoc(doc(db, 'reviews', ID.review), {
      bookingId: ID.booking,
      programId: ID.programPublished,
      providerId: UID.providerA,
      consumerId: UID.consumer1,
      rating: 5,
    })

    // ---- inquiries ----
    await setDoc(doc(db, 'inquiries', ID.inquiry), {
      consumerId: UID.consumer1,
      providerId: UID.providerA,
      programId: ID.programPublished,
    })
    await setDoc(
      doc(db, 'inquiries', ID.inquiry, 'messages', ID.inquiryMessage),
      { senderId: UID.consumer1, body: '주차 가능한가요?' },
    )

    // ---- 기타 ----
    // 케이스 14용으로 일부러 inactive — 관리자만 읽을 수 있는 상태
    await setDoc(doc(db, 'voucherAds', ID.voucherAdInactive), {
      status: 'inactive',
      title: '바우처 광고',
    })
    await setDoc(doc(db, 'termsAgreements', ID.termsAgreement), {
      uid: UID.consumer1,
      agreedAt: now,
    })
    await setDoc(doc(db, 'notificationLogs', ID.notificationLog), {
      channel: 'alimtalk',
      result: 'success',
    })

    // ---- aggregates (v13) ----
    await setDoc(doc(db, 'aggregates', 'searchIndex'), { programs: [] })
    await setDoc(doc(db, 'aggregates', 'scheduleCalendar'), { dates: {} })
  })
}
