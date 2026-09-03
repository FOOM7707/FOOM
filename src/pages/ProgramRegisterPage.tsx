/**
 * 프로그램 등록·수정 (`/programs/new`, `/programs/:id/edit`).
 *
 * **한 화면이 등록과 수정을 겸합니다.** 받는 값과 검증이 완전히 같아서 화면을 둘로
 * 나누면 한쪽만 고치는 일이 반드시 생깁니다(필드가 20개 가까이 됩니다).
 *
 * 수정도 **서버(`PATCH /programs/{id}`)를 거칩니다.** 보안규칙은 작성 중(draft)
 * 문서의 클라이언트 직접 수정을 허용하지만, 그 길로 가면 지역·난이도 같은
 * 파생 필드가 갱신되지 않아 원본과 사본이 어긋납니다(2-3).
 *
 * **게시 중인 프로그램의 심사 대상 필드를 고치면 서버가 재심사로 되돌립니다.**
 * 화면은 그 결과를 응답으로 받아 안내만 합니다 — 판단을 화면에서 따라 계산하면
 * 서버 규칙이 바뀔 때 두 곳이 어긋납니다.
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CATEGORIES } from "../types/firestore";
import type { ScheduleType } from "../types/firestore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import AddressSearchField from "@/components/AddressSearchField";
import FormCard from "@/components/FormCard";
import { cn } from "@/lib/utils";
import {
  Accessibility,
  BookOpen,
  CalendarDays,
  Images,
  ListChecks,
  MapPin,
  SquarePen,
  Users,
} from "lucide-react";
import ScheduleFields, {
  emptyScheduleRow,
  toSchedulePayload,
  type ScheduleRowInput,
} from "@/components/ScheduleFields";
import SavedSchedules, { type SavedSchedule } from "@/components/SavedSchedules";
import ProgramImageUploader, { MAX_IMAGES } from "@/components/ProgramImageUploader";
import PendingImagePicker from "@/components/PendingImagePicker";
import KeywordPicker from "@/components/KeywordPicker";
import IntroBlockEditor from "@/components/IntroBlockEditor";
import {
  EXCLUDE_OPTIONS,
  INCLUDE_OPTIONS,
  PREPARATION_OPTIONS,
  emptyIntroBlock,
  emptyKeywordField,
  type IntroBlock,
  type KeywordField,
} from "@/lib/programContent";
import { useAuth } from "@/hooks/useAuth";
import { useMe } from "@/hooks/useMe";
import { ApiError, apiFetch } from "@/lib/api";
import { ImageResizeError } from "@/lib/imageResize";
import {
  makePendingPhoto,
  pendingPath,
  releasePendingPhoto,
  uploadPendingPhotos,
  type PendingPhoto,
} from "@/lib/pendingPhotos";
import type { IntroBlockImage } from "@/lib/programContent";
import type { PickedPlace } from "@/lib/places";

// 「매주 반복」은 선택지에서 뺐습니다(2026-08-27, 팀 요청). 반복 회차를 만드는
// 서버 경로가 없어 그전에도 고를 수 없게 막아둔 상태였는데, 눌러도 안 되는 칸이
// 남아 있으면 「우리가 못 하는 것」으로 읽힙니다. 회차제로 같은 요일을 여러 줄
// 추가하면 같은 결과가 되므로 대체 수단은 이미 있습니다.
//
// **서버는 그대로 둡니다.** `weekly`로 저장된 옛 프로그램의 심사 요청은 계속
// 거부되고(2-4), 반복 템플릿을 만드는 날 화면과 서버를 함께 엽니다.
const SCHEDULE_OPTIONS: {
  value: ScheduleType;
  label: string;
  hint: string;
}[] = [
  { value: "single", label: "1회성", hint: "특정 날짜 1회만 진행" },
  { value: "series", label: "회차제", hint: "여러 회차로 나눠 순차 진행" },
  { value: "open", label: "상시모집(협의형)", hint: "정원 없이 결제 후 채팅으로 일정 협의" },
];

// 스키마 2-2 qualificationType 5종
const QUALIFICATIONS = [
  { value: "forest_interpreter", label: "숲해설가" },
  { value: "infant_forest_instructor", label: "유아숲지도사" },
  { value: "mountain_trail_guide", label: "숲길등산지도사" },
  { value: "forest_healing_instructor_1", label: "산림치유지도사 1급" },
  { value: "forest_healing_instructor_2", label: "산림치유지도사 2급" },
];

const RAIN_OPTIONS = [
  { value: "none", label: "없음 (우천 시 진행 불가)" },
  { value: "indoor", label: "실내로 바꿔서 진행" },
  { value: "reschedule", label: "다른 날로 옮김" },
];

function optionalNumber(raw: FormDataEntryValue | null): number | null {
  if (raw == null || String(raw).trim() === "") return null;
  return Number(raw);
}

interface LoadedProgram {
  id: string;
  title: string;
  description: string;
  category: string;
  qualificationType: string;
  location: { address: string; lat: number | null; lng: number | null };
  price: number;
  capacity: number;
  minCapacity: number;
  scheduleType: ScheduleType;
  availableFrom: string | null;
  availableUntil: string | null;
  barrierFree: boolean;
  targetAgeMin: number | null;
  targetAgeMax: number | null;
  walkingDistanceM: number | null;
  rainAlternative: string;
  status: string;
  schedules: SavedSchedule[];
  imageUrls: string[];
  /** 사진 주소와 짝을 이루는 버킷 경로. 삭제·순서 변경에 씁니다(18-4) */
  imagePaths: string[];
  /** (20-6) 목록용 작은 사진. 미리보기에 씁니다 */
  thumbUrls?: string[];
  includes: KeywordField;
  excludes: KeywordField;
  preparations: KeywordField;
  introBlocks: IntroBlock[];
  /** 승인 대기 중인 수정본 (게시 중인 프로그램만). 없으면 null */
  pendingEdit: { changedFields: string[] } | null;
  /** 수정본이 반려된 사유. 게시본은 그대로 살아 있습니다 */
  editReviewNote?: string | null;
}

/** 항목 이름 → 사람이 읽는 이름 */
const FIELD_LABEL: Record<string, string> = {
  title: "프로그램명",
  description: "소개",
  category: "카테고리",
  qualificationType: "자격 유형",
  location: "장소",
  price: "가격",
  capacity: "최대 인원",
  minCapacity: "최소 인원",
  scheduleType: "운영 방식",
  imageUrls: "사진",
  targetAgeMin: "참가 연령(최소)",
  targetAgeMax: "참가 연령(최대)",
  includes: "포함 사항",
  excludes: "불포함 사항",
  preparations: "준비물",
  introBlocks: "프로그램 소개",
};

export default function ProgramRegisterPage() {
  const { user, loading } = useAuth();
  const { me, loading: meLoading } = useMe();
  const navigate = useNavigate();
  const { id: editingId } = useParams<{ id: string }>();
  const isEdit = editingId != null;

  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState<LoadedProgram | null>(null);
  const [loadingProgram, setLoadingProgram] = useState(isEdit);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  // 주소는 검색해서 고른 값만 씁니다 — 좌표를 함께 받아야 날씨가 붙습니다(16-4).
  const [place, setPlace] = useState<PickedPlace | null>(null);
  // 운영 방식·최대 인원·회차는 서로 영향을 주므로 폼 값으로 두지 않고 상태로 관리합니다
  // (방식에 따라 날짜 칸이 바뀌고, 최대 인원이 회차 정원의 기본값이 됩니다).
  const [scheduleType, setScheduleType] = useState<ScheduleType | null>(null);
  const [capacity, setCapacity] = useState("");
  const [scheduleRows, setScheduleRows] = useState<ScheduleRowInput[]>([]);
  // 포함·불포함·준비물·소개 블록도 폼 값이 아니라 상태로 둡니다 — 칩 선택과
  // 블록 편집은 입력칸 하나로 표현되지 않습니다.
  const [includes, setIncludes] = useState<KeywordField>(emptyKeywordField());
  const [excludes, setExcludes] = useState<KeywordField>(emptyKeywordField());
  const [preparations, setPreparations] = useState<KeywordField>(emptyKeywordField());
  // 소개 블록은 **한 칸이 열린 상태로 시작합니다** (2026-08-27, 팀 요청).
  // 「＋ 소개 블록 추가」를 눌러야 칸이 나타나는 방식이었는데, 그 버튼을 찾지 못해
  // 소개를 아예 안 쓰고 넘어가는 일이 생깁니다(첫 블록이 상세 페이지의 첫 문단입니다).
  // 손대지 않은 빈 칸은 저장할 때 걸러내므로, 소개를 안 쓰고 저장해도 막히지 않습니다.
  const [introBlocks, setIntroBlocks] = useState<IntroBlock[]>([emptyIntroBlock()]);

  // 저장 전에 고른 사진 (등록 화면에서만 씁니다 — 수정 화면은 바로 올립니다).
  // 사진이 저장될 자리 이름에 프로그램 번호가 들어가서 저장 전에는 올릴 곳이
  // 없습니다(18-3). 그래서 브라우저가 들고 있다가 저장할 때 함께 올립니다.
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  /** 저장할 때 함께 올라간 사진 장수 — 저장 완료 화면의 안내가 달라집니다 */
  const [createdPhotoCount, setCreatedPhotoCount] = useState(0);
  const [photoProgress, setPhotoProgress] = useState<string | null>(null);

  /** 수정 모드에서 기존 값을 불러와 폼을 채웁니다. */
  const loadProgram = useCallback(async () => {
    if (!editingId) return;
    setLoadingProgram(true);
    setError(null);
    try {
      const res = await apiFetch<{ program: LoadedProgram }>(`/programs/${editingId}`, {
        requireAuth: true,
      });
      setLoaded(res.program);
      setScheduleType(res.program.scheduleType);
      setCapacity(String(res.program.capacity ?? ""));
      // 저장된 주소를 그대로 다시 씁니다. 좌표가 비어 있는 옛 프로그램(v18 이전)은
      // 주소를 다시 검색해 고르지 않으면 좌표가 계속 빈 채로 남습니다 — 그러면
      // 상세 화면에 날씨가 붙지 않습니다(19-6).
      //
      // **없는 좌표는 null 그대로 둡니다.** 0으로 채우면 저장할 때 「좌표 없음」이
      // 「위도 0·경도 0」이라는 틀린 좌표로 바뀌어, 상세 화면의 지도가 아프리카
      // 앞바다를 그리게 됩니다 — 에러가 없어 아무도 알아차리지 못합니다.
      setPlace({
        address: res.program.location.address,
        roadAddress: null,
        placeName: null,
        lat: res.program.location.lat ?? null,
        lng: res.program.location.lng ?? null,
        sido: null,
      });
      setIncludes(res.program.includes ?? emptyKeywordField());
      setExcludes(res.program.excludes ?? emptyKeywordField());
      setPreparations(res.program.preparations ?? emptyKeywordField());
      // 저장된 소개가 없으면 등록 화면과 같이 한 칸을 열어둡니다.
      const savedBlocks = res.program.introBlocks ?? [];
      setIntroBlocks(savedBlocks.length > 0 ? savedBlocks : [emptyIntroBlock()]);
      // 새로 추가할 줄은 비운 상태로 시작합니다 — 이미 저장된 날짜는 위에 따로 보여줍니다.
      setScheduleRows([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "프로그램을 불러오지 못했습니다");
    } finally {
      setLoadingProgram(false);
    }
  }, [editingId]);

  useEffect(() => {
    if (isEdit && user) void loadProgram();
  }, [isEdit, user, loadProgram]);

  /** 승인 대기 중인 수정본을 버립니다. 게시본은 그대로 남습니다. */
  async function cancelPendingEdit() {
    if (!editingId) return;
    if (!window.confirm("승인 대기 중인 수정 내용을 취소할까요? 게시된 내용은 그대로 남습니다.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/programs/${editingId}/pending-edit`, {
        method: "DELETE",
        requireAuth: true,
      });
      await loadProgram();
      setSavedMessage("수정 요청을 취소했습니다. 게시된 내용은 그대로입니다.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "취소에 실패했습니다");
    } finally {
      setBusy(false);
    }
  }

  /** 저장된 회차 삭제 — 서버가 즉시 지우고 날짜 요약을 다시 계산합니다. */
  async function deleteSavedSchedule(scheduleId: string) {
    if (!editingId) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/programs/${editingId}/schedules/${scheduleId}`, {
        method: "DELETE",
        requireAuth: true,
      });
      await loadProgram();
      setSavedMessage("날짜를 지웠습니다.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "날짜를 지우지 못했습니다");
    } finally {
      setBusy(false);
    }
  }

  function changeScheduleType(next: ScheduleType) {
    setScheduleType(next);
    if (isEdit) {
      // 수정 모드에서는 이미 저장된 날짜가 있으므로 빈 줄을 자동으로 만들지 않습니다.
      if (next !== "single" && next !== "series") setScheduleRows([]);
      return;
    }
    if (next === "single") {
      setScheduleRows((rows) => (rows.length > 0 ? rows.slice(0, 1) : [emptyScheduleRow(capacity)]));
    } else if (next === "series") {
      setScheduleRows((rows) => (rows.length > 0 ? rows : [emptyScheduleRow(capacity)]));
    } else {
      // 상시모집은 날짜를 받지 않습니다(매주 반복은 옛 프로그램에만 남아 있습니다).
      setScheduleRows([]);
    }
  }

  function changeCapacity(next: string) {
    setCapacity(next);
    // 아직 손대지 않은 회차 정원만 따라 바꿉니다 — 회차별로 고친 값을 덮지 않습니다.
    setScheduleRows((rows) =>
      rows.map((r) => (r.capacity === capacity || r.capacity === "" ? { ...r, capacity: next } : r))
    );
  }

  /**
   * 소개 블록에서 고를 수 있는 사진.
   *
   * 수정 화면은 **이미 올라간 사진**, 등록 화면은 **저장 대기 중인 사진**입니다.
   * 어느 쪽이든 위 「프로그램 사진」과 같은 목록입니다 — 목록이 하나여야 같은 사진을
   * 두 번 올리지 않습니다(20-3).
   */
  const photoPool: IntroBlockImage[] =
    isEdit && loaded
      ? (loaded.imagePaths ?? []).map((path, i) => ({
          path,
          url: (loaded.imageUrls ?? [])[i] ?? "",
        }))
      : pending.map((p) => ({ path: pendingPath(p.id), url: p.previewUrl }));

  const atPhotoLimit = photoPool.length >= MAX_IMAGES;

  /**
   * 사진 추가 — 「프로그램 사진」 칸과 소개 블록의 「새 사진」이 함께 씁니다.
   *
   * 수정 화면에서는 바로 올려 서버에 기록하고, 등록 화면에서는 대기 목록에만 넣습니다.
   * **넣은 사진을 돌려줍니다** — 소개 블록에서 눌렀으면 그 블록에 바로 넣기 위해서입니다.
   */
  async function addPhotos(files: FileList | null): Promise<IntroBlockImage[]> {
    if (!files || files.length === 0) return [];
    setError(null);

    const room = MAX_IMAGES - photoPool.length;
    const picked = Array.from(files).slice(0, Math.max(room, 0));
    if (picked.length === 0) {
      setError(`사진은 ${MAX_IMAGES}장까지 넣을 수 있습니다. 먼저 빼고 추가해 주세요.`);
      return [];
    }

    setPhotoBusy(true);
    try {
      // 크기 줄이기는 고를 때 바로 합니다 — 저장 버튼을 누른 뒤에 몰아서 하면
      // 기다리는 시간이 한꺼번에 몰립니다(20-6).
      const made: PendingPhoto[] = [];
      for (let i = 0; i < picked.length; i += 1) {
        setPhotoProgress(`${i + 1}/${picked.length} 사진을 줄이는 중…`);
        made.push(await makePendingPhoto(picked[i]));
      }

      if (isEdit && editingId) {
        const uploaded = await uploadPendingPhotos(editingId, made, (done, total) =>
          setPhotoProgress(`${done}/${total} 올리는 중…`)
        );
        setPhotoProgress("저장하는 중…");
        await apiFetch(`/programs/${editingId}/images`, {
          method: "POST",
          requireAuth: true,
          body: {
            images: uploaded.map(({ path, url, thumbPath, thumbUrl }) => ({
              path,
              url,
              thumbPath,
              thumbUrl,
            })),
          },
        });
        // 미리보기는 더 필요 없습니다 — 서버가 준 주소를 씁니다
        made.forEach(releasePendingPhoto);
        await loadProgram();
        return uploaded.map(({ path, url }) => ({ path, url }));
      }

      setPending((prev) => [...prev, ...made]);
      return made.map((p) => ({ path: pendingPath(p.id), url: p.previewUrl }));
    } catch (err) {
      setError(
        err instanceof ImageResizeError || err instanceof ApiError
          ? err.message
          : "사진을 올리지 못했습니다. 다시 시도해 주세요."
      );
      return [];
    } finally {
      setPhotoBusy(false);
      setPhotoProgress(null);
    }
  }

  /**
   * 대기 중인 사진 빼기 — **소개 블록에서도 함께 뺍니다.**
   *
   * 서버의 사진 삭제와 같은 규칙입니다(연쇄 정리). 빼지 않으면 없는 사진을 가리키는
   * 블록이 남고, 저장할 때 거부됩니다.
   */
  function removePending(id: string) {
    const target = pending.find((p) => p.id === id);
    if (target) releasePendingPhoto(target);
    setPending((prev) => prev.filter((p) => p.id !== id));
    setIntroBlocks((prev) =>
      prev.map((b) => ({ ...b, images: b.images.filter((im) => im.path !== pendingPath(id)) }))
    );
  }

  /** 순서 바꾸기 — 첫 장이 대표 사진입니다(2-3) */
  function movePending(index: number, direction: -1 | 1) {
    const next = index + direction;
    if (next < 0 || next >= pending.length) return;
    setPending((prev) => {
      const copy = [...prev];
      [copy[index], copy[next]] = [copy[next], copy[index]];
      return copy;
    });
  }

  function resetForm() {
    setCreatedId(null);
    setCreatedPhotoCount(0);
    pending.forEach(releasePendingPhoto);
    setPending([]);
    setPlace(null);
    setScheduleType(null);
    setCapacity("");
    setScheduleRows([]);
    setIncludes(emptyKeywordField());
    setExcludes(emptyKeywordField());
    setPreparations(emptyKeywordField());
    setIntroBlocks([emptyIntroBlock()]);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    if (!place) {
      setError("장소를 검색해서 선택해 주세요");
      setBusy(false);
      return;
    }

    if (!scheduleType) {
      setError("운영 방식을 선택해 주세요");
      setBusy(false);
      return;
    }

    // 포함·불포함 모순은 서버도 거부합니다. 여기서 먼저 막는 이유: 저장을 누른
    // 뒤에 알리면 어느 항목이 문제인지 찾기 어렵습니다.
    const conflictKeys = includes.keys.filter((k) => excludes.keys.includes(k));
    const conflictCustom = includes.custom.filter((c) => excludes.custom.includes(c));
    if (conflictKeys.length > 0 || conflictCustom.length > 0) {
      setError("같은 항목이 포함과 불포함에 함께 있습니다. 한쪽에서 빼 주세요");
      setBusy(false);
      return;
    }

    // **아무것도 손대지 않은 칸은 없는 것으로 봅니다.** 화면이 소개 블록 한 칸을
    // 미리 열어두므로(위 useState), 걸러내지 않으면 소개를 안 쓴 사람이 저장할 때마다
    // 「1번째 소개 블록을 채우거나 지우세요」에 막힙니다.
    const filledIntroBlocks = introBlocks.filter(
      (b) =>
        !(b.heading.trim() === "" && b.body.trim() === "" && b.images.length === 0)
    );

    // 사진만 있고 글이 없는 블록은 서버도 거부합니다(무슨 사진인지 알 수 없음).
    // 여기서 먼저 막는 이유: 등록 경로는 사진을 나중에 연결하므로 서버 메시지가
    // 「블록이 비어 있습니다」로 나와 사진을 넣었는데도 비었다고 읽힙니다.
    const emptyBlock = filledIntroBlocks.findIndex(
      (b) => b.heading.trim() === "" && b.body.trim() === ""
    );
    if (emptyBlock >= 0) {
      setError(
        `${emptyBlock + 1}번째 소개 블록에 소제목이나 설명을 넣어 주세요. 비워 둘 거라면 그 블록을 지워 주세요.`
      );
      setBusy(false);
      return;
    }

    const schedules = toSchedulePayload(scheduleRows, scheduleType);
    const dateBased = scheduleType === "single" || scheduleType === "series";
    // 날짜가 없으면 게시돼도 예약할 수 없습니다. 서버도 심사 요청 단계에서
    // 거부하지만, 그때 알리면 등록을 마친 뒤에 되돌아와야 합니다.
    // 수정 모드에서는 이미 저장된 날짜가 있으므로 새 줄이 비어 있어도 정상입니다.
    const savedCount = loaded?.schedules.length ?? 0;
    if (dateBased && schedules.length === 0 && savedCount === 0) {
      setError("진행 날짜를 입력해 주세요");
      setBusy(false);
      return;
    }

    const form = new FormData(e.currentTarget);
    const body = {
      title: form.get("title"),
      description: form.get("description"),
      category: form.get("category"),
      qualificationType: form.get("qualificationType"),
      // 주소·좌표는 한 쌍입니다. 좌표가 비면 그 프로그램에는 날씨가 안 붙습니다(16-4).
      location: { address: place.address, lat: place.lat, lng: place.lng },
      price: Number(form.get("price")),
      capacity: Number(capacity),
      minCapacity: Number(form.get("minCapacity")),
      scheduleType,
      availableFrom: form.get("availableFrom") || null,
      availableUntil: form.get("availableUntil") || null,
      barrierFree: form.get("barrierFree") === "on",
      targetAgeMin: optionalNumber(form.get("targetAgeMin")),
      targetAgeMax: optionalNumber(form.get("targetAgeMax")),
      walkingDistanceM: optionalNumber(form.get("walkingDistanceM")),
      rainAlternative: form.get("rainAlternative"),
      includes,
      excludes,
      preparations,
      introBlocks: filledIntroBlocks,
    };

    if (isEdit && editingId) {
      try {
        // 내용 먼저 저장합니다. 여기서 실패하면 날짜를 추가하지 않습니다 —
        // 순서를 뒤집으면 내용이 거부됐는데 날짜만 늘어난 상태가 남습니다.
        const res = await apiFetch<{
          status: string;
          sentToReview: boolean;
          pendingEdit: boolean;
          changedFields: string[];
        }>(
          `/programs/${editingId}`,
          { method: "PATCH", requireAuth: true, body }
        );
        if (schedules.length > 0) {
          await apiFetch(`/programs/${editingId}/schedules`, {
            method: "POST",
            requireAuth: true,
            body: { schedules },
          });
        }
        await loadProgram();
        setScheduleRows([]);
        setSavedMessage(
          res.pendingEdit
            ? `수정 내용을 접수했습니다. ${res.changedFields
                .map((f) => FIELD_LABEL[f] ?? f)
                .join(" · ")}은(는) 관리자 승인 후 반영됩니다 — 그때까지 손님에게는 지금 게시된 내용이 그대로 보입니다.`
            : res.sentToReview
              ? "수정했습니다. 심사 대상 항목이 바뀌어 다시 심사를 받습니다."
              : "수정했습니다. 바로 반영됐습니다."
        );
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "수정에 실패했습니다");
      } finally {
        setBusy(false);
      }
      return;
    }

    let newId: string;
    try {
      // 파생 필드(sido·difficulty·targetAgeTags·requiresChildInfo)는 보내지 않습니다.
      // 서버가 계산하며, 보안규칙 허용목록에도 없어 보내면 거부됩니다(2-3).
      //
      // 소개 블록의 사진은 **여기서 보내지 않습니다.** 사진이 저장될 자리 이름에
      // 프로그램 번호가 필요해서(18-3) 아직 올리지 못한 상태이고, 서버도 등록
      // 단계의 소개 블록 사진을 거부합니다. 저장 직후에 올려 연결합니다.
      const res = await apiFetch<{ id: string }>("/programs", {
        method: "POST",
        requireAuth: true,
        body: {
          ...body,
          introBlocks: filledIntroBlocks.map((b) => ({ ...b, images: [] })),
          schedules,
        },
      });
      newId = res.id;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "등록에 실패했습니다");
      setBusy(false);
      return;
    }

    // 사진은 프로그램이 만들어진 뒤에 올립니다.
    //
    // **여기서 실패해도 프로그램은 저장된 상태로 둡니다.** 되돌리면 방금 쓴 글이
    // 전부 사라지고, 사진은 수정 화면에서 다시 올릴 수 있습니다.
    if (pending.length > 0) {
      try {
        const uploaded = await uploadPendingPhotos(newId, pending, (done, total) =>
          setPhotoProgress(`사진 ${done}/${total} 올리는 중…`)
        );
        await apiFetch(`/programs/${newId}/images`, {
          method: "POST",
          requireAuth: true,
          body: {
            images: uploaded.map(({ path, url, thumbPath, thumbUrl }) => ({
              path,
              url,
              thumbPath,
              thumbUrl,
            })),
          },
        });

        // 소개 블록이 가리키던 임시 경로를 실제 경로로 바꿔 연결합니다.
        const byPendingPath = new Map(uploaded.map((u) => [pendingPath(u.id), u]));
        const linked = filledIntroBlocks.map((b) => ({
          ...b,
          images: b.images.flatMap((im) => {
            const found = byPendingPath.get(im.path);
            return found ? [{ path: found.path, url: found.url }] : [];
          }),
        }));
        if (linked.some((b) => b.images.length > 0)) {
          setPhotoProgress("소개 글에 사진을 넣는 중…");
          await apiFetch(`/programs/${newId}`, {
            method: "PATCH",
            requireAuth: true,
            body: { ...body, introBlocks: linked },
          });
        }

        pending.forEach(releasePendingPhoto);
        setCreatedPhotoCount(uploaded.length);
        setPending([]);
      } catch (err) {
        setError(
          (err instanceof ApiError ? `${err.message} — ` : "") +
            "프로그램은 저장됐지만 사진을 올리지 못했습니다. 아래 「사진·내용 수정」에서 다시 올려 주세요."
        );
      } finally {
        setPhotoProgress(null);
      }
    }

    setCreatedId(newId);
    setBusy(false);
  }

  async function handleSubmitForReview() {
    if (!createdId) return;
    setError(null);
    setBusy(true);
    try {
      await apiFetch(`/programs/${createdId}/submit-for-review`, {
        method: "POST",
        requireAuth: true,
      });
      navigate("/my/programs");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "심사 요청에 실패했습니다");
    } finally {
      setBusy(false);
    }
  }

  if (loading || meLoading || loadingProgram) {
    return <div className="container mx-auto max-w-[800px] px-5 py-8">불러오는 중…</div>;
  }

  if (!user) {
    return (
      <div className="container mx-auto max-w-[800px] px-5 py-8 pb-32">
        <Card className="bg-secondary">
          <CardContent className="pt-6">
            <h1 className="mb-3 text-lg font-bold">로그인이 필요합니다</h1>
            <p className="text-sm leading-relaxed">
              프로그램 등록은 공급자 계정만 가능합니다. 우측 상단에서 로그인해 주세요.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 공급자가 아니면 폼을 보여주지 않습니다. 예전에는 폼을 다 채운 뒤 저장할 때
  // permission-denied로 거부돼, 사용자가 무엇이 문제인지 알 수 없었습니다.
  if (me && me.role !== "provider") {
    return (
      <div className="container mx-auto max-w-[800px] px-5 py-8 pb-32">
        <Card className="bg-secondary">
          <CardContent className="pt-6">
            <h1 className="mb-3 text-lg font-bold">전문가 계정만 등록할 수 있습니다</h1>
            <p className="mb-4 text-sm leading-relaxed">
              프로그램 등록은 산림복지전문가 자격 확인을 거친 계정에만 열립니다. 등록 절차는
              안내 화면에서 확인하실 수 있습니다.
            </p>
            <Button asChild>
              <Link to="/provider/apply">전문가 등록 안내 보기</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isEdit && !loaded) {
    return (
      <div className="container mx-auto max-w-[800px] px-5 py-8 pb-32">
        <Card className="bg-secondary">
          <CardContent className="pt-6">
            <h1 className="mb-3 text-lg font-bold">프로그램을 불러오지 못했습니다</h1>
            <p className="mb-4 text-sm leading-relaxed">
              {error ?? "내 프로그램에서 다시 시도해 주세요."}
            </p>
            <Button asChild variant="outline">
              <Link to="/my/programs">내 프로그램으로</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (createdId) {
    return (
      <div className="container mx-auto max-w-[800px] px-5 py-8 pb-32">
        <Card className="bg-secondary">
          <CardContent className="pt-6">
            <h1 className="mb-3 text-lg font-bold text-secondary-foreground">
              작성 중(draft)으로 저장했습니다
            </h1>
            <p className="mb-4 text-sm leading-relaxed">
              아직 검색에 노출되지 않습니다.{" "}
              {createdPhotoCount > 0 ? (
                <>
                  <strong>사진 {createdPhotoCount}장도 함께 올라갔습니다.</strong>{" "}
                </>
              ) : (
                <>
                  <strong>사진이 없습니다</strong> — 목록과 검색 결과에서 빈 자리로 보입니다.
                  「사진·내용 수정」에서 넣을 수 있습니다.{" "}
                </>
              )}
              <strong>심사를 요청</strong>하면 관리자가 확인해 게시합니다.
            </p>
            {error && (
              <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2.5 text-[12.5px] text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {/* 사진을 올릴 수 있게 된 것은 지금부터입니다(18-3).
                  심사 요청보다 먼저 안내해야 사진 없는 프로그램이 올라가지 않습니다. */}
              {/* 사진은 저장할 때 함께 올라갑니다(v29) — 「사진 추가하기」가 더 이상
                  첫 단계가 아니라서 심사 요청을 첫 버튼으로 올렸습니다. */}
              <Button onClick={handleSubmitForReview} disabled={busy}>
                심사 요청하기
              </Button>
              <Button variant="outline" asChild>
                <Link to={`/programs/${createdId}/edit`}>사진·내용 수정</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/my/programs">내 프로그램 보기</Link>
              </Button>
              <Button
                variant="outline"
                onClick={resetForm}
              >
                하나 더 등록
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 연한 바탕 + 흰 카드 구성입니다 — 카드가 순백이라 바탕도 순백이면 경계가 흐려
  // 어디까지가 한 묶음인지 안 보입니다(참고 시안과 같은 구성).
  return (
    <div className="min-h-screen bg-[#F8FAF7]">
      <div className="container mx-auto max-w-[800px] px-5 py-8 pb-32">
      <h1 className="mb-1.5 text-[26px] font-extrabold tracking-tight">
        {isEdit ? "프로그램 수정" : "프로그램 등록"}
      </h1>
      {isEdit ? (
        <p className="mb-7 text-[14px] leading-relaxed text-muted-foreground">
          {loaded!.status === "published" ? (
            <>
              현재 <strong>게시 중</strong>입니다. 고쳐도 <strong>게시가 중단되지
              않습니다</strong> — 제목·소개·사진·가격·정원·장소처럼 심사 대상 항목은 관리자
              승인 후에 바뀌고, 그때까지 손님에게는 지금 내용이 그대로 보입니다. 배리어프리·
              우천 대체·걷는 거리, 그리고 <strong>날짜는 승인 없이 바로</strong> 반영됩니다.
            </>
          ) : loaded!.status === "hidden" ? (
            <>
              <strong>반려된 프로그램</strong>입니다. 내용을 고쳐 저장하면 자동으로 다시 심사를
              요청합니다.
            </>
          ) : loaded!.status === "pending_review" ? (
            <>
              <strong>심사 중</strong>입니다. 지금 고친 내용으로 심사받습니다.
            </>
          ) : (
            <>
              <strong>작성 중</strong>입니다. 자유롭게 고칠 수 있고, 심사를 요청해야 게시됩니다.
            </>
          )}
        </p>
      ) : (
        <p className="mb-7 text-[14px] leading-relaxed text-muted-foreground">
          저장하면 <strong>작성 중(draft)</strong> 상태가 되고, 심사를 요청해야 게시됩니다.
          {" "}
          <Link to="/my/programs" className="underline">
            내 프로그램
          </Link>
          에서 상태를 확인할 수 있습니다.
        </p>
      )}

      {loaded?.pendingEdit && (
        <div className="mb-4 rounded-lg border border-primary/40 bg-primary/5 px-3.5 py-3">
          <p className="text-[13px] leading-relaxed">
            <strong className="font-semibold text-primary">승인 대기 중인 수정 내용이 있습니다.</strong>{" "}
            {loaded.pendingEdit.changedFields.map((f) => FIELD_LABEL[f] ?? f).join(" · ")} — 승인되면
            반영됩니다. 지금 손님에게는 <strong>게시된 내용</strong>이 보입니다.
          </p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
            아래 값은 <strong>게시된 내용</strong>입니다. 다시 고쳐 저장하면 대기 중인 수정
            내용이 새것으로 바뀝니다.
          </p>
          <button
            type="button"
            onClick={() => void cancelPendingEdit()}
            disabled={busy}
            className="mt-2 text-[12.5px] text-muted-foreground underline hover:text-destructive disabled:opacity-50"
          >
            수정 요청 취소
          </button>
        </div>
      )}

      {loaded?.editReviewNote && !loaded.pendingEdit && (
        <p className="mb-4 rounded-lg bg-destructive/10 px-3.5 py-3 text-[13px] leading-relaxed text-destructive">
          <strong className="font-semibold">지난 수정 요청이 반려되었습니다.</strong>
          <br />
          {loaded.editReviewNote}
          <br />
          <span className="text-[12.5px]">게시된 내용은 그대로 유지되고 있습니다.</span>
        </p>
      )}

      {savedMessage && (
        <p className="mb-4 rounded-lg bg-secondary px-3 py-2.5 text-[13px] leading-relaxed text-secondary-foreground">
          {savedMessage}
        </p>
      )}

      {error && (
        <p className="mb-4 rounded-lg bg-destructive/10 px-3 py-2.5 text-[13px] leading-relaxed text-destructive">
          {error}
        </p>
      )}

      <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
        {/* 사진 (v29 — 등록 화면에서도 고를 수 있습니다).

            저장 자리 이름에 프로그램 번호가 필요한 것은 그대로입니다(18-3). 다만
            **브라우저가 파일을 들고 있다가 저장할 때 함께 올립니다** — 「글 다 쓰고
            저장하고 다시 들어와서 사진」은 작성하는 사람에게 두 번 일입니다. */}
        <FormCard
          title="대표 사진"
          icon={Images}
          desc="검색 목록과 상세 페이지 맨 위에 쓰이는 한 장입니다. 소개에 쓸 나머지 사진은 「프로그램 소개」의 각 블록에서 올립니다."
        >
          {isEdit && loaded ? (
            <ProgramImageUploader
              programId={loaded.id}
              imageUrls={loaded.imageUrls ?? []}
              imagePaths={loaded.imagePaths ?? []}
              thumbUrls={loaded.thumbUrls}
              onChanged={loadProgram}
            />
          ) : (
            <PendingImagePicker
              /* 대표는 목록의 첫 장입니다(imageUrls[0]). 이 칸은 그 한 장만 맡고,
                 소개 블록에서 올린 사진은 그 블록에서 관리합니다. */
              photos={pending.slice(0, 1)}
              max={1}
              onPick={addPhotos}
              onRemove={removePending}
              onMove={movePending}
              busy={photoBusy}
              progress={photoProgress}
            />
          )}
        </FormCard>

        {/* ── 기본 정보 ─────────────────────────────────────────────────── */}
        <FormCard title="기본 정보" icon={SquarePen}>
          <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">프로그램명</Label>
            <Input
              id="title"
              name="title"
              required
              placeholder="예: 주말 산림치유 명상 프로그램"
              defaultValue={loaded?.title ?? ""}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="description">소개</Label>
            <Textarea
              id="description"
              name="description"
              required
              rows={4}
              placeholder="프로그램 소개를 입력하세요"
              defaultValue={loaded?.description ?? ""}
            />
          </div>

          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="category">카테고리</Label>
              <Select id="category" name="category" required defaultValue={loaded?.category ?? ""}>
                <option value="" disabled>
                  선택하세요
                </option>
                {CATEGORIES.filter((c) => c !== "전체").map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="qualificationType">자격 유형</Label>
            <Select
              id="qualificationType"
              name="qualificationType"
              required
              defaultValue={loaded?.qualificationType ?? ""}
            >
              <option value="" disabled>
                선택하세요
              </option>
              {QUALIFICATIONS.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
          </div>
        </FormCard>

        {/* ── 장소와 가격 ───────────────────────────────────────────────── */}
        <FormCard title="장소와 가격" icon={MapPin}>
          <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="address">장소(주소)</Label>
            <AddressSearchField value={place} onChange={setPlace} />
          </div>

          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="price">가격(원)</Label>
              <Input
                id="price"
                name="price"
                type="number"
                min={0}
                required
                placeholder="35000"
                defaultValue={loaded?.price ?? ""}
              />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="minCapacity">최소 인원</Label>
            <Input
              id="minCapacity"
              name="minCapacity"
              type="number"
              min={1}
              required
              placeholder="4"
              defaultValue={loaded?.minCapacity ?? ""}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="capacity">최대 인원</Label>
            <Input
              id="capacity"
              name="capacity"
              type="number"
              min={1}
              required
              placeholder="12"
              value={capacity}
              onChange={(e) => changeCapacity(e.target.value)}
            />
          </div>
        </div>

          </div>
        </FormCard>

        {/* ── 운영 방식 ─────────────────────────────────────────────────── */}
        <FormCard
          title="운영 방식"
          icon={CalendarDays}
          desc="어떻게 진행할지 고르고, 실제로 여는 날짜를 넣습니다."
        >
          {/* 카드형 선택지 — 라디오 점만 있으면 무엇이 골라졌는지 한눈에 안 들어옵니다. */}
          <div className="grid gap-3 sm:grid-cols-2">
            {SCHEDULE_OPTIONS.map((opt) => {
              const selected = scheduleType === opt.value;
              return (
                <label
                  key={opt.value}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors hover:border-primary",
                    selected && "border-primary bg-secondary/60"
                  )}
                >
                  <input
                    type="radio"
                    name="scheduleType"
                    value={opt.value}
                    required
                    checked={selected}
                    onChange={() => changeScheduleType(opt.value)}
                    className="mt-0.5 accent-primary"
                  />
                  <span className="min-w-0">
                    <strong className="block text-[15px] font-bold">{opt.label}</strong>
                    <span className="mt-1 block text-[13px] leading-relaxed text-muted-foreground">
                      {opt.hint}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="mt-6 flex flex-col gap-3 border-t pt-5">
            <p className="text-[15px] font-bold">진행 날짜</p>

            {isEdit && loaded && (
              <>
                <SavedSchedules
                  scheduleType={loaded.scheduleType}
                  schedules={loaded.schedules}
                  onDelete={deleteSavedSchedule}
                  busy={busy}
                />
                {(scheduleType === "single" || scheduleType === "series") && (
                  <p className="text-[12.5px] text-muted-foreground">
                    날짜를 더 열려면 아래에서 추가하고 저장하세요. 못 가는 날은 위에서
                    지우면 됩니다.
                  </p>
                )}
              </>
            )}

            <ScheduleFields
              scheduleType={scheduleType}
              rows={scheduleRows}
              onChange={setScheduleRows}
              programCapacity={capacity}
              compact={isEdit}
              canAdd={
                isEdit
                  ? scheduleType === "series" ||
                    (scheduleType === "single" && (loaded?.schedules.length ?? 0) === 0)
                  : undefined
              }
            />
          </div>

          {/* 문의 가능 기간은 상시모집 전용입니다 — 다른 방식에서는 서버가 null로
              못박으므로, 칸을 보여주면 입력해도 사라지는 것처럼 보입니다(2-3). */}
          {scheduleType === "open" && (
            <div className="mt-1 flex gap-3">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="availableFrom" className="text-[14px]">
                  문의 가능 시작일
                </Label>
                <Input
                  id="availableFrom"
                  name="availableFrom"
                  type="date"
                  defaultValue={loaded?.availableFrom ?? ""}
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="availableUntil" className="text-[14px]">
                  문의 가능 종료일
                </Label>
                <Input
                  id="availableUntil"
                  name="availableUntil"
                  type="date"
                  defaultValue={loaded?.availableUntil ?? ""}
                />
              </div>
            </div>
          )}
        </FormCard>

        {/* ── 프로그램 소개 ─────────────────────────────────────────────── */}
        <FormCard
          title="프로그램 소개"
          icon={BookOpen}
          desc="사진과 글만 넣으시면 배치는 자동으로 됩니다 — 상세 페이지에서 좌우로 번갈아 놓입니다. 순서는 왼쪽 손잡이를 끌거나 화살표 버튼으로 바꿉니다."
        >
          {/* 사진은 「프로그램 사진」과 같은 목록에서 고릅니다(v29) — 블록마다 따로
              올리면 같은 사진이 앨범과 소개 글에 두 번 저장됩니다. 여기서 새로
              추가해도 그 목록(=앨범)에 함께 들어갑니다. */}
          <IntroBlockEditor
            photos={photoPool}
            onAddPhoto={addPhotos}
            atLimit={atPhotoLimit}
            busy={photoBusy}
            progress={photoProgress}
            blocks={introBlocks}
            onChange={setIntroBlocks}
          />
        </FormCard>

        {/* ── 상세 구성 항목 ────────────────────────────────────────────── */}
        <FormCard
          title="상세 구성 항목"
          icon={ListChecks}
          desc="목록에서 고르고, 없으면 직접 입력합니다(구분마다 3개까지). 같은 항목을 포함과 불포함에 함께 고를 수 없습니다."
        >
          <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Label className="text-[15px] font-bold">포함 사항</Label>
            <KeywordPicker
              tone="include"
              options={INCLUDE_OPTIONS}
              value={includes}
              onChange={setIncludes}
              conflictKeys={excludes.keys}
              conflictCustom={excludes.custom}
              conflictLabel="불포함 사항"
            />
          </div>

          <div className="flex flex-col gap-2 border-t pt-3.5">
            <Label className="text-[15px] font-bold">불포함 사항</Label>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              현장에서 따로 내야 하는 비용을 빠뜨리지 마세요 — 미리 알리지 않으면 분쟁이
              됩니다.
            </p>
            <KeywordPicker
              tone="exclude"
              options={EXCLUDE_OPTIONS}
              value={excludes}
              onChange={setExcludes}
              conflictKeys={includes.keys}
              conflictCustom={includes.custom}
              conflictLabel="포함 사항"
            />
          </div>

          <div className="flex flex-col gap-2 border-t pt-3.5">
            <Label className="text-[15px] font-bold">준비물</Label>
            <KeywordPicker
              tone="prepare"
              options={PREPARATION_OPTIONS}
              value={preparations}
              onChange={setPreparations}
            />
          </div>
          </div>
        </FormCard>

        {/* ── 참가 조건 ─────────────────────────────────────────────────── */}
        <FormCard
          title="참가 조건"
          icon={Users}
          desc="난이도는 걷는 거리로 자동 계산되므로 따로 고르지 않습니다."
        >
          <div className="flex flex-col gap-5">
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="targetAgeMin" className="text-[14px]">
                  참가 가능 연령(최소)
                </Label>
                <Input
                  id="targetAgeMin"
                  name="targetAgeMin"
                  type="number"
                  min={0}
                  placeholder="비우면 제한 없음"
                  defaultValue={loaded?.targetAgeMin ?? ""}
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="targetAgeMax" className="text-[14px]">
                  참가 가능 연령(최대)
                </Label>
                <Input
                  id="targetAgeMax"
                  name="targetAgeMax"
                  type="number"
                  min={0}
                  placeholder="비우면 제한 없음"
                  defaultValue={loaded?.targetAgeMax ?? ""}
                />
              </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="walkingDistanceM" className="text-[14px]">
              총 걷는 거리(m)
            </Label>
            <Input
              id="walkingDistanceM"
              name="walkingDistanceM"
              type="number"
              min={0}
              placeholder="예: 2000"
              defaultValue={loaded?.walkingDistanceM ?? ""}
            />
            <p className="text-[13px] text-muted-foreground">
              난이도는 이 값으로 자동 표시됩니다 — 1km 이하 쉬움 / 1~3km 보통 / 3km 이상 어려움.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rainAlternative" className="text-[14px]">
              우천 시 대체 방식
            </Label>
            <Select
              id="rainAlternative"
              name="rainAlternative"
              required
              defaultValue={loaded?.rainAlternative ?? "none"}
            >
              {RAIN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          </div>
        </FormCard>

        {/* ── 배리어프리 ────────────────────────────────────────────────── */}
        <label className="flex cursor-pointer items-center gap-3 rounded-2xl border bg-card p-5 sm:px-7">
          <input
            type="checkbox"
            name="barrierFree"
            defaultChecked={loaded?.barrierFree ?? false}
            className="h-[18px] w-[18px] accent-primary"
          />
          <Accessibility className="h-[18px] w-[18px] text-primary" strokeWidth={1.75} aria-hidden />
          <span className="text-[15px] font-bold">배리어프리(무장애) 코스입니다</span>
        </label>

        {/* ── 하단 고정 저장 바 ─────────────────────────────────────────────
            폼이 길어서 저장하려면 매번 끝까지 내려가야 했습니다. 어디서 쓰다가도
            바로 저장할 수 있게 화면 아래에 고정합니다. */}
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur">
          <div className="container mx-auto flex max-w-[800px] items-center justify-between gap-3 px-5 py-3.5">
            <p className="hidden text-[13px] text-muted-foreground sm:block">
              {isEdit ? "고친 내용은 저장해야 반영됩니다" : "저장하면 작성 중 상태가 됩니다"}
            </p>
            <div className="flex flex-1 gap-2 sm:flex-none">
              {isEdit && (
                <Button type="button" size="lg" variant="outline" asChild>
                  <Link to="/my/programs">내 프로그램으로</Link>
                </Button>
              )}
              <Button type="submit" size="lg" className="flex-1 sm:flex-none" disabled={busy}>
                {busy ? "저장 중…" : isEdit ? "수정 내용 저장" : "작성 중으로 저장"}
              </Button>
            </div>
          </div>
        </div>
      </form>
      </div>
    </div>
  );
}
