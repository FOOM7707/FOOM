import { useEffect, useRef, useState } from "react";
import type { Program } from "@/types/firestore";
import { DEFAULT_CENTER, type LatLng } from "@/lib/geo";
import {
  loadKakaoMaps,
  type KakaoCustomOverlay,
  type KakaoMapInstance,
  type KakaoMaps,
} from "@/lib/kakaoMap";
import { cn } from "@/lib/utils";

/**
 * 지도 컴포넌트 (카카오맵).
 *
 * 이전에는 Leaflet+OpenStreetMap 프로토타입이었습니다 — 카카오 개발자센터 앱 등록
 * 전이라 키가 필요 없는 쪽으로 먼저 만들어뒀던 것이고, props를 고정해둔 덕에
 * 호출부(검색·상세) 수정 없이 이 파일만 교체했습니다.
 *
 * **줌 단위가 Leaflet과 반대입니다.** Leaflet은 숫자가 클수록 확대(zoom 18 = 코앞),
 * 카카오는 숫자가 **작을수록** 확대(level 1 = 20m, level 14 = 전국)입니다. 옛 zoom 값을
 * 그대로 옮기면 전국 지도를 보여주려다 골목이 뜹니다.
 *
 * 키가 없거나 도메인이 등록되지 않으면 지도 대신 안내 문구가 뜹니다 — 화면이
 * 깨지지는 않습니다(날씨 위젯과 같은 처리, 16-4).
 */
interface Props {
  programs: Program[];
  /** 지도 초기 중심 (없으면 첫 프로그램 → 없으면 서울시청) */
  center?: LatLng | null;
  selectedId?: string | null;
  onSelect?: (programId: string) => void;
  /** 현재위치 표시용 */
  userLocation?: LatLng | null;
  className?: string;
}

/** 여러 지점을 함께 볼 때(검색 목록) — 4km 축척 */
const LEVEL_OVERVIEW = 9;
/** 한 지점만 볼 때(상세) — 1km 축척 */
const LEVEL_SINGLE = 7;

/** 가격 핀. CustomOverlay는 HTML을 그대로 얹으므로 마커 이미지를 만들 필요가 없습니다. */
function pinElement(label: string, active: boolean, onClick?: () => void): HTMLElement {
  const el = document.createElement("div");
  el.textContent = label;
  el.style.cssText = `
    white-space: nowrap;
    background: ${active ? "#163F2E" : "#1F5C43"};
    color: #fff;
    font: 600 12px/1 Pretendard, 'Apple SD Gothic Neo', sans-serif;
    padding: 6px 9px;
    border-radius: 100px;
    border: 2px solid #fff;
    box-shadow: 0 2px 6px rgba(0,0,0,.25);
    cursor: ${onClick ? "pointer" : "default"};
  `;
  if (onClick) el.addEventListener("click", onClick);
  return el;
}

function userElement(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `
    width: 16px; height: 16px; border-radius: 50%;
    background: #2563eb; border: 3px solid #fff;
    box-shadow: 0 0 0 6px rgba(37,99,235,.22);
  `;
  return el;
}

export default function ProgramMap({
  programs,
  center,
  selectedId,
  onSelect,
  userLocation,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapsRef = useRef<KakaoMaps | null>(null);
  const mapRef = useRef<KakaoMapInstance | null>(null);
  const overlaysRef = useRef<KakaoCustomOverlay[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  // SDK 로드 + 지도 인스턴스 1회 생성
  useEffect(() => {
    let cancelled = false;

    loadKakaoMaps()
      .then((maps) => {
        if (cancelled || !containerRef.current || mapRef.current) return;

        const initial = center ?? programs[0]?.location ?? DEFAULT_CENTER;
        mapRef.current = new maps.Map(containerRef.current, {
          center: new maps.LatLng(initial.lat, initial.lng),
          level: LEVEL_OVERVIEW,
          // 마우스 휠로 확대·축소합니다. 지도에서 기대되는 기본 동작이라 켜뒀습니다.
          //
          // 대가가 하나 있습니다 — 페이지를 스크롤하다 커서가 지도 위를 지나면
          // 스크롤 대신 지도가 확대됩니다. 상세 화면처럼 지도가 본문 중간에
          // 얇게 들어간 자리에서 걸리는데, 그게 거슬리면 「Ctrl+휠일 때만 확대」로
          // 바꾸면 됩니다(구글 지도 임베드가 쓰는 방식).
          scrollwheel: true,
        });
        mapsRef.current = maps;
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("unavailable");
      });

    return () => {
      cancelled = true;
      // 카카오맵에는 Leaflet의 map.remove()에 해당하는 정리 함수가 없습니다.
      // 컨테이너 DOM이 사라지면 지도도 함께 정리되므로 오버레이만 떼어냅니다.
      overlaysRef.current.forEach((o) => o.setMap(null));
      overlaysRef.current = [];
      mapRef.current = null;
    };
    // 최초 1회만 — center/programs 변경은 아래 effect에서 처리
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 마커 갱신
  useEffect(() => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (!maps || !map) return;

    overlaysRef.current.forEach((o) => o.setMap(null));
    overlaysRef.current = [];

    const bounds = new maps.LatLngBounds();
    let points = 0;
    let last = null as { lat: number; lng: number } | null;

    programs.forEach((p) => {
      const position = new maps.LatLng(p.location.lat, p.location.lng);
      const overlay = new maps.CustomOverlay({
        position,
        content: pinElement(
          `${p.price.toLocaleString()}원`,
          p.id === selectedId,
          onSelect ? () => onSelect(p.id) : undefined
        ),
        // 핀 아래 끝이 좌표를 가리키게 합니다(기본값은 가운데).
        yAnchor: 1,
        clickable: true,
        zIndex: p.id === selectedId ? 2 : 1,
      });
      overlay.setMap(map);
      overlaysRef.current.push(overlay);
      bounds.extend(position);
      points += 1;
      last = p.location;
    });

    if (userLocation) {
      const position = new maps.LatLng(userLocation.lat, userLocation.lng);
      const overlay = new maps.CustomOverlay({ position, content: userElement() });
      overlay.setMap(map);
      overlaysRef.current.push(overlay);
      bounds.extend(position);
      points += 1;
      last = userLocation;
    }

    // 표시할 지점이 2개 이상이면 전부 보이도록 화면을 맞춥니다.
    if (points > 1) {
      map.setBounds(bounds);
    } else if (points === 1 && last) {
      map.setCenter(new maps.LatLng(last.lat, last.lng));
      map.setLevel(LEVEL_SINGLE);
    }
  }, [programs, selectedId, onSelect, userLocation, status]);

  // 컨테이너 크기가 바뀌면 지도에 알려줘야 합니다 — 안 하면 남는 자리가 회색으로
  // 비거나 타일이 잘린 채로 있습니다(Leaflet의 invalidateSize에 해당).
  //
  // 두 경우를 함께 처리합니다.
  //  ① 부모가 토글로 숨겼다 다시 보여줄 때 → 렌더마다 한 번 (아래 setTimeout)
  //  ② 창 크기가 바뀔 때 → resize 이벤트. 리렌더가 없어 ①만으로는 안 잡힙니다
  //
  // relayout()은 중심을 흔들어놓기도 해서, 직전 중심을 기억했다가 되돌립니다.
  useEffect(() => {
    function relayout() {
      const map = mapRef.current;
      if (!map) return;
      const center = map.getCenter();
      map.relayout();
      map.setCenter(center);
    }

    const initial = window.setTimeout(relayout, 80);

    // 크기 변경 중에는 이벤트가 연달아 오므로 마지막 한 번만 반영합니다.
    let pending = 0;
    function onResize() {
      window.clearTimeout(pending);
      pending = window.setTimeout(relayout, 150);
    }
    window.addEventListener("resize", onResize);

    return () => {
      window.clearTimeout(initial);
      window.clearTimeout(pending);
      window.removeEventListener("resize", onResize);
    };
  });

  if (status === "unavailable") {
    return (
      <div
        className={cn(
          "flex h-[440px] w-full items-center justify-center rounded-xl border bg-muted px-6 text-center",
          className
        )}
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          지도를 불러오지 못했습니다.
          <br />
          주소는 위에 표시된 내용으로 확인해 주세요.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("z-0 h-[440px] w-full overflow-hidden rounded-xl border", className)}
      role="application"
      aria-label="프로그램 위치 지도"
    />
  );
}
