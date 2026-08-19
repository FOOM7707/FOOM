/**
 * 카카오맵 JavaScript SDK 로더.
 *
 * `index.html`에 `<script>`로 박지 않고 필요할 때 불러옵니다. 지도는 홈·검색·상세
 * 일부에서만 쓰는데 스크립트를 항상 받으면 첫 화면 로딩에 그대로 얹히고, **키가
 * 없는 환경(팀원 로컬·CI)에서는 콘솔 에러만 나기 때문**입니다. 여기서 실패하면
 * 화면이 깨지는 대신 안내 문구로 대체됩니다 — 날씨 위젯과 같은 방식입니다(16-4).
 *
 * ⚠️ 여기 쓰는 키는 **JavaScript 키**입니다. 브라우저가 카카오에 직접 붙는 구조라
 *    번들에 그대로 들어가고, 실제 방어선은 카카오 콘솔의 **JavaScript SDK 도메인**
 *    등록입니다. 등록되지 않은 주소에서 열면 키가 있어도 거부됩니다.
 *    서버가 쓰는 REST API 키를 여기 넣으면 안 됩니다(그쪽은 도메인 제한이 없습니다).
 */

/** 실제 SDK는 훨씬 크지만, 우리가 쓰는 만큼만 타입을 적습니다. */
export interface KakaoLatLng {
  getLat(): number;
  getLng(): number;
}

/** 화면 픽셀 좌표. **y는 아래로 갈수록 커집니다**(남쪽) */
export interface KakaoPoint {
  x: number;
  y: number;
}

/** 위경도 ↔ 픽셀 변환기. 현재 축척을 기준으로 계산합니다 */
export interface KakaoProjection {
  pointFromCoords(latlng: KakaoLatLng): KakaoPoint;
  coordsFromPoint(point: KakaoPoint): KakaoLatLng;
}

export interface KakaoLatLngBounds {
  extend(latlng: KakaoLatLng): void;
}

export interface KakaoMapInstance {
  getCenter(): KakaoLatLng;
  setCenter(latlng: KakaoLatLng): void;
  getLevel(): number;
  /** 카카오는 숫자가 **작을수록** 확대입니다(1=20m, 14=전국) — Leaflet과 반대 */
  setLevel(level: number, options?: { animate?: boolean }): void;
  setBounds(bounds: KakaoLatLngBounds): void;
  /** 부드럽게 이동. 거리가 멀면 카카오가 알아서 즉시 이동으로 바꿉니다 */
  panTo(latlng: KakaoLatLng): void;
  relayout(): void;
  getProjection(): KakaoProjection;
}

export interface KakaoCustomOverlay {
  setMap(map: KakaoMapInstance | null): void;
}

export interface KakaoMaps {
  load(callback: () => void): void;
  Map: new (
    container: HTMLElement,
    options: { center: KakaoLatLng; level?: number; scrollwheel?: boolean }
  ) => KakaoMapInstance;
  LatLng: new (lat: number, lng: number) => KakaoLatLng;
  Point: new (x: number, y: number) => KakaoPoint;
  LatLngBounds: new () => KakaoLatLngBounds;
  CustomOverlay: new (options: {
    position: KakaoLatLng;
    content: HTMLElement | string;
    map?: KakaoMapInstance;
    yAnchor?: number;
    xAnchor?: number;
    clickable?: boolean;
    zIndex?: number;
  }) => KakaoCustomOverlay;
}

declare global {
  interface Window {
    kakao?: { maps?: KakaoMaps };
  }
}

export const KAKAO_MAP_KEY: string = import.meta.env.VITE_KAKAO_MAP_KEY ?? "";

/**
 * 여러 지도 컴포넌트가 동시에 떠도 스크립트는 한 번만 받습니다.
 * 실패한 약속은 버려서 다음 시도가 다시 받을 수 있게 합니다.
 */
let loading: Promise<KakaoMaps> | null = null;

export function loadKakaoMaps(): Promise<KakaoMaps> {
  if (window.kakao?.maps?.Map) return Promise.resolve(window.kakao.maps);
  if (loading) return loading;

  if (!KAKAO_MAP_KEY) {
    // 키가 없는 건 오류 상황이 아니라 "아직 설정이 안 된 환경"입니다.
    // 화면은 안내 문구로 대체되고 나머지 기능은 그대로 동작합니다.
    return Promise.reject(new Error("VITE_KAKAO_MAP_KEY가 설정되지 않았습니다"));
  }

  loading = new Promise<KakaoMaps>((resolve, reject) => {
    const script = document.createElement("script");
    // autoload=false — 스크립트를 받은 뒤 kakao.maps.load()로 직접 초기화합니다.
    // 이걸 빼면 SDK가 알아서 초기화하는데, 그 시점을 알 수 없어 첫 렌더에서
    // "kakao is not defined"가 납니다.
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_MAP_KEY}&autoload=false`;
    script.async = true;

    script.onload = () => {
      const maps = window.kakao?.maps;
      if (!maps) {
        reject(new Error("카카오맵 SDK를 초기화하지 못했습니다"));
        return;
      }
      maps.load(() => resolve(maps));
    };

    script.onerror = () => {
      loading = null;
      // 대부분 도메인 미등록입니다 — 키가 틀린 경우와 응답이 같아 구분되지 않습니다.
      reject(
        new Error(
          "카카오맵 SDK를 불러오지 못했습니다. 카카오 콘솔의 JavaScript SDK 도메인에 " +
            "현재 주소가 등록돼 있는지 확인하세요."
        )
      );
    };

    document.head.appendChild(script);
  });

  return loading;
}
