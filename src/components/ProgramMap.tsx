import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LocateFixed, Minus, Plus } from "lucide-react";
import type { Program } from "@/types/firestore";
import ProgramMapCard from "@/components/ProgramMapCard";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { DEFAULT_CENTER, distanceKm, type LatLng } from "@/lib/geo";
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
  /** null이면 선택 해제입니다 — 카드의 닫기 버튼이 이 값을 씁니다 */
  onSelect?: (programId: string | null) => void;
  /** 현재위치 표시용 */
  userLocation?: LatLng | null;
  className?: string;
}

/** 여러 지점을 함께 볼 때(검색 목록) — 4km 축척 */
const LEVEL_OVERVIEW = 9;
/** 한 지점만 볼 때(상세) — 1km 축척 */
const LEVEL_SINGLE = 7;
/** 카카오가 허용하는 축척 범위. 벗어난 값을 넣으면 조용히 무시됩니다 */
const LEVEL_MIN = 1;
const LEVEL_MAX = 14;

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

  // 「내 위치」 버튼용. 부모가 위치를 이미 넘겨준 경우(검색 화면)에는 그 값을 쓰고,
  // 안 넘겨준 경우(상세 화면)에는 여기서 직접 물어봅니다.
  const { position: ownPosition, status: geoStatus, request: requestLocation } =
    useCurrentLocation();
  const myLocation = userLocation ?? ownPosition;

  // 지도를 특정 지점으로 옮기라는 신호. 값이 아니라 **매번 새 객체**를 넣는 이유는,
  // 같은 자리를 두 번 눌러도 다시 이동해야 하기 때문입니다.
  const [focus, setFocus] = useState<{ point: LatLng } | null>(null);

  // 카드를 담을 DOM 조각. **CustomOverlay는 HTMLElement를 받으므로** React가 그린
  // 내용을 그대로 넘길 수 없습니다 → 빈 div를 하나 만들어 오버레이에 넘기고,
  // 그 안으로 카드를 포털합니다. 이렇게 하면 카드를 평범한 React 컴포넌트로
  // 유지하면서(상태·링크·아이콘 그대로) 위치만 지도가 잡아줍니다.
  const [cardHost] = useState(() =>
    typeof document === "undefined" ? null : document.createElement("div")
  );
  const cardOverlayRef = useRef<KakaoCustomOverlay | null>(null);

  const selectedProgram = programs.find((p) => p.id === selectedId) ?? null;

  /**
   * 확대·축소 버튼.
   *
   * **부호가 직관과 반대입니다** — 카카오는 숫자가 작을수록 확대라서,
   * 확대(+) 버튼이 level을 1 **빼는** 쪽입니다.
   */
  function zoom(step: number) {
    const map = mapRef.current;
    if (!map) return;
    const next = Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, map.getLevel() + step));
    map.setLevel(next, { animate: true });
  }

  function goToMyLocation() {
    if (myLocation) {
      setFocus({ point: myLocation });
      return;
    }
    // 아직 위치를 모르면 브라우저에 물어봅니다. 받아오면 아래 effect가 이동시킵니다.
    requestLocation();
  }

  // 위치를 새로 받아온 순간 그 자리로 옮깁니다.
  useEffect(() => {
    if (ownPosition) setFocus({ point: ownPosition });
  }, [ownPosition]);

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
    });

    if (myLocation) {
      const position = new maps.LatLng(myLocation.lat, myLocation.lng);
      const overlay = new maps.CustomOverlay({ position, content: userElement() });
      overlay.setMap(map);
      overlaysRef.current.push(overlay);
    }
  }, [programs, selectedId, onSelect, myLocation, status]);

  // 화면 맞추기 — **표시할 지점이 바뀔 때만** 합니다.
  //
  // 마커 갱신과 한 덩어리로 두면 핀을 누를 때마다(selectedId 변경) 화면이 다시
  // 맞춰집니다. 카드를 보려고 핀을 눌렀는데 지도가 통째로 움직이는 셈이라
  // 어디를 눌렀는지 놓치게 됩니다.
  //
  // **배열이 아니라 좌표를 이어붙인 문자열을 의존성으로 씁니다.** 호출부가
  // `filtered.map(...)`처럼 매번 새 배열을 넘기면 내용이 같아도 다른 값으로 취급돼,
  // 화면이 리렌더될 때마다 지도가 원래 위치로 튕겨 돌아갑니다.
  const pointsKey =
    programs.map((p) => `${p.id}:${p.location.lat},${p.location.lng}`).join("|") +
    (myLocation ? `@${myLocation.lat},${myLocation.lng}` : "");

  useEffect(() => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (!maps || !map) return;

    const points: LatLng[] = programs.map((p) => p.location);
    if (myLocation) points.push(myLocation);

    if (points.length > 1) {
      const bounds = new maps.LatLngBounds();
      points.forEach((pt) => bounds.extend(new maps.LatLng(pt.lat, pt.lng)));
      map.setBounds(bounds);
    } else if (points.length === 1) {
      map.setCenter(new maps.LatLng(points[0].lat, points[0].lng));
      map.setLevel(LEVEL_SINGLE);
    }
    // programs·myLocation은 위 pointsKey가 대표합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointsKey, status]);

  // 선택한 프로그램의 카드를 그 지점 위에 띄웁니다.
  //
  // 마커를 다시 그릴 때마다 오버레이를 만들지 않고 **카드는 따로 관리**합니다 —
  // 같이 두면 핀 하나 바뀔 때마다 카드가 사라졌다 다시 뜹니다.
  // 다른 핀을 누르면 selectedId가 바뀌므로 **열려 있던 카드는 자동으로 닫힙니다.**
  useEffect(() => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (!maps || !map || !cardHost) return;

    cardOverlayRef.current?.setMap(null);
    cardOverlayRef.current = null;

    if (!selectedProgram) return;

    const position = new maps.LatLng(
      selectedProgram.location.lat,
      selectedProgram.location.lng
    );

    // 가장자리 핀을 누르면 카드가 지도 밖으로 잘립니다 — 고른 지점을 가운데로 옮깁니다.
    map.panTo(position);

    const overlay = new maps.CustomOverlay({
      position,
      content: cardHost,
      // 카드 아래 끝을 좌표에 맞춥니다. 카드 안쪽 아래 여백(pb-11)이 핀 자리입니다.
      yAnchor: 1,
      // 핀(1~2)보다 위에 있어야 다른 핀에 가리지 않습니다.
      zIndex: 10,
      // 카드 안에서 드래그·클릭할 때 지도가 따라 움직이지 않게 합니다.
      clickable: true,
    });
    overlay.setMap(map);
    cardOverlayRef.current = overlay;

    return () => {
      overlay.setMap(null);
      cardOverlayRef.current = null;
    };
  }, [selectedProgram, cardHost, status]);

  // 「내 위치」로 이동.
  //
  // **이 effect는 위 마커 effect보다 아래에 있어야 합니다.** 내 위치가 새로 들어오면
  // 위 effect가 먼저 돌면서 "전부 보이게" 화면을 맞추는데(setBounds), 그러면 내 위치가
  // 아니라 프로그램까지 다 나오도록 축소돼 버립니다. effect는 선언 순서대로 실행되므로
  // 여기가 나중에 돌아 덮어씁니다.
  useEffect(() => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (!maps || !map || !focus) return;
    map.setCenter(new maps.LatLng(focus.point.lat, focus.point.lng));
    map.setLevel(LEVEL_SINGLE, { animate: true });
  }, [focus]);

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

  // 위치를 못 받은 이유는 알려줘야 합니다 — 버튼을 눌렀는데 아무 일도 안 일어나면
  // 고장으로 읽힙니다. 권한 거부는 브라우저 설정에서만 되돌릴 수 있습니다.
  const geoMessage =
    geoStatus === "denied"
      ? "위치 권한이 거부돼 있습니다. 주소창 왼쪽 자물쇠에서 허용해 주세요."
      : geoStatus === "unsupported"
        ? "이 브라우저에서는 현재위치를 쓸 수 없습니다."
        : null;

  return (
    <div
      className={cn(
        "relative z-0 h-[440px] w-full overflow-hidden rounded-xl border",
        className
      )}
    >
      <div
        ref={containerRef}
        className="h-full w-full"
        role="application"
        aria-label="프로그램 위치 지도"
      />

      {/* 휠이 없는 환경(노트북 터치패드·태블릿)을 위한 조작 버튼.
          지도 위에 얹으므로 z-10 — 카카오가 타일과 오버레이에 쓰는 값보다 위입니다. */}
      {status === "ready" && (
        <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5">
          <div className="flex flex-col overflow-hidden rounded-lg border bg-background shadow-sm">
            <button
              type="button"
              onClick={() => zoom(-1)}
              aria-label="확대"
              title="확대"
              className="flex h-9 w-9 items-center justify-center hover:bg-secondary"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => zoom(1)}
              aria-label="축소"
              title="축소"
              className="flex h-9 w-9 items-center justify-center border-t hover:bg-secondary"
            >
              <Minus className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={goToMyLocation}
            disabled={geoStatus === "loading"}
            aria-label="내 위치로 이동"
            title="내 위치로 이동"
            className="flex h-9 w-9 items-center justify-center rounded-lg border bg-background shadow-sm hover:bg-secondary disabled:opacity-60"
          >
            <LocateFixed
              className={cn("h-4 w-4", myLocation && "text-primary")}
            />
          </button>
        </div>
      )}

      {/* 카드는 지도 위(CustomOverlay 안)에 그려집니다 — 이 자리에는 자국만 남습니다 */}
      {cardHost &&
        selectedProgram &&
        createPortal(
          <ProgramMapCard
            key={selectedProgram.id}
            program={selectedProgram}
            distanceKm={
              myLocation ? distanceKm(myLocation, selectedProgram.location) : null
            }
            onClose={() => onSelect?.(null)}
          />,
          cardHost
        )}

      {geoMessage && (
        <p className="absolute inset-x-3 bottom-3 z-10 rounded-lg bg-background/95 px-3 py-2 text-xs leading-relaxed shadow-sm">
          {geoMessage}
        </p>
      )}
    </div>
  );
}
