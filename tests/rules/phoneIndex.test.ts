import { doc, getDoc, setDoc } from 'firebase/firestore'
import { beforeEach, describe, it } from 'vitest'
import { assertDenied } from './helpers/assert'
import { as, asAdmin, unauth, UID, setupRulesTestEnv } from './helpers/env'
import { seedAll } from './helpers/fixtures'

setupRulesTestEnv()

// phoneIndex (v14) — 문서ID가 곧 전화번호인 "번호 → 계정" 대응표.
// 읽기를 열면 번호를 하나씩 찍어보는 것만으로 가입 여부를 알 수 있어
// (문서ID 지정 단건 조회라 목록 권한도 필요 없습니다) 전면 차단합니다.
describe('phoneIndex (v14) — 읽기·쓰기 전면 차단, 서버 트랜잭션 전용', () => {
  beforeEach(seedAll)

  const E164 = '+821012345678'

  it('비로그인 사용자가 phoneIndex 읽기', async () => {
    await assertDenied(getDoc(doc(unauth(), 'phoneIndex', E164)))
  })

  it('로그인한 소비자가 phoneIndex 읽기 — 가입 여부 열거 방지', async () => {
    await assertDenied(getDoc(doc(as(UID.consumer1), 'phoneIndex', E164)))
  })

  it('관리자도 클라이언트에서 phoneIndex 읽기 불가', async () => {
    // 관리자에게 필요한 조회는 목적이 남는 서버 API로만 수행합니다.
    await assertDenied(getDoc(doc(asAdmin(), 'phoneIndex', E164)))
  })

  it('소비자가 남의 번호를 자기 uid로 선점 시도', async () => {
    await assertDenied(
      setDoc(doc(as(UID.consumer1), 'phoneIndex', E164), { uid: UID.consumer1 }),
    )
  })

  it('관리자에게도 클라이언트 쓰기를 열지 않음', async () => {
    await assertDenied(
      setDoc(doc(asAdmin(), 'phoneIndex', E164), { uid: UID.consumer1 }),
    )
  })
})
