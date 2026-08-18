/**
 * 파일 저장 보안규칙 (스키마 18-5).
 *
 * **눈으로 봐서는 맞는지 알 수 없어서 씁니다.** 이 규칙에는 자격증(실명·자격번호)이
 * 걸려 있고, 초안을 교차검증했더니 실제로 세 가지가 어긋나 있었습니다 —
 * 삭제 요청에는 `request.resource`가 없어 검사가 에러로 끝나던 것,
 * 참조하는 Firestore 문서가 없을 때 평가가 에러로 끝나던 것,
 * 본인 직접 읽기를 열어두면 `getDownloadURL()`로 만료 없는 주소를 뽑아
 * 서명 URL 결정(18-6)이 우회되던 것입니다.
 *
 * 에뮬레이터는 **문법이 깨진 규칙에도 그냥 뜹니다.** 규칙이 실제로 동작하는지는
 * 요청을 보내는 이 파일로만 확인됩니다.
 */

import { doc, setDoc } from 'firebase/firestore'
import { getBytes, ref, uploadBytes, deleteObject } from 'firebase/storage'
import { beforeEach, describe, it } from 'vitest'
import { assertDenied, assertSucceeds } from './helpers/assert'
import {
  seed,
  seedFile,
  storageAs,
  storageAsAdmin,
  storageUnauth,
  UID,
  setupRulesTestEnv,
} from './helpers/env'

setupRulesTestEnv()

const PROGRAM_ID = 'p-storage'
const IMAGE = { contentType: 'image/jpeg' }

/** 작은 더미 이미지 바이트. 내용은 규칙 판단에 쓰이지 않습니다. */
function bytes(size = 32): Uint8Array {
  return new Uint8Array(size)
}

/** providerA 소유의 프로그램 문서 — 규칙의 firestore.exists/get 대상 */
async function seedProgram() {
  await seed(async (db) => {
    await setDoc(doc(db, 'programs', PROGRAM_ID), {
      providerId: UID.providerA,
      status: 'draft',
      title: '사진 올릴 프로그램',
    })
  })
}

describe('프로그램 이미지 — 공개 경로', () => {
  beforeEach(seedProgram)

  it('소유 공급자는 자기 프로그램에 사진을 올릴 수 있다', async () => {
    const storage = storageAs(UID.providerA)
    await assertSucceeds(
      uploadBytes(ref(storage, `programs/${PROGRAM_ID}/a.jpg`), bytes(), IMAGE),
    )
  })

  it('다른 공급자는 남의 프로그램에 사진을 올릴 수 없다', async () => {
    // 경로에 programId가 있어야 규칙이 소유권을 대조할 수 있습니다(18-3).
    const storage = storageAs(UID.providerB)
    await assertDenied(
      uploadBytes(ref(storage, `programs/${PROGRAM_ID}/a.jpg`), bytes(), IMAGE),
    )
  })

  it('비로그인은 올릴 수 없다', async () => {
    const storage = storageUnauth()
    await assertDenied(
      uploadBytes(ref(storage, `programs/${PROGRAM_ID}/a.jpg`), bytes(), IMAGE),
    )
  })

  it('없는 프로그램 경로에는 올릴 수 없다 (firestore.exists 가드)', async () => {
    // get()만 쓰면 문서가 없을 때 평가가 에러로 끝납니다. 결과는 어느 쪽이든
    // 거부지만, 에러로 끝나면 원인이 규칙인지 데이터인지 구분되지 않습니다.
    const storage = storageAs(UID.providerA)
    await assertDenied(
      uploadBytes(ref(storage, 'programs/없는프로그램/a.jpg'), bytes(), IMAGE),
    )
  })

  it('이미지가 아닌 파일은 거부한다', async () => {
    const storage = storageAs(UID.providerA)
    await assertDenied(
      uploadBytes(ref(storage, `programs/${PROGRAM_ID}/a.jpg`), bytes(), {
        contentType: 'text/html',
      }),
    )
  })

  it('확장자가 이미지가 아니면 거부한다', async () => {
    const storage = storageAs(UID.providerA)
    await assertDenied(
      uploadBytes(ref(storage, `programs/${PROGRAM_ID}/a.html`), bytes(), IMAGE),
    )
  })

  it('5MB를 넘으면 거부한다', async () => {
    const storage = storageAs(UID.providerA)
    await assertDenied(
      uploadBytes(
        ref(storage, `programs/${PROGRAM_ID}/big.jpg`),
        bytes(5 * 1024 * 1024 + 1),
        IMAGE,
      ),
    )
  })

  it('비로그인도 사진을 볼 수 있다 (홈·검색·상세가 공개 화면)', async () => {
    await seedFile(async (storage) => {
      await uploadBytes(ref(storage, `programs/${PROGRAM_ID}/a.jpg`), bytes(), IMAGE)
    })

    await assertSucceeds(getBytes(ref(storageUnauth(), `programs/${PROGRAM_ID}/a.jpg`)))
  })

  it('소유자도 클라이언트에서 파일을 지울 수 없다 (정리는 서버가 함)', async () => {
    await seedFile(async (storage) => {
      await uploadBytes(ref(storage, `programs/${PROGRAM_ID}/a.jpg`), bytes(), IMAGE)
    })

    // allow write로 묶어두면 삭제 요청에 request.resource가 없어 크기·타입
    // 검사가 에러로 끝납니다. create/update와 delete를 나눠 명시적으로 막습니다.
    await assertDenied(
      deleteObject(ref(storageAs(UID.providerA), `programs/${PROGRAM_ID}/a.jpg`)),
    )
  })
})

describe('자격증 — 비공개 경로', () => {
  const certPath = `providerCertificates/${UID.providerA}/cert.jpg`

  it('본인은 자기 자격증을 올릴 수 있다', async () => {
    const storage = storageAs(UID.providerA)
    await assertSucceeds(uploadBytes(ref(storage, certPath), bytes(), IMAGE))
  })

  it('남의 자격증 경로에는 올릴 수 없다', async () => {
    const storage = storageAs(UID.providerB)
    await assertDenied(uploadBytes(ref(storage, certPath), bytes(), IMAGE))
  })

  it('비로그인은 자격증을 읽을 수 없다', async () => {
    await seedFile(async (storage) => {
      await uploadBytes(ref(storage, certPath), bytes(), IMAGE)
    })
    await assertDenied(getBytes(ref(storageUnauth(), certPath)))
  })

  it('다른 공급자는 남의 자격증을 읽을 수 없다', async () => {
    await seedFile(async (storage) => {
      await uploadBytes(ref(storage, certPath), bytes(), IMAGE)
    })
    await assertDenied(getBytes(ref(storageAs(UID.providerB), certPath)))
  })

  it('본인도 클라이언트에서 직접 읽을 수 없다', async () => {
    // 열어두면 getDownloadURL()로 **만료 없는 영구 주소**를 뽑을 수 있어,
    // 5분 서명 URL로만 열람한다는 결정(18-6)이 우회됩니다.
    await seedFile(async (storage) => {
      await uploadBytes(ref(storage, certPath), bytes(), IMAGE)
    })
    await assertDenied(getBytes(ref(storageAs(UID.providerA), certPath)))
  })

  it('관리자도 클라이언트에서 직접 읽지 않는다 (서버 API 경유)', async () => {
    // 관리자 화면은 /admin/* 서버 API로 서명 URL을 받습니다.
    // 여기를 열면 화면마다 열람 경로가 둘로 갈립니다.
    await seedFile(async (storage) => {
      await uploadBytes(ref(storage, certPath), bytes(), IMAGE)
    })
    await assertDenied(getBytes(ref(storageAsAdmin(), certPath)))
  })
})

describe('명시하지 않은 경로', () => {
  it('규칙이 없는 경로는 기본 거부된다', async () => {
    const storage = storageAs(UID.providerA)
    await assertDenied(uploadBytes(ref(storage, '아무데나/a.jpg'), bytes(), IMAGE))
  })
})
