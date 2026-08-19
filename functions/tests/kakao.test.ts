/**
 * 카카오 응답 해석 (스키마 15-7).
 *
 * 확인하는 것: **회원번호를 문자열로 안전하게 옮기는가** / 동의항목이 꺼져 있어
 * 필드가 통째로 없을 때 버티는가 / 실명·성별·생일을 흘리지 않는가.
 *
 * 첫 번째가 이 파일을 만든 이유입니다. 카카오 회원번호는 **숫자**로 오고, 그 값이
 * Firebase uid가 됩니다. 정밀도가 흔들리면 **다른 사람 계정에 로그인됩니다** —
 * 에러가 아니라 조용한 오작동이라 눈으로는 못 잡습니다.
 */

import { describe, expect, it } from "vitest";
import { buildAuthorizeUrl, toSocialProfile } from "../src/lib/kakao";

describe("toSocialProfile — 카카오 응답 해석", () => {
  it("숫자 회원번호를 문자열로 옮긴다", () => {
    const profile = toSocialProfile({ id: 3812345678 });
    expect(profile.providerUserId).toBe("3812345678");
  });

  it("회원번호가 없으면 실패시킨다", () => {
    // 여기서 넘어가면 uid가 `kakao_undefined`가 되어 **모든 사용자가 한 계정**을 씁니다.
    expect(() => toSocialProfile({})).toThrow();
    expect(() => toSocialProfile({ id: null })).toThrow();
  });

  it("동의항목이 꺼져 있어 kakao_account가 없어도 프로필을 만든다", () => {
    // 비즈 앱 전환 전에는 이메일·전화번호가 아예 오지 않습니다.
    const profile = toSocialProfile({ id: 1, properties: { nickname: "숲사랑" } });
    expect(profile).toEqual({
      providerUserId: "1",
      nickname: "숲사랑",
      email: null,
      phone: null,
      profileImageUrl: null,
    });
  });

  it("닉네임·프로필사진은 kakao_account.profile을 먼저 본다", () => {
    const profile = toSocialProfile({
      id: 2,
      properties: { nickname: "옛경로", profile_image: "https://old/img.png" },
      kakao_account: {
        profile: { nickname: "새경로", profile_image_url: "https://new/img.png" },
      },
    });
    expect(profile.nickname).toBe("새경로");
    expect(profile.profileImageUrl).toBe("https://new/img.png");
  });

  it("이메일·전화번호는 있으면 그대로 옮긴다", () => {
    const profile = toSocialProfile({
      id: 3,
      kakao_account: { email: "a@example.com", phone_number: "+82 10-1234-5678" },
    });
    expect(profile.email).toBe("a@example.com");
    // E.164 정규화는 저장 직전(normalizePhone)에 합니다 — 여기서는 원문 그대로입니다.
    expect(profile.phone).toBe("+82 10-1234-5678");
  });

  it("실명·성별·생일은 응답에 있어도 밖으로 내보내지 않는다", () => {
    // 개인정보 최소수집(15-1). 통과시키는 필드를 5개로 못박습니다.
    const profile = toSocialProfile({
      id: 4,
      kakao_account: {
        name: "홍길동",
        gender: "male",
        birthday: "0101",
        birthyear: "1990",
        age_range: "30~39",
      },
    });
    expect(Object.keys(profile).sort()).toEqual([
      "email",
      "nickname",
      "phone",
      "profileImageUrl",
      "providerUserId",
    ]);
    expect(JSON.stringify(profile)).not.toContain("홍길동");
  });

  it("빈 문자열은 값이 아니라 null로 본다", () => {
    const profile = toSocialProfile({
      id: 5,
      kakao_account: { email: "  ", profile: { nickname: "" } },
    });
    expect(profile.email).toBeNull();
    expect(profile.nickname).toBeNull();
  });
});

describe("buildAuthorizeUrl — 인가 요청 주소", () => {
  it("REST API 키를 client_id로 싣는다", () => {
    const url = new URL(
      buildAuthorizeUrl({
        restApiKey: "rest-key",
        redirectUri: "http://localhost:5173/auth/kakao/callback",
        state: "state-1",
      })
    );
    expect(url.origin + url.pathname).toBe("https://kauth.kakao.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("rest-key");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:5173/auth/kakao/callback"
    );
    expect(url.searchParams.get("state")).toBe("state-1");
  });
});
