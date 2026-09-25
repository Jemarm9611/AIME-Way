import React from 'react';

// This checkout does not include the files required by App.jsx. Keep the
// preview informative instead of leaving an empty page or inventing an auth/API.
export default function IncompleteRepository() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f8fafc', color: '#0f172a', fontFamily: 'system-ui, sans-serif', padding: '24px' }}>
      <section style={{ maxWidth: 640, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 32, boxShadow: '0 12px 32px #0f172a0a' }}>
        <p style={{ color: '#475569', fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>AIME-Way · development preview</p>
        <h1 style={{ fontSize: 28, margin: '12px 0' }}>The repository is incomplete</h1>
        <p style={{ lineHeight: 1.6 }}>The development server is running, but this checkout cannot load the application yet. Its existing <code>src/App.jsx</code> imports files that are not included in the repository.</p>
        <p style={{ lineHeight: 1.6 }}>Please add the original source files, including the Base44 client, authentication, layout, pages, and shared utilities, along with the backend configuration. Once they are available, the preview can be connected to the real app.</p>
      </section>
    </main>
  );
}
