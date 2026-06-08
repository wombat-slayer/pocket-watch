import { useState, useRef, useEffect } from 'react';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_HEADERS = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const pad2 = n => String(n).padStart(2, '0');
const toISO = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;

export default function DatePicker({ value, onChange, placeholder = 'Select date…' }) {
  const initialYear  = value ? +value.slice(0,4)   : new Date().getFullYear();
  const initialMonth = value ? +value.slice(5,7) - 1 : new Date().getMonth();

  const [open,      setOpen]      = useState(false);
  const [viewYear,  setViewYear]  = useState(initialYear);
  const [viewMonth, setViewMonth] = useState(initialMonth);
  const containerRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (!containerRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Sync calendar view when value changes externally
  useEffect(() => {
    if (value) {
      setViewYear(+value.slice(0,4));
      setViewMonth(+value.slice(5,7) - 1);
    }
  }, [value]);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const todayISO = new Date().toISOString().slice(0, 10);

  const displayLabel = value
    ? new Date(value + 'T00:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
    : '';

  return (
    <div ref={containerRef} style={{ position:'relative' }}>
      {/* Trigger */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'8px 12px', background:'var(--bg-page)', border:`1px solid ${open ? 'var(--green)' : 'var(--text-muted)'}`,
          borderRadius:6, cursor:'pointer', fontSize:14, userSelect:'none',
          color: value ? 'var(--text-primary)' : 'var(--text-muted)', transition:'border-color 0.15s',
        }}
      >
        <span>{displayLabel || placeholder}</span>
        <span style={{ fontSize:13, color:'var(--text-muted)', marginLeft:8 }}>📅</span>
      </div>

      {/* Clear button inside trigger */}
      {value && (
        <button
          onClick={e => { e.stopPropagation(); onChange(''); }}
          style={{
            position:'absolute', right:34, top:'50%', transform:'translateY(-50%)',
            background:'none', border:'none', color:'var(--text-secondary)', cursor:'pointer',
            fontSize:15, lineHeight:1, padding:'2px 4px',
          }}
          title="Clear date"
        >×</button>
      )}

      {/* Calendar popout */}
      {open && (
        <div style={{
          position:'absolute', top:'calc(100% + 6px)', left:0, zIndex:1000,
          background:'var(--bg-card)', border:'1px solid var(--text-muted)', borderRadius:10,
          padding:16, width:260, boxShadow:'0 8px 32px rgba(0,0,0,0.5)',
        }}>
          {/* Month nav */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
            <button
              onClick={prevMonth}
              style={{ background:'none', border:'none', color:'var(--text-secondary)', cursor:'pointer', fontSize:18, padding:'2px 8px', borderRadius:4, lineHeight:1 }}
            >‹</button>
            <span style={{ fontWeight:600, fontSize:14, color:'var(--text-primary)' }}>
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button
              onClick={nextMonth}
              style={{ background:'none', border:'none', color:'var(--text-secondary)', cursor:'pointer', fontSize:18, padding:'2px 8px', borderRadius:4, lineHeight:1 }}
            >›</button>
          </div>

          {/* Day-of-week headers */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2, marginBottom:6 }}>
            {DAY_HEADERS.map(d => (
              <div key={d} style={{ textAlign:'center', fontSize:11, color:'var(--text-muted)', fontWeight:600 }}>{d}</div>
            ))}
          </div>

          {/* Day grid */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2 }}>
            {/* Leading empty cells */}
            {Array.from({ length: firstDayOfWeek }, (_, i) => <div key={`pad-${i}`} />)}

            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const iso = toISO(viewYear, viewMonth, day);
              const selected = iso === value;
              const isToday  = iso === todayISO;
              return (
                <DayCell
                  key={day}
                  label={day}
                  selected={selected}
                  isToday={isToday}
                  onClick={() => { onChange(iso); setOpen(false); }}
                />
              );
            })}
          </div>

          {/* Clear link */}
          {value && (
            <button
              onClick={() => { onChange(''); setOpen(false); }}
              style={{
                marginTop:12, width:'100%', background:'none', border:'1px solid var(--bg-raised)',
                color:'var(--text-secondary)', borderRadius:5, padding:'5px 0', fontSize:12, cursor:'pointer',
              }}
            >
              Clear date
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DayCell({ label, selected, isToday, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        textAlign:'center', fontSize:13, padding:'5px 0', borderRadius:5, cursor:'pointer',
        border: isToday && !selected ? '1px solid var(--text-muted)' : '1px solid transparent',
        background: selected ? 'var(--green)' : hovered ? 'var(--bg-raised)' : 'transparent',
        color: selected ? 'var(--bg-page)' : isToday ? 'var(--green)' : 'var(--text-secondary)',
        fontWeight: selected || isToday ? 700 : 400,
        transition:'background 0.1s',
      }}
    >
      {label}
    </button>
  );
}
