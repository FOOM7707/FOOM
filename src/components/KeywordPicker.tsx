/**
 * 포함·불포함·준비물 키워드 선택 (스키마 20-4).
 *
 * **목록에서 눌러 고르고, 없는 것만 직접 입력합니다.** 자유 입력만 두면
 * 「차 제공」·「음료 제공」·「다과」가 전부 다른 값이 되어 검색 필터로 쓸 수 없습니다.
 *
 * **포함과 불포함에 같은 항목을 고르면 서버가 거부합니다**(「입장료」가 양쪽 목록에
 * 있습니다). 눌러서 거부당하기 전에 화면에서 먼저 알려줍니다 — 눌렀는데 저장할 때
 * 실패하면 무엇이 문제인지 알기 어렵습니다.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MAX_CUSTOM_ITEMS,
  type KeywordField,
  type KeywordOption,
} from "@/lib/programContent";

interface Props {
  options: KeywordOption[];
  value: KeywordField;
  onChange: (next: KeywordField) => void;
  /** 반대편 구분에서 이미 고른 항목 — 함께 고르면 모순입니다 */
  conflictKeys?: string[];
  conflictCustom?: string[];
  /** 모순일 때 보여줄 이름 (「불포함 사항」 등) */
  conflictLabel?: string;
  tone: "include" | "exclude" | "prepare";
}

const TONE_CLASS: Record<Props["tone"], { on: string; off: string }> = {
  // 강조색은 브랜드 그린입니다. 불포함만 경고색을 씁니다 — 「없는 것」이라 눈에
  // 띄어야 하고, 손님이 놓치면 현장에서 분쟁이 됩니다.
  include: {
    on: "bg-primary text-primary-foreground border-primary",
    off: "bg-background text-foreground border-input hover:border-primary/50",
  },
  exclude: {
    on: "bg-destructive/10 text-destructive border-destructive/40",
    off: "bg-background text-foreground border-input hover:border-destructive/40",
  },
  prepare: {
    on: "bg-secondary text-secondary-foreground border-secondary-foreground/30",
    off: "bg-background text-foreground border-input hover:border-secondary-foreground/40",
  },
};

export default function KeywordPicker({
  options,
  value,
  onChange,
  conflictKeys = [],
  conflictCustom = [],
  conflictLabel,
  tone,
}: Props) {
  const [draft, setDraft] = useState("");
  const cls = TONE_CLASS[tone];

  function toggle(key: string) {
    const on = value.keys.includes(key);
    onChange({
      ...value,
      keys: on ? value.keys.filter((k) => k !== key) : [...value.keys, key],
    });
  }

  function addCustom() {
    const text = draft.trim();
    if (text === "") return;
    if (value.custom.length >= MAX_CUSTOM_ITEMS) return;
    if (value.custom.includes(text)) {
      setDraft("");
      return;
    }
    onChange({ ...value, custom: [...value.custom, text] });
    setDraft("");
  }

  function removeCustom(text: string) {
    onChange({ ...value, custom: value.custom.filter((c) => c !== text) });
  }

  const conflicting = [
    ...value.keys.filter((k) => conflictKeys.includes(k)).map((k) => keyLabel(k)),
    ...value.custom.filter((c) => conflictCustom.includes(c)),
  ];

  function keyLabel(key: string): string {
    return options.find((o) => o.key === key)?.label ?? key;
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.keys.includes(o.key);
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => toggle(o.key)}
              className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${on ? cls.on : cls.off}`}
            >
              <span className="mr-1">{o.emoji}</span>
              {o.label}
            </button>
          );
        })}
      </div>

      {value.custom.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.custom.map((c) => (
            <span
              key={c}
              className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${cls.on}`}
            >
              {c}
              <button
                type="button"
                onClick={() => removeCustom(c)}
                className="opacity-70 hover:opacity-100"
                title="지우기"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {value.custom.length < MAX_CUSTOM_ITEMS && (
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // 폼 안에 있으므로 Enter가 저장으로 새지 않게 막습니다.
                e.preventDefault();
                addCustom();
              }
            }}
            maxLength={20}
            placeholder="목록에 없으면 직접 입력 (20자 이내)"
            className="h-9 flex-1 text-[13px]"
          />
          <Button type="button" variant="outline" size="sm" onClick={addCustom}>
            추가
          </Button>
        </div>
      )}

      {value.custom.length >= MAX_CUSTOM_ITEMS && (
        <p className="text-xs text-muted-foreground">
          직접 입력은 {MAX_CUSTOM_ITEMS}개까지입니다. 직접 입력한 항목은 심사 대상입니다.
        </p>
      )}

      {conflicting.length > 0 && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[12.5px] leading-relaxed text-destructive">
          <strong className="font-semibold">{conflicting.join(" · ")}</strong>이(가){" "}
          {conflictLabel}에도 들어 있습니다. 한쪽에서 빼 주세요 — 양쪽에 같이 있으면 손님이
          어느 쪽을 믿어야 할지 알 수 없습니다.
        </p>
      )}
    </div>
  );
}
