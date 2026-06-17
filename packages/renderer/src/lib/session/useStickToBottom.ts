import { useEffect, useRef } from "react";

/**
 * Keep a scroll container pinned to the bottom as content grows (streaming
 * thinking / responses), unless the user has scrolled up to read — in which
 * case we leave their position alone until they scroll back near the bottom.
 *
 * `signal` should change whenever the rendered content changes (e.g. a string
 * derived from message/step counts + the last step's length).
 */
export function useStickToBottom(signal: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [signal]);

  return { scrollRef, onScroll };
}
