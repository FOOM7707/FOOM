import { doc, getDoc, setDoc, Timestamp, updateDoc } from 'firebase/firestore'
import { beforeEach, describe, it } from 'vitest'
import { assertDenied, assertSucceeds } from './helpers/assert'
import { as, asAdmin, unauth, UID, setupRulesTestEnv } from './helpers/env'
import { ID, seedAll } from './helpers/fixtures'

setupRulesTestEnv()

describe('programs — 허용목록 방식 수정 규칙 (v13)', () => {
  beforeEach(seedAll)

  it('케이스 5 — 공급자가 published 상태인 자기 프로그램의 price 수정', async () => {
    const db = as(UID.providerA)
    await assertDenied(
      updateDoc(doc(db, 'programs', ID.programPublished), { price: 1000 }),
    )
  })

  it('케이스 6 — 공급자가 자기 프로그램을 status:published 로 수정', async () => {
    const db = as(UID.providerA)
    await assertDenied(
      updateDoc(doc(db, 'programs', ID.programDraft), { status: 'published' }),
    )
  })

  it('케이스 7 — 클라이언트에서 programs 문서 직접 생성', async () => {
    const db = as(UID.providerA)
    await assertDenied(
      setDoc(doc(db, 'programs', 'p-created-by-client'), {
        providerId: UID.providerA,
        status: 'published', // 심사 우회 시도
        title: '심사 없이 게시',
        price: 10000,
      }),
    )
  })

  it('케이스 16 — draft 프로그램의 ratingAvg·bookingCount30d 수정', async () => {
    const db = as(UID.providerA)
    await assertDenied(
      updateDoc(doc(db, 'programs', ID.programDraft), {
        ratingAvg: 5.0,
        bookingCount30d: 999999,
      }),
    )
  })

  it('케이스 17 — draft 프로그램의 sido·scheduleDates·publishedAt 수정', async () => {
    const db = as(UID.providerA)
    await assertDenied(
      updateDoc(doc(db, 'programs', ID.programDraft), {
        sido: '서울특별시',
        scheduleDates: ['2026-09-01', '2026-09-02'],
        publishedAt: Timestamp.now(),
      }),
    )
  })

  it('케이스 18 — targetAgeMin > targetAgeMax 로 저장', async () => {
    const db = as(UID.providerA)
    await assertDenied(
      updateDoc(doc(db, 'programs', ID.programDraft), {
        targetAgeMin: 10,
        targetAgeMax: 5,
      }),
    )
  })

  it('케이스 11 — 비로그인 사용자가 published 프로그램 읽기', async () => {
    const db = unauth()
    await assertSucceeds(getDoc(doc(db, 'programs', ID.programPublished)))
  })

  it('케이스 11(짝) — 비로그인 사용자는 draft 프로그램을 읽을 수 없음', async () => {
    const db = unauth()
    await assertDenied(getDoc(doc(db, 'programs', ID.programDraft)))
  })

  it('케이스 20 — 공급자가 자기 draft 프로그램의 title·price·targetAgeMin 수정', async () => {
    const db = as(UID.providerA)
    await assertSucceeds(
      updateDoc(doc(db, 'programs', ID.programDraft), {
        title: '숲해설 초안 (수정)',
        price: 30000,
        targetAgeMin: 7,
      }),
    )
  })

  it('케이스 22 — rainAlternative 가 없는 draft 에서 title 만 수정', async () => {
    // 값 검증을 get(키, 기본값)이 아니라 직접 참조로 쓰면
    // 그 필드가 없는 문서에서 규칙 평가가 에러로 끝나 거부됩니다.
    // "가격을 아직 안 넣은 draft는 제목도 못 고치는" 상태의 회귀 방지용.
    const db = as(UID.providerA)
    await assertSucceeds(
      updateDoc(doc(db, 'programs', ID.programDraftMinimal), {
        title: '제목만 고칩니다',
      }),
    )
  })
})

describe('pendingEdit — 승인 대기 중인 수정본 (v23)', () => {
  beforeEach(seedAll)

  it('소유자는 자기 수정본을 읽는다', async () => {
    const db = as(UID.providerA)
    await assertSucceeds(
      getDoc(doc(db, 'programs', ID.programPublished, 'pendingEdit', 'current')),
    )
  })

  it('관리자는 읽는다 — 심사해야 하므로', async () => {
    const db = asAdmin()
    await assertSucceeds(
      getDoc(doc(db, 'programs', ID.programPublished, 'pendingEdit', 'current')),
    )
  })

  it('소비자는 읽지 못한다 — 심사 전 제목·가격이 노출되면 안 된다', async () => {
    const db = as(UID.consumer1)
    await assertDenied(
      getDoc(doc(db, 'programs', ID.programPublished, 'pendingEdit', 'current')),
    )
  })

  it('비로그인도 읽지 못한다 (게시된 프로그램이어도)', async () => {
    const db = unauth()
    await assertDenied(
      getDoc(doc(db, 'programs', ID.programPublished, 'pendingEdit', 'current')),
    )
  })

  it('다른 공급자는 읽지 못한다', async () => {
    const db = as(UID.providerB)
    await assertDenied(
      getDoc(doc(db, 'programs', ID.programPublished, 'pendingEdit', 'current')),
    )
  })

  it('소유자도 직접 쓰지 못한다 — changedFields를 위조해 심사를 우회할 수 있다', async () => {
    const db = as(UID.providerA)
    await assertDenied(
      setDoc(doc(db, 'programs', ID.programPublished, 'pendingEdit', 'current'), {
        title: '심사 없이 바꾼 제목',
        changedFields: [], // 바뀐 게 없다고 위장
      }),
    )
  })

  it('관리자도 직접 쓰지 못한다 — 승인은 감사로그가 남는 서버 경로로만', async () => {
    const db = asAdmin()
    await assertDenied(
      updateDoc(doc(db, 'programs', ID.programPublished, 'pendingEdit', 'current'), {
        title: '관리자가 직접 수정',
      }),
    )
  })
})
