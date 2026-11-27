import { createElement, Fragment, type ReactNode } from "react";

export function safeDocumentLink(raw: string): string | null {
  const value = raw.trim();
  if (/^[\u0000-\u0020]/.test(raw) || /[\u0000-\u001f\u007f]/.test(value))
    return null;
  if (
    value.startsWith("#") ||
    (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\"))
  )
    return value;
  try {
    const url = new URL(value);
    return ["https:", "http:", "mailto:"].includes(url.protocol)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function inline(text: string): ReactNode[] {
  const token =
    /(`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*|\[[^\]\n]+\]\([^\s)]+\))/g;
  const output: ReactNode[] = [];
  let start = 0;
  for (const match of text.matchAll(token)) {
    const offset = match.index || 0;
    if (offset > start) output.push(text.slice(start, offset));
    const value = match[0];
    if (value.startsWith("`"))
      output.push(<code key={offset}>{value.slice(1, -1)}</code>);
    else if (value.startsWith("**"))
      output.push(<strong key={offset}>{value.slice(2, -2)}</strong>);
    else if (value.startsWith("~~"))
      output.push(<del key={offset}>{value.slice(2, -2)}</del>);
    else if (value.startsWith("*"))
      output.push(<em key={offset}>{value.slice(1, -1)}</em>);
    else {
      const link = /^\[([^\]]+)\]\((.+)\)$/.exec(value)!;
      const href = safeDocumentLink(link[2]);
      output.push(
        href ? (
          <a
            key={offset}
            href={href}
            target={href.startsWith("http") ? "_blank" : undefined}
            rel="noopener noreferrer"
          >
            {link[1]}
          </a>
        ) : (
          <Fragment key={offset}>
            {link[1]} ({link[2]})
          </Fragment>
        ),
      );
    }
    start = offset + value.length;
  }
  if (start < text.length) output.push(text.slice(start));
  return output;
}

const tableCells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

export default function Markdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const key = index;
    const fence = /^\s*(`{3,}|~{3,})([^ ]*)/.exec(line);
    if (fence) {
      const code: string[] = [];
      while (
        ++index < lines.length &&
        !lines[index].trim().startsWith(fence[1])
      )
        code.push(lines[index]);
      blocks.push(
        <pre key={key} tabIndex={0} aria-label={fence[2] || "代码"}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(
        createElement(`h${heading[1].length}`, { key }, inline(heading[2])),
      );
      continue;
    }
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      blocks.push(<hr key={key} />);
      continue;
    }
    if (
      line.includes("|") &&
      lines[index + 1] &&
      /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])
    ) {
      const headers = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (
        index < lines.length &&
        lines[index].trim() &&
        lines[index].includes("|")
      )
        rows.push(tableCells(lines[index++]));
      index -= 1;
      blocks.push(
        <div className="infra-table-wrap" key={key}>
          <table>
            <thead>
              <tr>
                {headers.map((cell, i) => (
                  <th key={i}>{inline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {headers.map((_, j) => (
                    <td key={j}>{inline(row[j] || "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index]))
        quote.push(lines[index++].replace(/^\s*>\s?/, ""));
      index -= 1;
      blocks.push(
        <blockquote key={key}>
          {quote.map((text, i) => (
            <p key={i}>{inline(text)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }
    const list = /^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/.exec(line);
    if (list) {
      const items: ReactNode[] = [];
      const ordered = Boolean(list[2]);
      while (index < lines.length) {
        const item = /^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/.exec(lines[index]);
        if (!item || Boolean(item[2]) !== ordered) break;
        const task = /^\[([ xX])\]\s+(.+)$/.exec(item[3]);
        items.push(
          <li key={index}>
            {task ? (
              <>
                <input
                  type="checkbox"
                  checked={task[1] !== " "}
                  readOnly
                  aria-label={task[2]}
                />{" "}
                {inline(task[2])}
              </>
            ) : (
              inline(item[3])
            )}
          </li>,
        );
        index += 1;
      }
      index -= 1;
      blocks.push(
        ordered ? (
          <ol start={Number(list[2])} key={key}>
            {items}
          </ol>
        ) : (
          <ul key={key}>{items}</ul>
        ),
      );
      continue;
    }
    const paragraph = [line];
    while (
      index + 1 < lines.length &&
      lines[index + 1].trim() &&
      !/^\s*(#{1,6}\s|```|~~~|>|[-+*]\s|\d+\.\s|---)/.test(lines[index + 1]) &&
      !(lines[index + 2]?.includes("---") && lines[index + 1].includes("|"))
    )
      paragraph.push(lines[++index]);
    blocks.push(
      <p key={key}>
        {paragraph.map((text, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            {inline(text)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <article className="infra-markdown">{blocks}</article>;
}
