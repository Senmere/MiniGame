import { createElement, Fragment, memo, ReactNode } from 'react';
import type { ElementType } from 'react';

/**
 * 轻量 Markdown 渲染器（零依赖）。
 * 支持：代码块 ```、行内代码 `code`、标题 #~######、列表 - / 1. / [x]、
 *       引用 >、粗体 **、斜体 *、链接 [text](url)、分隔 ---、表格 |...|。
 * 刻意不引入 npm 包，避免 npm install 不确定性。
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type Block =
  | { kind: 'h'; level: number; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: { text: string; checked?: boolean | null }[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'code'; lang?: string; text: string }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'hr' }
  | { kind: 'table'; head: string[]; rows: string[][] };

function renderInline(src: string): ReactNode {
  let s = escapeHtml(src);
  // 行内代码 `...`
  s = s.replace(/`([^`]+)`/g, '<code class="inline">$1</code>');
  // 粗体 **x** 或 __x__
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  // 斜体 *x* 或 _x_（尽量保守：非紧跟单词字符）
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
  // 链接 [text](url)
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>',
  );
  // 裸链接自动识别
  s = s.replace(
    /(^|[\s(])(https?:\/\/[^\s<>"']+)/g,
    '$1<a href="$2" target="_blank" rel="noreferrer noopener">$2</a>',
  );
  // 换行 <br>
  s = s.replace(/\n/g, '<br/>');
  return <span dangerouslySetInnerHTML={{ __html: s }} />;
}

function splitBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || undefined;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ kind: 'code', lang, text: buf.join('\n') });
      continue;
    }

    if (/^\s*$/.test(line)) { i++; continue; }
    if (/^\s*---+\s*$/.test(line)) { blocks.push({ kind: 'hr' }); i++; continue; }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      blocks.push({ kind: 'h', level: h[1].length, text: h[2] });
      i++;
      continue;
    }

    // 引用 >
    if (/^\s*>\s?/.test(line)) {
      const ls: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        ls.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push({ kind: 'quote', lines: ls });
      continue;
    }

    // 表格 | a | b |
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-+/.test(lines[i + 1])) {
      const head = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(lines[i].replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim()));
        i++;
      }
      blocks.push({ kind: 'table', head, rows });
      continue;
    }

    // 无序 / 任务列表
    if (/^\s*([-*+])\s+(\[[ xX]\])?\s*(.*)$/.test(line)) {
      const items: { text: string; checked?: boolean | null }[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*+])\s+(\[[ xX]\])?\s*(.*)$/);
        if (!m) break;
        const mark = m[2];
        items.push({
          text: m[3],
          checked: mark ? mark.toLowerCase() === '[x]' : null,
        });
        i++;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }

    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }

    // 普通段落（连续非空行合并）
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) &&
      !/^\s*\|.*\|\s*$/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ kind: 'p', text: para.join(' ') });
  }
  return blocks;
}

function BlockView({ block }: { block: Block }): ReactNode {
  switch (block.kind) {
    case 'h': {
      const Tag = (`h${Math.min(block.level, 6)}`) as ElementType;
      return createElement(Tag, { className: `md-h md-h${block.level}` }, renderInline(block.text));
    }
    case 'p':
      return <p className="md-p">{renderInline(block.text)}</p>;
    case 'hr':
      return <hr className="md-hr" />;
    case 'code':
      return (
        <pre className="md-pre">
          {block.lang && <div className="md-lang">{block.lang}</div>}
          <code>{escapeHtml(block.text)}</code>
        </pre>
      );
    case 'quote':
      return (
        <blockquote className="md-quote">
          {block.lines.map((l, idx) => (
            <div key={idx}>{renderInline(l)}</div>
          ))}
        </blockquote>
      );
    case 'ul':
      return (
        <ul className="md-ul">
          {block.items.map((it, idx) => (
            <li key={idx} className={it.checked !== null ? 'md-task' : ''}>
              {it.checked !== null && (
                <input type="checkbox" disabled={true} checked={!!it.checked} />
              )}
              <span>{renderInline(it.text)}</span>
            </li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol className="md-ol">
          {block.items.map((t, idx) => (
            <li key={idx}>{renderInline(t)}</li>
          ))}
        </ol>
      );
    case 'table':
      return (
        <table className="md-table">
          <thead>
            <tr>
              {block.head.map((h, i) => (
                <th key={i}>{renderInline(h)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td key={ci}>{renderInline(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}

function MarkdownInner({ text }: { text: string }): ReactNode {
  const blocks = splitBlocks(text || '');
  return (
    <div className="md">
      {blocks.map((b, i) => (
        <Fragment key={i}>
          <BlockView block={b} />
        </Fragment>
      ))}
    </div>
  );
}

export const Markdown = memo(MarkdownInner);
