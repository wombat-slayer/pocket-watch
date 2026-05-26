import { useEffect, useRef } from 'react';

export default function Modal({ title, onClose, children, large }) {
  const modalRef = useRef(null);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // Focus first focusable element on open
  useEffect(() => {
    if (!modalRef.current) return;
    const focusable = modalRef.current.querySelectorAll(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) {
      // Defer slightly to let form render
      setTimeout(() => focusable[0]?.focus(), 50);
    }
  }, []);

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal fade-in${large ? ' modal-lg' : ''}`} ref={modalRef}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
          <h3 style={{ fontSize:17, fontWeight:700, color:'#f1f5f9' }}>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ fontSize:18 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
