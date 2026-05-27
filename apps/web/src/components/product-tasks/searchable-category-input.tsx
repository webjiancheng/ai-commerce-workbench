"use client";

import { apiBaseUrl } from "@/lib/api";
import { useEffect, useMemo, useState } from "react";
import Select, { type InputActionMeta, type SingleValue, type StylesConfig } from "react-select";

export type CategorySearchItem = {
  path: string;
  leaf: string;
};

export type CategorySearchResponse = {
  items: CategorySearchItem[];
  total: number;
  query: string;
};

type CategorySelectOption = {
  value: string;
  label: string;
  path: string;
  leaf: string;
  preferred: boolean;
};

function categoryLeaf(path: string): string {
  const parts = String(path || "")
    .split(">")
    .map((item) => item.trim())
    .filter(Boolean);
  return parts[parts.length - 1] || String(path || "").trim();
}

function mergeCategoryOptions(
  preferredPaths: string[],
  allOptions: CategorySearchItem[],
  query: string,
  limit = 24,
): CategorySearchItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  const merged = new Map<string, CategorySearchItem>();

  if (normalizedQuery) {
    const matched: CategorySearchItem[] = [];
    for (const option of allOptions) {
      const path = String(option.path || "").trim();
      if (!path || merged.has(path)) continue;
      const pathLc = path.toLowerCase();
      const leafLc = (option.leaf || categoryLeaf(path)).toLowerCase();
      if (pathLc.includes(normalizedQuery) || leafLc.includes(normalizedQuery)) {
        matched.push({ path, leaf: option.leaf || categoryLeaf(path) });
        merged.set(path, matched[matched.length - 1]);
      }
      if (merged.size >= limit) break;
    }
    if (merged.size < limit && normalizedQuery.length > 1) {
      for (const option of allOptions) {
        const path = String(option.path || "").trim();
        if (!path || merged.has(path)) continue;
        const pathLc = path.toLowerCase();
        const leafLc = (option.leaf || categoryLeaf(path)).toLowerCase();
        const tokens = normalizedQuery.split(/[\s,，]+/).filter(Boolean);
        const hasMatch = tokens.some((token) => pathLc.includes(token) || leafLc.includes(token));
        if (hasMatch) {
          matched.push({ path, leaf: option.leaf || categoryLeaf(path) });
          merged.set(path, matched[matched.length - 1]);
        }
        if (merged.size >= limit) break;
      }
    }
    return Array.from(merged.values());
  }

  const preferredSet = new Set(preferredPaths.map((item) => String(item || "").trim()).filter(Boolean));

  for (const path of preferredPaths) {
    const text = String(path || "").trim();
    if (!text || merged.has(text)) continue;
    merged.set(text, { path: text, leaf: categoryLeaf(text) });
  }

  if (merged.size < limit) {
    for (const option of allOptions) {
      const path = String(option.path || "").trim();
      if (!path || merged.has(path) || !preferredSet.has(path)) continue;
      merged.set(path, { path, leaf: option.leaf || categoryLeaf(path) });
      if (merged.size >= limit) break;
    }
  }

  if (merged.size < limit) {
    for (const option of allOptions) {
      const path = String(option.path || "").trim();
      if (!path || merged.has(path)) continue;
      merged.set(path, { path, leaf: option.leaf || categoryLeaf(path) });
      if (merged.size >= limit) break;
    }
  }

  return Array.from(merged.values());
}

function toCategorySelectOptions(items: CategorySearchItem[], preferredPaths: string[]): CategorySelectOption[] {
  const preferredSet = new Set(preferredPaths.map((item) => String(item || "").trim()).filter(Boolean));
  return items.map((item) => ({
    value: item.path,
    label: item.leaf || categoryLeaf(item.path),
    path: item.path,
    leaf: item.leaf || categoryLeaf(item.path),
    preferred: preferredSet.has(item.path),
  }));
}

export function SearchableCategoryInput({
  value,
  onChange,
  onSelect,
  allOptions,
  preferredPaths,
  placeholder,
  className,
  minHeight = 44,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (path: string) => void;
  allOptions: CategorySearchItem[];
  preferredPaths: string[];
  placeholder: string;
  className?: string;
  minHeight?: number;
}) {
  const [inputValue, setInputValue] = useState("");
  const [serverSuggestions, setServerSuggestions] = useState<CategorySearchItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const query = inputValue.trim();
    if (!query) {
      setServerSuggestions([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(
          `${apiBaseUrl}/api/categories/search?q=${encodeURIComponent(query)}&limit=100`,
          { cache: "no-store" },
        );
        if (response.ok) {
          const result = (await response.json()) as CategorySearchResponse;
          setServerSuggestions(result.items || []);
        }
      } catch {
        // ignore search errors
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [inputValue]);

  const suggestions = useMemo(() => {
    const query = inputValue.trim();
    let baseItems: CategorySearchItem[] = [];

    if (serverSuggestions.length > 0) {
      baseItems = serverSuggestions;
    } else if (query) {
      baseItems = mergeCategoryOptions(preferredPaths, allOptions, query, 80);
    }

    const pathMap = new Map<string, string>();
    for (const item of baseItems) {
      pathMap.set(item.path, item.leaf || categoryLeaf(item.path));
    }

    if (value && !pathMap.has(value)) {
      pathMap.set(value, categoryLeaf(value));
    }

    for (const preferredPath of preferredPaths) {
      if (!pathMap.has(preferredPath)) {
        pathMap.set(preferredPath, categoryLeaf(preferredPath));
      }
    }

    const result: CategorySearchItem[] = [];
    for (const [path, leaf] of pathMap) {
      if (result.length >= 80) break;
      result.push({ path, leaf });
    }
    return result;
  }, [allOptions, preferredPaths, inputValue, serverSuggestions, value]);

  const options = useMemo(
    () => toCategorySelectOptions(suggestions, preferredPaths),
    [preferredPaths, suggestions],
  );

  const selectedOption = useMemo(() => {
    const text = String(value || "").trim();
    if (!text) return null;
    const found = options.find((option) => option.value === text);
    if (found) return found;
    const allItems = [...serverSuggestions, ...allOptions];
    const match = allItems.find((item) => item.path === text);
    if (match) {
      return {
        value: match.path,
        label: match.leaf || categoryLeaf(match.path),
        path: match.path,
        leaf: match.leaf || categoryLeaf(match.path),
        preferred: preferredPaths.includes(match.path),
      };
    }
    return null;
  }, [options, value, allOptions, serverSuggestions, preferredPaths]);

  const styles: StylesConfig<CategorySelectOption, false> = {
    control: (base, state) => ({
      ...base,
      minHeight,
      borderRadius: 14,
      borderColor: state.isFocused ? "#94a3b8" : "#e2e8f0",
      backgroundColor: "#fff",
      boxShadow: "none",
      paddingLeft: 4,
      paddingRight: 4,
      "&:hover": { borderColor: "#94a3b8" },
    }),
    valueContainer: (base) => ({
      ...base,
      padding: "0 8px",
    }),
    placeholder: (base) => ({
      ...base,
      color: "#94a3b8",
      fontSize: 14,
    }),
    singleValue: (base) => ({
      ...base,
      color: "#0f172a",
      fontSize: 14,
    }),
    input: (base) => ({
      ...base,
      color: "#0f172a",
      fontSize: 14,
    }),
    menu: (base) => ({
      ...base,
      borderRadius: 18,
      border: "1px solid #e2e8f0",
      boxShadow: "0 18px 50px rgba(15,23,42,0.12)",
      overflow: "hidden",
      zIndex: 30,
    }),
    menuList: (base) => ({
      ...base,
      padding: 8,
      maxHeight: 320,
    }),
    option: (base, state) => ({
      ...base,
      borderRadius: 12,
      backgroundColor: state.isSelected ? "#dbeafe" : state.isFocused ? "#f8fafc" : "#fff",
      color: "#0f172a",
      padding: 0,
      cursor: "pointer",
      overflow: "hidden",
    }),
    noOptionsMessage: (base) => ({
      ...base,
      color: "#64748b",
      fontSize: 12,
      padding: "8px 10px",
    }),
    indicatorSeparator: () => ({ display: "none" }),
    dropdownIndicator: (base) => ({
      ...base,
      color: "#64748b",
      padding: 6,
    }),
    clearIndicator: (base) => ({
      ...base,
      color: "#64748b",
      padding: 6,
    }),
  };

  return (
    <div className={`relative ${className || ""}`}>
      {isSearching && inputValue.trim() ? (
        <div className="absolute right-10 top-1/2 -translate-y-1/2 text-xs text-slate-400">搜索中...</div>
      ) : null}
      <Select<CategorySelectOption, false>
        unstyled={false}
        options={options}
        value={selectedOption}
        inputValue={inputValue}
        onInputChange={(nextValue: string, meta: InputActionMeta) => {
          if (meta.action === "input-change") {
            setInputValue(nextValue);
            onChange(nextValue);
          }
          if (meta.action === "menu-close") {
            setInputValue("");
          }
          return nextValue;
        }}
        onChange={(option: SingleValue<CategorySelectOption>) => {
          const nextPath = option?.path || "";
          if (nextPath && !serverSuggestions.some((s) => s.path === nextPath)) {
            setServerSuggestions((prev) => [
              { path: nextPath, leaf: categoryLeaf(nextPath) },
              ...prev.slice(0, 99),
            ]);
          }
          onChange(nextPath);
          onSelect(nextPath);
          setTimeout(() => setInputValue(""), 0);
        }}
        isClearable
        filterOption={null}
        styles={styles}
        formatOptionLabel={(option) => (
          <div className="px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-800">{option.leaf}</span>
              {option.preferred ? (
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700">优先</span>
              ) : null}
            </div>
            <div className="mt-1 line-clamp-2 text-[11px] text-slate-500">{option.path}</div>
          </div>
        )}
        noOptionsMessage={() => "没有匹配类目，继续输入搜索"}
        placeholder={placeholder}
      />
    </div>
  );
}
