import React from 'react';

/* ── Shared UI primitives ── */

export const Card = ({ children, style = {} }) => (
  <div style={{
    background: '#fff', border: '1px solid #E8E2D6', borderRadius: 16,
    boxShadow: '0 1px 4px rgba(0,0,0,.05)', ...style
  }}>
    {children}
  </div>
);

export const Label = ({ children }) => (
  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#5C5447', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.4px' }}>
    {children}
  </label>
);

const inputStyle = {
  width: '100%',
  padding: '11px 14px',
  border: '1.5px solid #E8E2D6',
  borderRadius: 10,
  fontSize: 15,
  background: '#FDFCFA',
  color: '#1C1C1C',
  outline: 'none',
  transition: 'border-color .2s, box-shadow .2s',
  display: 'block',
  minHeight: '46px', // Standard height
  boxSizing: 'border-box'
};

const inputBase = {
  width: '100%', padding: '11px 14px', border: '1.5px solid #E8E2D6',
  borderRadius: 10, fontSize: 15, background: '#FDFCFA', color: '#1C1C1C',
  transition: 'border .15s, box-shadow .15s',
};

const FieldWrapper = ({ label, hint, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column' }}>
    <div style={{ minHeight: 42, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', marginBottom: 8 }}>
      {label && <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#9C9487', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</label>}
      {hint && <span style={{ fontSize: 11, color: '#B5AFA4', marginTop: 2 }}>{hint}</span>}
    </div>
    {children}
  </div>
);

export const TextInput = ({ label, hint, value, onChange, type = 'text', placeholder = '' }) => (
  <FieldWrapper label={label} hint={hint}>
    <input className="inp" type={type} value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} style={inputStyle} />
  </FieldWrapper>
);

export const NumInput = ({ label, hint, value, onChange, min = 0, max = 9999999 }) => (
  <FieldWrapper label={label} hint={hint}>
    <input className="inp" type="number" min={min} max={max} value={value}
      onChange={e => onChange(Number(e.target.value))} style={inputStyle} />
  </FieldWrapper>
);

export function Select({ label, hint, value, onChange, options, style }) {
  return (
    <div style={style}>
      <FieldWrapper label={label} hint={hint}>
        <select value={value} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, cursor: 'pointer', appearance: 'none', backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%239C9487\' stroke-width=\'2.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpath d=\'m6 9 6 6 6-6\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </FieldWrapper>
    </div>
  );
}

export const BtnPrimary = ({ children, onClick, disabled, style = {} }) => (
  <button onClick={onClick} disabled={disabled} className="btn-navy"
    style={{ background: disabled ? '#C0CCDF' : '#1B2A4A', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: 10, fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, opacity: disabled ? .65 : 1, ...style }}>
    {children}
  </button>
);

export const BtnGold = ({ children, onClick, disabled, style = {} }) => (
  <button onClick={onClick} disabled={disabled} className="btn-gold"
    style={{ background: disabled ? '#E8E2D6' : '#B8860B', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: 10, fontSize: 15, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 8, opacity: disabled ? .65 : 1, transition: 'background .2s', ...style }}>
    {children}
  </button>
);

export const BtnGhost = ({ children, onClick, style = {} }) => (
  <button onClick={onClick} className="btn-ghost"
    style={{ background: 'transparent', color: '#5C5447', border: '1.5px solid #E8E2D6', padding: '11px 22px', borderRadius: 10, fontSize: 15, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 8, ...style }}>
    {children}
  </button>
);

export const Spinner = ({ size = 20, color = '#fff' }) => (
  <span style={{ width: size, height: size, border: `2.5px solid rgba(255,255,255,.3)`, borderTopColor: color, borderRadius: '50%', display: 'inline-block', animation: 'spinAnim .8s linear infinite' }} />
);

export const Tag = ({ label, color = 'gray' }) => {
  const map = {
    red:    { bg: '#FEF2F2', text: '#991B1B' },
    green:  { bg: '#ECFDF5', text: '#065F46' },
    amber:  { bg: '#FFFBEB', text: '#92400E' },
    blue:   { bg: '#EFF6FF', text: '#1E40AF' },
    gray:   { bg: '#F3F4F6', text: '#4B5563' },
  };
  const c = map[color] || map.gray;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', background: c.bg, color: c.text }}>
      {label}
    </span>
  );
};

export const Divider = () => <div style={{ width: '100%', height: 1, background: '#EDEBE6', margin: '8px 0' }} />;

export const Steps = ({ current }) => {
  const labels = ['Profile', 'Results', 'Contest', 'Processing', 'Verdict'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 44 }}>
      {labels.map((l, i) => {
        const n = i + 1, done = n < current, active = n === current;
        return (
          <React.Fragment key={i}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{
                width: 26, height: 26, borderRadius: '50%', fontSize: 11, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                background: done ? '#065F46' : active ? '#0A192F' : 'transparent',
                color: done || active ? '#fff' : '#9CA3AF',
                border: done || active ? 'none' : '1.5px solid #E5E7EB',
              }}>
                {done ? '✓' : n}
              </div>
              <span style={{ fontSize: 11, fontWeight: active ? 700 : 400, color: active ? '#1C1C1C' : '#9C9487', whiteSpace: 'nowrap' }}>{l}</span>
            </div>
            {i < labels.length - 1 && (
              <div style={{ flex: 1, height: 1, background: n < current ? '#276749' : '#E8E2D6', margin: '0 8px' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
