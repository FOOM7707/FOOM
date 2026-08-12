import { useCallback, useState } from "react";
import type { LatLng } from "@/lib/geo";

type Status = "idle" | "loading" | "granted" | "denied" | "unsupported";

/**
 * 브라우저 Geolocation으로 현재위치를 받아옵니다.
 * 와이어프레임 v2 "전체지역 / 현재위치" 2모드 중 현재위치 모드에 대응.
 *
 * 참고: HTTPS(또는 localhost)에서만 동작하고, 사용자가 권한을 거부하면 denied로 떨어집니다.
 * 거부 시에도 화면이 깨지지 않도록 호출부에서 fallback(전체지역)을 유지해야 합니다.
 */
export function useCurrentLocation() {
  const [position, setPosition] = useState<LatLng | null>(null);
  const [status, setStatus] = useState<Status>("idle");

  const request = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus("unsupported");
      return;
    }
    setStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setStatus("granted");
      },
      () => setStatus("denied"),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 }
    );
  }, []);

  const clear = useCallback(() => {
    setPosition(null);
    setStatus("idle");
  }, []);

  return { position, status, request, clear };
}
