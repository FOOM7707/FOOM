export { assertSucceeds } from '@firebase/rules-unit-testing'

/**
 * 라이브러리의 assertFails 대신 쓰는 엄격한 버전.
 *
 * assertFails는 "에러가 나기만 하면" 통과시킵니다. 픽스처 오타나 잘못된 경로로
 * 실패해도 "규칙이 막았다"로 착각하게 되는데, 거부 케이스가 15개나 되는
 * 이 테스트에서는 그게 곧 규칙을 검증하지 않는 테스트가 됩니다.
 * 그래서 실패 이유가 permission-denied인지까지 확인합니다.
 */
export async function assertDenied(op: Promise<unknown>): Promise<void> {
  let outcome: 'passed' | 'threw' = 'passed'
  let caught: unknown

  try {
    await op
  } catch (err) {
    outcome = 'threw'
    caught = err
  }

  if (outcome === 'passed') {
    throw new Error('거부되어야 하는 동작이 통과했습니다')
  }

  const code = String((caught as { code?: unknown })?.code ?? '')
  const message = String((caught as { message?: unknown })?.message ?? caught)

  // Firestore와 Storage는 거부 코드가 다릅니다.
  //   Firestore : permission-denied
  //   Storage   : storage/unauthorized ("User does not have permission to access …")
  // 둘 다 규칙이 막았다는 뜻이고, 그 외의 실패(경로 오타·픽스처 누락)는
  // 여전히 테스트 실패로 드러나야 합니다.
  const deniedByRules =
    code.includes('permission-denied') ||
    code === 'storage/unauthorized' ||
    /PERMISSION_DENIED/i.test(message) ||
    /does not have permission to access/i.test(message)

  if (!deniedByRules) {
    throw new Error(
      `규칙이 아닌 다른 이유로 실패했습니다 (테스트 자체가 잘못됐을 수 있음): ${message}`,
    )
  }
}
