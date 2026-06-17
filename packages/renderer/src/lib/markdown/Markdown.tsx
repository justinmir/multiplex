import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useDataMutations } from "../data/DataProvider.js";

/**
 * Render agent output as GitHub-flavored markdown, styled to match the app's
 * dark theme. Links open in the system browser (via openUrl → shell.openExternal)
 * rather than navigating the renderer. Raw HTML is not rendered (safe by default).
 */
export function Markdown({ content, className }: { content: string; className?: string }) {
  const mutations = useDataMutations();
  return (
    <div className={`text-[13.5px] leading-relaxed text-foreground ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => { e.preventDefault(); if (href) mutations.openUrl(href); }}
              className="cursor-pointer text-accent underline underline-offset-2 hover:opacity-80"
            >{children}</a>
          ),
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-0.5 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-0.5 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          h1: ({ children }) => <h1 className="mb-2 mt-3 text-[16px] font-semibold first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-3 text-[15px] font-semibold first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1.5 mt-2.5 text-[14px] font-semibold first:mt-0">{children}</h3>,
          h4: ({ children }) => <h4 className="mb-1.5 mt-2 text-[13.5px] font-semibold first:mt-0">{children}</h4>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>,
          hr: () => <hr className="my-3 border-border" />,
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-md border border-border bg-background/50 px-3 py-2 font-mono text-[12px] leading-[1.5]">{children}</pre>
          ),
          code: ({ className: cls, children, ...props }) => {
            // Fenced blocks carry a language-* class (and live inside <pre>);
            // inline code gets a subtle chip.
            const isBlock = /language-/.test(cls ?? "");
            if (isBlock) return <code className="font-mono text-[12px]" {...props}>{children}</code>;
            return <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[12px] text-foreground">{children}</code>;
          },
          table: ({ children }) => <div className="my-2 overflow-x-auto"><table className="w-full border-collapse text-[12.5px]">{children}</table></div>,
          th: ({ children }) => <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>,
          td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
        }}
      >{content}</ReactMarkdown>
    </div>
  );
}
