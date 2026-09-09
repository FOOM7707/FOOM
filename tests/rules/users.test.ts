import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { beforeEach, describe, it } from 'vitest'
import { assertDenied, assertSucceeds } from './helpers/assert'
import { as, unauth, UID, setupRulesTestEnv } from './helpers/env'
import { seedAll } from './helpers/fixtures'

setupRulesTestEnv()

describe('users — 권한 상승 차단', () => {
  beforeEach(seedAll)

  it('케이스 1 — 일반 사용자가 자기 users 문서를 role:admin 으로 생성', async () => {
    const db = as(UID.consumer2) // 픽스처에 없는 uid라 create 경로를 탑니다
    await assertDenied(
      setDoc(doc(db, 'users', UID.consumer2), {
        role: 'admin',
        status: 'active',
        nickname: '침입자',
      }),
    )
  })

  it('케이스 2 — 일반 사용자가 자기 users 문서의 role 을 수정', async () => {
    const db = as(UID.consumer1)
    await assertDenied(
      updateDoc(doc(db, 'users', UID.consumer1), { role: 'admin' }),
    )
  })

  it('(2026-09-09) 본인이 users 문서의 phone 을 직접 수정 — 서버 경유 규칙 우회 차단', async () => {
    // 소셜 번호 잠금·직접 입력은 선점 안 함 규칙이 서버(PATCH /users/me)에만 있어서,
    // 여기가 열려 있으면 브라우저에서 그 규칙을 통째로 건너뛸 수 있습니다(2-14).
    const db = as(UID.consumer1)
    await assertDenied(
      updateDoc(doc(db, 'users', UID.consumer1), { phone: '+821012345678' }),
    )
    await assertDenied(
      updateDoc(doc(db, 'users', UID.consumer1), { phoneSource: 'naver' }),
    )
  })

  it('본인이 users 문서의 다른 항목(별명)을 수정하는 것은 그대로 허용', async () => {
    // phone 을 막으면서 정상 수정까지 막지 않았는지 — 거부 테스트만 두면 규칙을
    // 전부 false 로 바꿔도 통과합니다.
    const db = as(UID.consumer1)
    await assertSucceeds(
      updateDoc(doc(db, 'users', UID.consumer1), { nickname: '바꾼별명' }),
    )
  })

  it('케이스 4-1 — 다른 사용자가 남의 users/{uid}/private/identity(실명·CI) 읽기', async () => {
    const db = as(UID.consumer2)
    await assertDenied(
      getDoc(doc(db, 'users', UID.consumer1, 'private', 'identity')),
    )
  })

  it('케이스 4-1 — 비로그인 사용자도 identity 를 읽을 수 없음', async () => {
    const db = unauth()
    await assertDenied(
      getDoc(doc(db, 'users', UID.consumer1, 'private', 'identity')),
    )
  })
})
