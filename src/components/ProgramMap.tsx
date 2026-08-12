import { useEffect, useRef } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Program } from "@/types/firestore";
import { DEFAULT_CENTER, type LatLng } from "@/lib/geo";
import { cn } from "@/lib/utils";

/**
 * 지도 컴포넌트 (프로토타입 — Leaflet + OpenStreetMap).
 *
 * ⚠️ 교체 예정: 벤더 선정 문서 2번에 따라 최종 지도는 **카카오맵**입니다.
 * 카카오 개발자센터 앱 등록(JavaScript 키 발급) 전이라 키가 필요 없는
 * Leaflet+OSM으로 먼저 만들었습니다.
 *
 * TODO(연동): 카카오맵으로 교체할 때 **이 파일만** 바꾸면 되도록 설계했습니다.
 *   - 아래 props(programs / center / selectedId / onSelect / userLocation)를 그대로 유지하고
 *     내부 구현만 `kakao.maps.Map` + `kakao.maps.Marker`로 바꾸면 호출부는 수정 불필요.
 *   - index.html에 `//dapi.kakao.com/v2/maps/sdk.js?appkey=...&autoload=false` 스크립트 추가 필요.
 *   - 키는 반드시 환경변수(VITE_KAKAO_MAP_KEY)로 주입하고, 카카오 콘솔에서 도메인 제한을 걸어야 합니다.
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

/** 기본 마커 이미지는 번들러에서 경로가 깨지므로 divIcon으로 직접 그립니다 */
function pinIcon(label: string, active: boolean) {
  return L.divIcon({
    className: "",
    html: `<div style="
      transform: translate(-50%, -100%);
      white-space: nowrap;
      background: ${active ? "#163F2E" : "#1F5C43"};
      color: #fff;
      font: 600 12px/1 Pretendard, 'Apple SD Gothic Neo', sans-serif;
      padding: 6px 9px;
      border-radius: 100px;
      border: 2px solid #fff;
      box-shadow: 0 2px 6px rgba(0,0,0,.25);
    ">${label}</div>`,
    iconSize: [0, 0],
  });
}

function userIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="
      transform: translate(-50%, -50%);
      width: 16px; height: 16px; border-radius: 50%;
      background: #2563eb; border: 3px solid #fff;
      box-shadow: 0 0 0 6px rgba(37,99,235,.22);
    "></div>`,
    iconSize: [0, 0],
  });
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
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);

  // 지도 인스턴스 1회 생성
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initial = center ?? (programs[0] ? programs[0].location : DEFAULT_CENTER);
    const map = L.map(containerRef.current, {
      center: [initial.lat, initial.lng],
      zoom: 9,
      scrollWheelZoom: false,
    });

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "© OpenStreetMap 기여자 | 프로토타입(최종 지도는 카카오맵으로 교체 예정)",
    }).addTo(map);

    markerLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
    };
    // 최초 1회만 — center/programs 변경은 아래 effect에서 처리
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 마커 갱신
  useEffect(() => {
    const map = mapRef.current;
    const layer = markerLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    programs.forEach((p) => {
      const marker = L.marker([p.location.lat, p.location.lng], {
        icon: pinIcon(`${p.price.toLocaleString()}원`, p.id === selectedId),
      });
      marker.bindPopup(
        `<div style="min-width:150px">
           <strong style="font-size:13px">${p.title}</strong><br/>
           <span style="font-size:12px;color:#6b7a72">${p.location.address}</span>
         </div>`
      );
      if (onSelect) marker.on("click", () => onSelect(p.id));
      marker.addTo(layer);
    });

    if (userLocation) {
      L.marker([userLocation.lat, userLocation.lng], { icon: userIcon() })
        .bindPopup("현재위치")
        .addTo(layer);
    }

    // 표시할 지점이 2개 이상이면 전부 보이도록 화면을 맞춥니다
    const points: L.LatLngExpression[] = programs.map((p) => [
      p.location.lat,
      p.location.lng,
    ]);
    if (userLocation) points.push([userLocation.lat, userLocation.lng]);
    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points).pad(0.25));
    } else if (points.length === 1) {
      map.setView(points[0], 11);
    }
  }, [programs, selectedId, onSelect, userLocation]);

  // 부모가 토글로 숨겼다 보여줄 때 타일이 회색으로 남는 문제 방지
  useEffect(() => {
    const id = window.setTimeout(() => mapRef.current?.invalidateSize(), 80);
    return () => window.clearTimeout(id);
  });

  return (
    <div
      ref={containerRef}
      className={cn("z-0 h-[440px] w-full overflow-hidden rounded-xl border", className)}
      role="application"
      aria-label="프로그램 위치 지도"
    />
  );
}
