'use client';

import React from 'react';

/**
 * `VoiceDuplexProvider` — retained as a pass-through for back-compat (v0.4.3+).
 *
 * In v0.4.2 and earlier, this component wrapped `@elevenlabs/react`'s
 * `ConversationProvider` to satisfy the React context the sub-hook
 * `useElevenLabsConversation` required. v0.4.3 dropped the sub-hook in
 * favor of the imperative `@elevenlabs/client` API + `ConversationSession`
 * adapter, which doesn't need a React context.
 *
 * The component is now functionally a no-op (renders children as-is) but
 * remains exported so consumers don't have to remove it from their tree.
 * It is **no longer required** at any ancestor of `useConversation` /
 * `useVoiceDuplex` — safe to delete from your `app/layout.tsx` if you want.
 *
 * @deprecated since v0.4.3 — no longer functionally required. Retained
 *   for back-compat; will be removed in v1.0.0.
 */
export function VoiceDuplexProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
