'use client';
import { useEffect, useState } from 'react';
import App from '../src/App';
export default function CRMClient() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <App /> : <div className="loading-screen"><h1>SalesMap CRM</h1><p>正在加载工作空间…</p></div>;
}
