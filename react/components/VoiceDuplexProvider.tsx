'use client';

import React from 'react';
import { ConversationProvider } from '@elevenlabs/react';

export function VoiceDuplexProvider({ children }: { children: React.ReactNode }) {
    return <ConversationProvider>{children}</ConversationProvider>;
}
