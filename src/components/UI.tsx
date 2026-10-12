import { useEffect, useRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { X, Inbox } from 'lucide-react';

export function Button({ children, variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  return <button type="button" className={`btn btn-${variant} ${className}`} {...props}>{children}</button>;
}
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const node = ref.current;
    const focusable = () => [...(node?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') ?? [])];
    const firstInput = node?.querySelector<HTMLElement>('input,select,textarea');
    (firstInput ?? focusable()[0])?.focus();
    function handle(event: KeyboardEvent) {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab') {
        const elements = focusable(); const first = elements[0]; const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener('keydown', handle);
    return () => { document.removeEventListener('keydown', handle); document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, []);
  return <div className="modal-backdrop"><div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide ? 'modal-wide' : ''}`}><div className="modal-header"><h2>{title}</h2><button className="icon-btn" aria-label="关闭弹窗" onClick={onClose}><X size={19} /></button></div><div className="modal-body">{children}</div></div></div>;
}
export function Field({ label, children, required, hint }: { label: string; children: ReactNode; required?: boolean; hint?: string }) {
  return <label className="field"><span className="field-label">{label}{required && <span className="required"> *</span>}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) { return <span className={`badge badge-${tone}`}>{children}</span>; }
export function Empty({ title, description }: { title: string; description?: string }) { return <div className="empty"><Inbox size={29} strokeWidth={1.4} /><strong>{title}</strong>{description && <p>{description}</p>}</div>; }
