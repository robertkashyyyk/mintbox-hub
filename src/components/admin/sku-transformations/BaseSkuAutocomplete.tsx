import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { searchBaseSkus } from "@/hooks/useSkuTransformations";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function BaseSkuAutocomplete({ value, onChange, placeholder, disabled }: Props) {
  const [term, setTerm] = useState(value);
  const [options, setOptions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => setTerm(value), [value]);

  useEffect(() => {
    let cancelled = false;
    if (!term || term === value) {
      setOptions([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await searchBaseSkus(term);
      if (!cancelled) setOptions(res);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term, value]);

  return (
    <div className="relative">
      <Input
        value={term}
        disabled={disabled}
        placeholder={placeholder ?? "Search BASE SKU…"}
        onChange={(e) => {
          setTerm(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && options.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(opt);
                setTerm(opt);
                setOpen(false);
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
