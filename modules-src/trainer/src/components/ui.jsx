import React from 'react';

export const FONT_HEADING = 'var(--ss-font-title)';
export const FONT_BODY = 'var(--ss-font)';

export function Btn({ children, onClick, variant = 'primary', disabled, size = 'md', className = '', type, title }) {
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-5 py-2.5 text-sm', lg: 'px-6 py-3' };
  const variants = {
    primary: 'bg-indigo-500 hover:bg-indigo-400 text-white shadow-lg shadow-indigo-500/20 font-semibold',
    secondary: 'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700',
    ghost: 'bg-transparent hover:bg-slate-800 text-slate-300',
    outline: 'bg-transparent hover:bg-slate-800 text-slate-200 border border-slate-700',
    danger: 'bg-red-900/40 hover:bg-red-900/60 text-red-200 border border-red-900/60',
    success: 'bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-semibold',
  };
  return (
    <button type={type || 'button'} onClick={onClick} disabled={disabled} title={title}
      className={`rounded-lg transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${sizes[size]} ${variants[variant]} ${className}`}
      style={{ fontFamily: FONT_BODY }}>
      {children}
    </button>
  );
}

export function Card({ children, className = '', padded = true }) {
  return <div className={`bg-slate-900/60 backdrop-blur border border-slate-800 rounded-xl ${padded ? 'p-5' : ''} ${className}`}>{children}</div>;
}

export function Field({ label, children, required }) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1.5">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}

export function Input({ value, onChange, type = 'text', placeholder, className = '', ...rest }) {
  return (
    <input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className={`w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-sm focus:border-indigo-500 focus:outline-none ${className}`}
      {...rest} />
  );
}

export function Textarea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea value={value ?? ''} onChange={(e) => onChange(e.target.value)} rows={rows} placeholder={placeholder}
      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-sm focus:border-indigo-500 focus:outline-none resize-y" />
  );
}

export function Badge({ children, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-800 text-slate-300',
    indigo: 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30',
    emerald: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
    amber: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
    red: 'bg-red-500/15 text-red-300 border border-red-500/30',
  };
  return <span className={`inline-block px-2 py-0.5 rounded text-xs ${tones[tone]}`}>{children}</span>;
}

export function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm no-print" onClick={onClose}>
      <div className={`bg-slate-900 border border-slate-700 rounded-2xl ${wide ? 'max-w-4xl' : 'max-w-xl'} w-full max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-slate-900 border-b border-slate-800 px-6 py-4 flex justify-between items-center z-10">
          <h3 className="text-xl font-bold" style={{ fontFamily: FONT_HEADING }}>{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-2xl leading-none">×</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

export function Toggle({ options, value, onChange, multi = false }) {
  const selected = multi ? (value || []) : [value];
  const handle = (v) => {
    if (multi) {
      const cur = value || [];
      onChange(cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
    } else onChange(v);
  };
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <button key={o.id} onClick={() => handle(o.id)}
            className={`text-right text-sm px-3 py-2 rounded-lg border transition ${on ? 'bg-indigo-500/15 border-indigo-500 text-indigo-200' : 'bg-slate-800/50 border-slate-700 text-slate-300 hover:border-slate-600'}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex gap-1 border-b border-slate-800 mb-6 overflow-x-auto">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={`px-4 py-2.5 text-sm border-b-2 -mb-px transition whitespace-nowrap ${value === t.id ? 'border-indigo-500 text-indigo-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, action, back }) {
  return (
    <header className="mb-6 md:mb-8">
      {back && <button onClick={back} className="text-sm text-slate-400 hover:text-slate-200 mb-3">← חזרה</button>}
      <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-3">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold mb-1" style={{ fontFamily: FONT_HEADING }}>{title}</h1>
          {subtitle && <div className="text-sm text-slate-400">{subtitle}</div>}
        </div>
        {action}
      </div>
    </header>
  );
}
