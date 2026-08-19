import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CATEGORIES } from "../types/firestore";
import type { ScheduleType } from "../types/firestore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import AddressSearchField from "@/components/AddressSearchField";
import { useAuth } from "@/hooks/useAuth";
import { useMe } from "@/hooks/useMe";
import { ApiError, apiFetch } from "@/lib/api";
import type { Place } from "@/lib/places";

const SCHEDULE_OPTIONS: { value: ScheduleType; label: string; hint: string }[] = [
  { value: "single", label: "1회성", hint: "특정 날짜 1회만 진행" },
  { value: "weekly", label: "매주 반복", hint: "요일·시간을 정해 매주 반복 개설" },
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

export default function ProgramRegisterPage() {
  const { user, loading } = useAuth();
  const { me, loading: meLoading } = useMe();
  const navigate = useNavigate();
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 주소는 검색해서 고른 값만 씁니다 — 좌표를 함께 받아야 날씨가 붙습니다(16-4).
  const [place, setPlace] = useState<Place | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    if (!place) {
      setError("장소를 검색해서 선택해 주세요");
      setBusy(false);
      return;
    }

    const form = new FormData(e.currentTarget);
    try {
      // 파생 필드(sido·difficulty·targetAgeTags·requiresChildInfo)는 보내지 않습니다.
      // 서버가 계산하며, 보안규칙 허용목록에도 없어 보내면 거부됩니다(2-3).
      const { id } = await apiFetch<{ id: string }>("/programs", {
        method: "POST",
        requireAuth: true,
        body: {
          title: form.get("title"),
          description: form.get("description"),
          category: form.get("category"),
          qualificationType: form.get("qualificationType"),
          // 주소·좌표는 한 쌍입니다. 좌표가 비면 그 프로그램에는 날씨가 안 붙습니다(16-4).
          location: { address: place.address, lat: place.lat, lng: place.lng },
          price: Number(form.get("price")),
          capacity: Number(form.get("capacity")),
          minCapacity: Number(form.get("minCapacity")),
          scheduleType: form.get("scheduleType"),
          availableFrom: form.get("availableFrom") || null,
          availableUntil: form.get("availableUntil") || null,
          barrierFree: form.get("barrierFree") === "on",
          targetAgeMin: optionalNumber(form.get("targetAgeMin")),
          targetAgeMax: optionalNumber(form.get("targetAgeMax")),
          walkingDistanceM: optionalNumber(form.get("walkingDistanceM")),
          rainAlternative: form.get("rainAlternative"),
        },
      });
      setCreatedId(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "등록에 실패했습니다");
    } finally {
      setBusy(false);
    }
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

  if (loading || meLoading) {
    return <div className="container mx-auto max-w-xl px-5 py-8">불러오는 중…</div>;
  }

  if (!user) {
    return (
      <div className="container mx-auto max-w-xl px-5 py-8 pb-20">
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
      <div className="container mx-auto max-w-xl px-5 py-8 pb-20">
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

  if (createdId) {
    return (
      <div className="container mx-auto max-w-xl px-5 py-8 pb-20">
        <Card className="bg-secondary">
          <CardContent className="pt-6">
            <h1 className="mb-3 text-lg font-bold text-secondary-foreground">
              작성 중(draft)으로 저장했습니다
            </h1>
            <p className="mb-4 text-sm leading-relaxed">
              아직 검색에 노출되지 않습니다. <strong>심사를 요청</strong>하면 관리자가 내용을
              확인한 뒤 게시합니다. 게시 전까지는 내용을 자유롭게 수정할 수 있습니다.
            </p>
            {error && (
              <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2.5 text-[12.5px] text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleSubmitForReview} disabled={busy}>
                심사 요청하기
              </Button>
              <Button variant="outline" asChild>
                <Link to="/my/programs">내 프로그램 보기</Link>
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setCreatedId(null);
                  setPlace(null);
                }}
              >
                하나 더 등록
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-xl px-5 py-8 pb-20">
      <h1 className="mb-2.5 text-[22px] font-bold">프로그램 등록</h1>
      <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
        저장하면 <strong>작성 중(draft)</strong> 상태가 되고, 심사를 요청해야 게시됩니다.
        {" "}
        <Link to="/my/programs" className="underline">
          내 프로그램
        </Link>
        에서 상태를 확인할 수 있습니다.
      </p>

      {error && (
        <p className="mb-4 rounded-lg bg-destructive/10 px-3 py-2.5 text-[13px] leading-relaxed text-destructive">
          {error}
        </p>
      )}

      <form className="flex flex-col gap-[18px]" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="title">프로그램명</Label>
          <Input id="title" name="title" required placeholder="예: 주말 산림치유 명상 프로그램" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="description">소개</Label>
          <Textarea
            id="description"
            name="description"
            required
            rows={4}
            placeholder="프로그램 소개를 입력하세요"
          />
        </div>

        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="category">카테고리</Label>
            <Select id="category" name="category" required defaultValue="">
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
            <Select id="qualificationType" name="qualificationType" required defaultValue="">
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

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="address">장소(주소)</Label>
          <AddressSearchField value={place} onChange={setPlace} />
        </div>

        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="price">가격(원)</Label>
            <Input id="price" name="price" type="number" min={0} required placeholder="35000" />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="minCapacity">최소 인원</Label>
            <Input id="minCapacity" name="minCapacity" type="number" min={1} required placeholder="4" />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="capacity">최대 인원</Label>
            <Input id="capacity" name="capacity" type="number" min={1} required placeholder="12" />
          </div>
        </div>

        <fieldset className="flex flex-col gap-2.5 rounded-lg border px-4 py-3.5">
          <legend className="px-1 text-[13px] text-muted-foreground">운영 방식</legend>
          {SCHEDULE_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-start gap-2.5 text-sm">
              <input type="radio" name="scheduleType" value={opt.value} required className="mt-1" />
              <span>
                <strong className="font-semibold">{opt.label}</strong>
                <span className="block text-xs text-muted-foreground">{opt.hint}</span>
              </span>
            </label>
          ))}
          <div className="mt-1 flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="availableFrom" className="text-[13px]">
                이용 가능 시작일 (상시모집만)
              </Label>
              <Input id="availableFrom" name="availableFrom" type="date" />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="availableUntil" className="text-[13px]">
                이용 가능 종료일 (상시모집만)
              </Label>
              <Input id="availableUntil" name="availableUntil" type="date" />
            </div>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-lg border px-4 py-3.5">
          <legend className="px-1 text-[13px] text-muted-foreground">참가 조건</legend>
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="targetAgeMin" className="text-[13px]">
                참가 가능 연령(최소)
              </Label>
              <Input id="targetAgeMin" name="targetAgeMin" type="number" min={0} placeholder="비우면 제한 없음" />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="targetAgeMax" className="text-[13px]">
                참가 가능 연령(최대)
              </Label>
              <Input id="targetAgeMax" name="targetAgeMax" type="number" min={0} placeholder="비우면 제한 없음" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="walkingDistanceM" className="text-[13px]">
              총 걷는 거리(m)
            </Label>
            <Input id="walkingDistanceM" name="walkingDistanceM" type="number" min={0} placeholder="예: 2000" />
            <p className="text-xs text-muted-foreground">
              난이도는 이 값으로 자동 표시됩니다 — 1km 이하 쉬움 / 1~3km 보통 / 3km 이상 어려움.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rainAlternative" className="text-[13px]">
              우천 시 대체 방식
            </Label>
            <Select id="rainAlternative" name="rainAlternative" required defaultValue="none">
              {RAIN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="barrierFree" />
          배리어프리(무장애) 코스입니다
        </label>

        <Button type="submit" size="lg" disabled={busy}>
          {busy ? "저장 중…" : "작성 중으로 저장"}
        </Button>
      </form>
    </div>
  );
}
