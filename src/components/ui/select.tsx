import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// 참고: 공식 shadcn/ui의 Select는 @radix-ui/react-select 기반이지만,
// 이 스캐폴드 단계에서는 폼 접근성/단순성을 위해 네이티브 <select>를
// 동일한 톤으로 스타일링한 경량 버전을 사용합니다. 필요해지면
// `npx shadcn@latest add select`로 Radix 버전으로 교체할 수 있습니다.
function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="select"
        className={cn(
          "flex h-10 w-full appearance-none rounded-md border border-input bg-card px-3 py-2 pr-9 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export { Select };
