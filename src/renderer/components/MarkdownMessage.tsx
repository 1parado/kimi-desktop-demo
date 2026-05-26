import { isValidElement, useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import mermaid from 'mermaid';

interface MarkdownMessageProps {
  content: string;
  isStreaming?: boolean;
}

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'base',
  themeVariables: {
    primaryColor: '#edf8e6',
    primaryTextColor: '#222824',
    primaryBorderColor: '#75c943',
    lineColor: '#5d665f',
    secondaryColor: '#fff8eb',
    tertiaryColor: '#f7f8f5',
    fontFamily: 'Aptos, Microsoft YaHei UI, Segoe UI, sans-serif',
  },
});

export function MarkdownMessage({ content, isStreaming = false }: MarkdownMessageProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        a({ children, href, ...props }) {
          return (
            <a href={href} target="_blank" rel="noreferrer" {...props}>
              {children}
            </a>
          );
        },
        img({ alt, src, ...props }) {
          return <img alt={alt ?? ''} src={src} loading="lazy" {...props} />;
        },
        pre({ children, ...props }) {
          const child = Array.isArray(children) ? children[0] : children;
          if (isValidElement(child)) {
            const childProps = child.props as { className?: string; children?: ReactNode };
            const language = /language-(\w+)/.exec(childProps.className ?? '')?.[1]?.toLowerCase();

            if (language === 'mermaid') {
              const source = childrenToText(childProps.children);
              if (isStreaming) {
                return (
                  <pre {...props}>
                    <code className={childProps.className}>{source}</code>
                  </pre>
                );
              }

              return <MermaidDiagram source={source} />;
            }
          }

          return <pre {...props}>{children}</pre>;
        },
        code({ children, className, ...props }) {
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function childrenToText(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children).replace(/\n$/, '');
  }

  if (Array.isArray(children)) {
    return children.map(childrenToText).join('').replace(/\n$/, '');
  }

  return '';
}

function MermaidDiagram({ source }: { source: string }) {
  const reactId = useId();
  const diagramId = useMemo(() => `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [reactId]);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      if (!source.trim()) {
        setSvg('');
        setError(null);
        return;
      }

      try {
        const result = await mermaid.render(diagramId, source);
        if (!cancelled) {
          setSvg(result.svg);
          setError(null);
        }
      } catch (renderError) {
        if (!cancelled) {
          setSvg('');
          setError(renderError instanceof Error ? renderError.message : 'Mermaid diagram render failed.');
        }
      }
    }

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [diagramId, source]);

  if (error) {
    return (
      <pre className="mermaid-error">
        <code>{source}</code>
      </pre>
    );
  }

  return (
    <div
      className="mermaid-diagram"
      aria-label="Mermaid diagram"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
