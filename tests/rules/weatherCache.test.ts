/**
 * weatherCache 보안규칙 (스키마 16-1).
 *
 * 새 컬렉션을 추가하면 규칙도 함께 추가합니다 — 빠뜨리면 보안 사고가 아니라
 * "조회가 안 되는 버그"로 나타납니다(기본이 거부).
 *
 * 여기서 막아야 하는 것은 **클라이언트 쓰기**입니다. 열어두면 아무나 가짜 예보를
 * 심어 "맑음"으로 바꿀 수 있고, 서버는 캐시를 신뢰하므로 그대로 화면에 나갑니다.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore'
import { beforeEach, describe, it } from 'vitest'
import { assertDenied, assertSucceeds } from './helpers/assert'
import { as, asAdmin, seed, unauth, UID, setupRulesTestEnv } from './helpers/env'

setupRulesTestEnv()

const DOC_ID = '60_127_202608180800'

describe('weatherCache', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'weatherCache', DOC_ID), {
        nx: 60,
        ny: 127,
        baseDate: '20260818',
        baseTime: '0800',
        days: { '20260818': { condition: '맑음', tempC: 29, precipProbability: 10 } },
      })
    })
  })

  it('비로그인도 읽을 수 있다 (개인정보 없는 파생값)', async () => {
    await assertSucceeds(getDoc(doc(unauth(), 'weatherCache', DOC_ID)))
  })

  it('로그인 사용자도 쓸 수 없다 — 가짜 예보를 심을 수 있게 되므로', async () => {
    await assertDenied(
      setDoc(doc(as(UID.consumer1), 'weatherCache', DOC_ID), {
        days: { '20260818': { condition: '맑음', tempC: 25, precipProbability: 0 } },
      }),
    )
  })

  it('관리자에게도 클라이언트 쓰기를 열지 않는다', async () => {
    await assertDenied(
      setDoc(doc(asAdmin(), 'weatherCache', DOC_ID), { days: {} }),
    )
  })

  it('비로그인 쓰기도 거부한다', async () => {
    await assertDenied(setDoc(doc(unauth(), 'weatherCache', 'aaa'), { days: {} }))
  })
})
