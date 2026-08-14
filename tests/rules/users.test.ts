import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { beforeEach, describe, it } from 'vitest'
import { assertDenied } from './helpers/assert'
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
