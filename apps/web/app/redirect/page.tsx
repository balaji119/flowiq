'use client';

import { useEffect, useState } from 'react';
import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';

export default function MicrosoftAuthenticationRedirectPage() {
  const [error, setError] = useState('');

  useEffect(() => {
    void broadcastResponseToMainFrame().catch((bridgeError: unknown) => {
      setError(bridgeError instanceof Error ? bridgeError.message : 'Unable to complete Microsoft sign-in.');
    });
  }, []);

  return (
    <main style={{ alignItems: 'center', display: 'flex', fontFamily: 'sans-serif', justifyContent: 'center', minHeight: '100vh' }}>
      <p>{error || 'Completing Microsoft sign-in…'}</p>
    </main>
  );
}
