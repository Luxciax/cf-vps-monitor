import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog } from "@radix-ui/themes";
import { ArrowUpRight, BookOpen, Boxes, Search } from "lucide-react";
import { adminMenuItems } from "../pages/admin/adminMenu";
import type { Asset, DocumentRecord } from "./types";
import { useResource } from "./ui";

type SearchResult = {
  assets: Asset[];
  documents: DocumentRecord[];
  truncated: boolean;
};

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const resource = useResource<SearchResult>(
    open && debounced.trim().length >= 2
      ? `/admin/search?q=${encodeURIComponent(debounced)}&limit=8`
      : null,
  );
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebounced("");
      setActive(0);
    }
  }, [open]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(query);
      setActive(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  const navigation = adminMenuItems
    .filter(
      (item) =>
        !item.external &&
        (!query || item.label.toLowerCase().includes(query.toLowerCase())),
    )
    .map((item) => ({
      id: item.path,
      title: item.label,
      subtitle: "页面",
      path: item.path,
      icon: <ArrowUpRight size={16} />,
    }));
  const resultRows = resource.data
    ? [
        ...resource.data.assets.map((asset) => ({
          id: asset.id,
          title: asset.name,
          subtitle: asset.kind,
          path: `/admin/assets/${asset.id}`,
          icon: <Boxes size={16} />,
        })),
        ...resource.data.documents.map((document) => ({
          id: document.id,
          title: document.title,
          subtitle: "运维文档",
          path: `/admin/knowledge?document=${document.id}`,
          icon: <BookOpen size={16} />,
        })),
      ]
    : [];
  const rows = [...resultRows, ...navigation];
  const selected = Math.min(active, Math.max(0, rows.length - 1));
  const visit = (path: string) => {
    setOpen(false);
    navigate(path);
  };
  return (
    <>
      <button
        className="infra-command-trigger"
        onClick={() => setOpen(true)}
        aria-label="全局搜索，Ctrl K"
      >
        <Search size={16} />
        <span>搜索资产与文档</span>
        <kbd>Ctrl K</kbd>
      </button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Content
          className="infra-command"
          maxWidth="650px"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
        >
          <Dialog.Title className="sr-only">全局搜索与命令面板</Dialog.Title>
          <Dialog.Description className="sr-only">
            输入至少两个字符搜索资产、文档，或使用上下方向键选择页面。
          </Dialog.Description>
          <div
            className="infra-inline"
            style={{ borderBottom: "1px solid var(--gray-5)" }}
          >
            <Search size={19} />
            <input
              ref={input}
              role="combobox"
              aria-expanded={true}
              aria-controls="infra-command-results"
              aria-activedescendant={
                rows[selected] ? `command-${selected}` : undefined
              }
              className="infra-command-input"
              style={{ flex: 1 }}
              placeholder="搜索资产、文档，或跳转页面…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActive((value) => Math.min(value + 1, rows.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((value) => Math.max(0, value - 1));
                } else if (event.key === "Enter" && rows[selected]) {
                  event.preventDefault();
                  visit(rows[selected].path);
                }
              }}
            />
            <kbd>Esc</kbd>
          </div>
          <div
            id="infra-command-results"
            className="infra-command-results"
            role="listbox"
            aria-label="搜索结果"
          >
            {rows.map((row, index) => (
              <button
                id={`command-${index}`}
                key={row.id}
                role="option"
                aria-selected={selected === index}
                onMouseEnter={() => setActive(index)}
                onClick={() => visit(row.path)}
              >
                {row.icon}
                <span>{row.title}</span>
                <small>{row.subtitle}</small>
              </button>
            ))}
          </div>
          {resource.loading && (
            <p role="status" className="infra-muted">
              正在搜索…
            </p>
          )}
          {resource.error && (
            <p role="alert" className="infra-muted">
              搜索暂不可用：{resource.error}
            </p>
          )}
          {!rows.length && !resource.loading && (
            <p className="infra-muted" style={{ padding: "20px 10px" }}>
              没有匹配结果
            </p>
          )}
          <div className="infra-command-footer">
            <span>↑ ↓ 选择 · Enter 打开</span>
            <span>
              {resource.data?.truncated
                ? "结果已限定，继续输入缩小范围"
                : "仅搜索当前账户可访问的内容"}
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
