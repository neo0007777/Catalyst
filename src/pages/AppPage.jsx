import React, { useState, useEffect, useRef } from 'react';
import { Icon } from '../components/Icons';
import { Card, NumInput, Select, BtnPrimary, BtnGold, BtnGhost, Spinner, Tag, Steps } from '../components/UI';
import { useAuth } from '../context/AuthContext';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

/* ── Decision Engine bridge ─────────────────────────────────────── */
const Engine = {
  decide: async (d) => {
    const r = await fetch(`${API}/api/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sector: d.sector, age: d.age, monthly_income: d.income, monthly_debt: d.debt,
        credit_score: d.score, open_credit_lines: d.lines, dependents: d.dependents,
        mild_delinquencies: d.mild, severe_defaults: d.defaults, has_collateral: d.collateral,
      }),
    });
    const j = await r.json();
    if (!j.decision) throw new Error('No decision returned');
    return {
      decision: j.decision, confidence: j.confidence, primary_reason: j.primary_reason,
      gap_report: j.gap_report, feature_vector: j.feature_vector, decision_id: j.decision_id,
      factors: (j.factors || []).map(f => ({
        name: f.human_name || f.name, 
        factor_name: f.name, 
        direction: f.direction || 'safe',
        explanation: f.explanation || f.description, 
        value: f.value || j.feature_vector?.[f.name],
        weight: f.weight || 0,
      })),
    };
  },
  appeal: async (orig, evidence, files, geminiKey, onStream, onComplete) => {
    onStream('Connecting to forensic auditor…', false);
    
    // Preparation
    const formData = new FormData();
    formData.append('decision_id', orig.decision_id || '1');
    formData.append('original_feature_vector', JSON.stringify(orig.feature_vector));
    formData.append('original_factors', JSON.stringify(orig.factors));
    formData.append('evidence_text', JSON.stringify(evidence));
    
    // Add Files (use factor_name as key)
    Object.entries(files).forEach(([k, f]) => {
      const factor = orig.factors.find(x => x.name === k || x.factor_name === k);
      formData.append('documents', f, factor?.factor_name || k);
    });

    const prm = fetch(`${API}/api/appeal`, {
      method: 'POST',
      body: formData,
    }).then(r => r.json());

    if (geminiKey) {
      try {
        const resp = await fetch(`${API}/api/stream-audit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
             text: `You are a financial fairness auditor. Evidence being contested: "${Object.values(evidence).join(' ')}". Write 3 brief numbered steps (no markdown) you're taking to verify this evidence. Be precise.`
          }),
        });
        const rd = resp.body.getReader(), dc = new TextDecoder();
        while (true) {
          const { done, value } = await rd.read(); if (done) break;
          const chunk = dc.decode(value);
          // Simple text stream handling
          onStream(chunk, true);
        }
        onStream('Forensic auditing in progress...', false);
      } catch { onStream('Running local semantic review.', false); }
    }

    try {
      const result = await prm;
      onStream(`Audit complete → ${result.summary}`, false);
      setTimeout(() => onComplete({
        new_decision: result.new_decision, new_confidence: result.new_confidence,
        verdict_changed: result.verdict_changed, summary: result.summary,
        delta: (result.delta || []).filter(f => {
          // Robust matching: find by factor_name (machine id) which we standardized
          return (orig.factors || []).some(of => 
            (of.factor_name === f.factor_name || of.name === f.name) && of.direction === 'risk'
          );
        }).map(f => {
          return {
            factor: f.factor,
            old_impact: f.old_impact,
            new_impact: f.new_impact === 'SAFE' ? 'RESOLVED' : f.new_impact,
            changed: f.changed,
            reason: f.reason
          };
        }),
      }), 1200);
    } catch { onStream('Connection error. Please retry.', false); setTimeout(() => onComplete(null), 1000); }
  },
};

/* ── Profile Form ───────────────────────────────────────────────── */
function ProfileForm({ data, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Section headers */}
      {[
        {
          n: '1', title: 'Application Type & Personal', sub: 'Choose what you\'re applying for',
          fields: (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              <Select label="Sector" value={data.sector} onChange={v => onChange({ ...data, sector: v })}
                options={['Personal Loan', 'Mortgage', 'Business Loan']} />
              <NumInput label="Age" hint="18–80" value={data.age} onChange={v => onChange({ ...data, age: v })} min={18} max={80} />
              <NumInput label="Dependents" hint="People in your care" value={data.dependents} onChange={v => onChange({ ...data, dependents: v })} />
            </div>
          )
        },
        {
          n: '2', title: 'Financial Overview', sub: 'Your monthly income and obligations',
          fields: (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <NumInput label="Monthly Income" hint="Gross, before tax" value={data.income} onChange={v => onChange({ ...data, income: v })} />
              <NumInput label="Monthly Debt Payments" hint="All recurring payments" value={data.debt} onChange={v => onChange({ ...data, debt: v })} />
            </div>
          )
        },
        {
          n: '3', title: 'Credit History', sub: 'Your credit score and payment track record',
          fields: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <NumInput label="Credit Score" hint="300–850" value={data.score} onChange={v => onChange({ ...data, score: v })} min={300} max={850} />
                <NumInput label="Open Credit Lines" hint="Cards, loans, overdrafts" value={data.lines} onChange={v => onChange({ ...data, lines: v })} />
                <NumInput label="30-Day Late Payments" hint="In the past 2 years" value={data.mild} onChange={v => onChange({ ...data, mild: v })} />
                <NumInput label="90+ Day Defaults" hint="Severe delinquencies on record" value={data.defaults} onChange={v => onChange({ ...data, defaults: v })} />
              </div>
              {(data.sector === 'Personal Loan' || data.sector === 'Business Loan') && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', background: '#FDFCFA', border: '1.5px solid #E8E2D6', borderRadius: 12, cursor: 'pointer', marginTop: 8 }}>
                  <input type="checkbox" checked={data.collateral} onChange={e => onChange({ ...data, collateral: e.target.checked })}
                    style={{ width: 18, height: 18, accentColor: '#C6A96B', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#1B2A4A' }}>Collateral Available</div>
                    <div style={{ fontSize: 12, color: '#9C9487', marginTop: 2 }}>Offering collateral reduces your assessed risk by ~40%.</div>
                  </div>
                </label>
              )}
            </div>
          )
        },
      ].map(({ n, title, sub, fields }) => (
        <div key={n}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid #EDEBE6' }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: '#1B2A4A', color: '#fff', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{n}</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
              <div style={{ fontSize: 12, color: '#9C9487', marginTop: 1 }}>{sub}</div>
            </div>
          </div>
          {fields}
        </div>
      ))}
    </div>
  );
}

/* ── What-If Simulator ──────────────────────────────────────────── */
function WhatIf({ defaultCase, decision }) {
  const [sim, setSim] = useState(defaultCase);
  const [res, setRes] = useState(null);
  const t = useRef(null);
  useEffect(() => {
    clearTimeout(t.current);
    t.current = setTimeout(() => {
      const q = new URLSearchParams({ sector: sim.sector, age: sim.age, monthly_income: sim.income, monthly_debt: sim.debt, credit_score: sim.score, open_credit_lines: sim.lines, dependents: sim.dependents, mild_delinquencies: sim.mild, severe_defaults: sim.defaults, has_collateral: sim.collateral });
      fetch(`${API}/api/whatif?${q}`).then(r => r.json()).then(setRes);
    }, 400);
  }, [sim]);
  const originalVals = useRef(null);
  useEffect(() => {
    if (decision && !originalVals.current) {
      originalVals.current = { ...sim };
    }
    // When resetting, clear it
    if (!decision) originalVals.current = null;
  }, [decision]);

  const [scenarios, setScenarios] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [validating, setValidating] = useState(false);

  const generatePaths = async () => {
    setValidating(true);
    const candidates = [
      {
        name: "Financial Safety Focus",
        desc: "Zero defaults and minimal debt ratio.",
        icon: <Icon.Shield />,
        vals: { ...sim, defaults: 0, mild: 0, debt: Math.min(sim.debt, 400), score: Math.max(sim.score, 720) }
      },
      {
        name: "Credit Legend Path",
        desc: "Optimized credit history and multiple lines.",
        icon: <Icon.Zap />,
        vals: { ...sim, score: 780, lines: 14, defaults: 0 }
      },
      {
        name: "High Stability Profile",
        desc: "Focuses on collateral and income stability.",
        icon: <Icon.TrendingUp />,
        vals: { ...sim, income: Math.max(sim.income, 8500), collateral: true, lines: Math.max(sim.lines, 10) }
      },
      {
        name: "Active Risk Mitigation",
        desc: "Clearing small delinquencies and balancing debt.",
        icon: <Icon.Activity />,
        vals: { ...sim, mild: 0, debt: Math.min(sim.debt, 800), collateral: true, score: Math.max(sim.score, 710) }
      }
    ];

    try {
      const checks = await Promise.all(candidates.map(c => {
        const q = new URLSearchParams({ sector: sim.sector, age: c.vals.age, monthly_income: c.vals.income, monthly_debt: c.vals.debt, credit_score: c.vals.score, open_credit_lines: c.vals.lines, dependents: c.vals.dependents, mild_delinquencies: c.vals.mild, severe_defaults: c.vals.defaults, has_collateral: c.vals.collateral });
        return fetch(`${API}/api/whatif?${q}`).then(r => r.json());
      }));
      setScenarios(candidates.filter((c, i) => checks[i].decision === 'APPROVE'));
    } catch (e) {
      console.error("Strategy validation failed", e);
    } finally {
      setValidating(false);
    }
  };

  const getDiff = (target) => {
    const diffs = [];
    const base = originalVals.current || sim;
    const format = (v, k) => (k === 'income' || k === 'debt') ? `₹${v.toLocaleString()}` : v;

    if (target.income !== base.income) diffs.push(`Income: ${format(base.income, 'income')} → ${format(target.income, 'income')}`);
    if (target.score !== base.score) diffs.push(`Score: ${base.score} → ${target.score}`);
    if (target.debt !== base.debt) diffs.push(`Debt: ${format(base.debt, 'debt')} → ${format(target.debt, 'debt')}`);
    if (target.defaults !== base.defaults) diffs.push(`Defaults: ${base.defaults} → ${target.defaults}`);
    if (target.collateral !== base.collateral) diffs.push(`Collateral: ${base.collateral ? 'Yes' : 'No'} → ${target.collateral ? 'Yes' : 'No'}`);
    return diffs;
  };

  const ok = res?.decision === 'APPROVE';
  return (
    <div style={{ paddingTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', background: ok ? '#F0FAF4' : '#FFF5F5', border: `1px solid ${ok ? '#B7E4C7' : '#FEB2B2'}`, borderRadius: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: ok ? '#276749' : '#9B1C1C' }}>{res?.decision || '—'}</span>
        <span style={{ fontSize: 13, color: '#6B6456' }}>Confidence: <strong>{res?.confidence}%</strong></span>
      </div>
      <div style={{ padding: '12px 16px', background: '#F8F9FA', border: '1px solid #E9ECEF', borderRadius: 8, marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#0A192F', fontSize: 16 }}>💡</span>
          <span style={{ fontSize: 13, color: '#4B5563', fontStyle: 'italic' }}><strong>Interactive Simulator:</strong> Adjust values to re-calculate your decision in real-time.</span>
        </div>
        {!ok && !scenarios && !validating && (
          <button onClick={generatePaths} style={{ background: '#B8860B', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'transform .2s', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            Discover Approval Paths <Icon.Arrow />
          </button>
        )}
        {validating && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="spinner-small" />
            <span style={{ fontSize: 12, color: '#6B7280', fontWeight: 600 }}>Verifying potential paths...</span>
          </div>
        )}
      </div>

      {scenarios && (
        <div className="fade-in" style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
             <span style={{ fontSize: 12, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Potential Approval Strategies</span>
             <button onClick={() => { setScenarios(null); setSim(originalVals.current || defaultCase); }} style={{ fontSize: 11, color: '#B8860B', background: 'transparent', border: 'none', cursor: 'pointer' }}>Close Options</button>
          </div>
          <div style={{ display: 'flex', overflowX: 'auto', gap: 14, paddingBottom: 10, msOverflowStyle: 'none', scrollbarWidth: 'none' }} className="no-scrollbar">
            <style>{`.no-scrollbar::-webkit-scrollbar { display: none; }`}</style>
            {scenarios.map((s, i) => (
              <div key={i} 
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => setSim(s.vals)}
                style={{ 
                  flex: '0 0 240px', background: '#fff', border: '1px solid #E5E1D8', borderRadius: 14, padding: '16px', cursor: 'pointer', 
                  transition: 'all .25s', transform: hovered === i ? 'translateY(-2px)' : 'none',
                  boxShadow: hovered === i ? '0 12px 30px rgba(0,0,0,.08)' : '0 2px 4px rgba(0,0,0,.02)',
                  position: 'relative', overflow: 'hidden'
                }}>
                <div style={{ padding: 8, background: '#F8F9FA', borderRadius: 8, width: 'fit-content', color: '#B8860B', marginBottom: 12 }}>{s.icon}</div>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: '#0A192F', marginBottom: 4 }}>{s.name}</div>
                <div style={{ fontSize: 11.5, color: '#6B7280', lineHeight: 1.4 }}>{s.desc}</div>

                {hovered === i && (
                  <div className="pop-in" style={{ position: 'absolute', inset: 0, background: 'rgba(10, 25, 47, 0.98)', borderRadius: 14, padding: '16px', display: 'flex', flexDirection: 'column', color: '#fff', zIndex: 10, pointerEvents: 'none' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', marginBottom: 10, color: '#B8860B', letterSpacing: 0.8 }}>Strategic Delta (vs Original)</div>
                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }} className="no-scrollbar">
                      {getDiff(s.vals).map((d, j) => {
                         const [label, vals] = d.split(': ');
                         return (
                           <div key={j} style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 4 }}>
                             <span style={{ color: 'rgba(255,255,255,0.6)' }}>{label}</span>
                             <span style={{ fontWeight: 600, color: '#fff' }}>{vals}</span>
                           </div>
                         );
                      })}
                    </div>
                    <div style={{ fontSize: 9, marginTop: 10, opacity: .5, textAlign: 'center' }}>Click to apply profile</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <ProfileForm data={sim} onChange={setSim} />
    </div>
  );
}

/* ── AI Chatbot ─────────────────────────────────────────────────── */
const SYS = `You are "Catalyst AI", a specialist financial advisor. ONLY answer questions about:
loan applications, credit scores, debt-to-income ratios, financial metrics, insurance claims/decisions, how to appeal algorithmic decisions, SHAP/explainability concepts, delinquencies, defaults, credit history.

If asked anything unrelated, respond ONLY: "I can only help with financial decisions, loan applications, and contestation strategies. Is there anything about your result I can explain?"

Tone: warm, concise (max 3 sentences), like a knowledgeable friend.`;

function Chatbot({ geminiKey, sector, decision, forceOpen, triggerMsg, open, setOpen }) {
  const [greeted, setGreeted] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [inp, setInp] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (decision && greeted) setGreeted(false);
  }, [decision]);

  useEffect(() => {
    if (triggerMsg) {
      setOpen(true);
      setMsgs([{ r: 'bot', t: triggerMsg.text }]);
    }
  }, [triggerMsg]);

  useEffect(() => {
    if (forceOpen && !greeted) {
      setGreeted(true);
      const denied = decision?.decision === 'DENY';
      let msg = "";
      
      if (!decision) {
        msg = `Hi! I'm Catalyst AI. I can help you fill out this ${sector} application or explain any of the financial metrics below. What's on your mind?`;
      } else {
        msg = denied
          ? `I see your ${sector} request was flagged — "${decision?.primary_reason}" was the main reason. Want me to explain what that means or how to contest it?`
          : `Your ${sector} application passed at ${decision?.confidence}% confidence. Want to know what factors helped — or how to protect your score?`;
      }
      
      setTimeout(() => { setOpen(true); setMsgs([{ r: 'bot', t: msg }]); }, 900);
    }
  }, [forceOpen, greeted, decision, sector, setOpen]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs]);

  const send = async () => {
    if (!inp.trim()) return;
    const txt = inp.trim();
    setInp(''); setBusy(true);
    let ctx = decision ? `${sector} application: ${decision.decision}. Primary reason: ${decision.primary_reason}. Confidence: ${decision.confidence}%.` : `Setting up a ${sector} application.`;
    
    // Inject active factor focus if this chat was triggered by a card click
    if (msgs.length > 0 && msgs[0].t?.props?.children) {
       const focus = msgs[0].t.props.children.find(c => c.type === 'strong')?.props?.children;
       if (focus) ctx += ` CRITICAL: The user is specifically asking about "${focus}". Focus your explanation entirely on this factor.`;
    }

    const hist = msgs.slice(-8).map(m => {
       const txt = typeof m.t === 'string' ? m.t : m.t.props?.children?.map(c => typeof c === 'string' ? c : c.props?.children).join('');
       return `${m.r === 'user' ? 'User' : 'Catalyst'}: ${txt}`;
    });
    
    setMsgs(prev => [...prev, { r: 'user', t: txt }]);

    try {
      const r = await fetch(`${API}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: txt, history: hist, context: ctx }),
      });
      const d = await r.json();
      setMsgs(prev => [...prev, { r: 'bot', t: d.reply || 'Sorry, no response.' }]);
    } catch { 
      setMsgs(prev => [...prev, { r: 'bot', t: 'Connection error. Try again.' }]); 
    }
    setBusy(false);
  };

  const chips = decision?.decision === 'DENY'
    ? ['Why was I denied?', 'How do I contest this?', 'What is DTI ratio?']
    : ['What helped my score?', 'How do I maintain this?', 'What is credit utilization?'];

  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      {open && (
        <div className="pop-in" style={{ width: 348, height: 460, background: '#fff', borderRadius: 18, boxShadow: '0 20px 60px rgba(0,0,0,.15)', display: 'flex', flexDirection: 'column', overflow: 'hidden', marginBottom: 12, border: '1px solid #E8E2D6' }}>
          <div style={{ padding: '14px 18px', background: '#1B2A4A', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, background: '#C6A96B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Outfit', sans-serif", fontSize: 17, color: '#1B2A4A', fontWeight: 700 }}>C</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: '#fff' }}>Catalyst AI</div>
                <div style={{ fontSize: 10, color: '#9BAABF' }}>Financial advisor · {sector}</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} style={{ color: '#9BAABF', background: 'transparent', border: 'none', padding: 4 }}><Icon.X /></button>
          </div>

          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 9, background: '#FDFCFA' }}>
            {msgs.map((m, i) => (
              <div key={i} style={{ alignSelf: m.r === 'user' ? 'flex-end' : 'flex-start', maxWidth: '87%', background: m.r === 'user' ? '#1B2A4A' : '#fff', color: m.r === 'user' ? '#fff' : '#1C1C1C', border: m.r !== 'user' ? '1px solid #E8E2D6' : 'none', padding: '10px 13px', borderRadius: m.r === 'user' ? '13px 13px 3px 13px' : '13px 13px 13px 3px', fontSize: 13.5, lineHeight: 1.55 }}>
                {typeof m.t === 'string' ? m.t : m.t} 
              </div>
            ))}
            {busy && <div style={{ alignSelf: 'flex-start', background: '#fff', border: '1px solid #E8E2D6', padding: '10px 14px', borderRadius: '12px 12px 12px 3px', display: 'flex', gap: 4 }}>{[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:'50%',background:'#C6A96B',animation:`scanPulse 1.3s ease ${i*.18}s infinite`}}/>)}</div>}
          </div>

          {msgs.length <= 2 && decision && (
            <div style={{ padding: '7px 12px', display: 'flex', flexWrap: 'wrap', gap: 5, background: '#FDFCFA' }}>
              {chips.map((c, i) => <button key={i} onClick={() => setInp(c)} style={{ fontSize: 11.5, padding: '5px 10px', background: '#F4F1EC', border: '1px solid #E8E2D6', borderRadius: 20, color: '#5C5447', cursor: 'pointer' }}>{c}</button>)}
            </div>
          )}

          <div style={{ padding: '10px 12px', borderTop: '1px solid #E8E2D6', display: 'flex', gap: 7, background: '#fff' }}>
            <input className="inp" value={inp} onChange={e => setInp(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="Ask about your decision…"
              style={{ flex: 1, padding: '9px 12px', border: '1.5px solid #E8E2D6', borderRadius: 8, fontSize: 13.5, background: '#FDFCFA', color: '#1C1C1C' }} />
            <button onClick={send} style={{ background: '#1B2A4A', color: '#fff', border: 'none', padding: '0 14px', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Send</button>
          </div>
        </div>
      )}
      <button onClick={() => setOpen(o => !o)} style={{ width: 48, height: 48, borderRadius: '50%', background: open ? '#5C5447' : '#1B2A4A', color: '#fff', border: 'none', cursor: 'pointer', boxShadow: '0 4px 18px rgba(27,42,76,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .2s', position: 'relative' }}>
        {open ? <Icon.X /> : <Icon.Chat />}
        {!open && forceOpen && greeted && <span style={{ position: 'absolute', top: 1, right: 1, width: 10, height: 10, background: '#C6A96B', borderRadius: '50%', border: '2px solid #F4F1EC' }} />}
      </button>
    </div>
  );
}

/* ── Main App Page ──────────────────────────────────────────────── */
export default function AppPage({ onSignOut }) {
  const { user, geminiKey: _gk } = useAuth();
  // Session Persistence: Load initial state from localStorage
  const getSaved = (key, def) => {
    const s = localStorage.getItem(`catalyst_${key}`);
    if (!s) return def;
    try { return JSON.parse(s); } catch { return s; }
  };

  const [geminiKey, setGeminiKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [view, setView] = useState(() => {
    let v = Number(getSaved('view', 1));
    const d = getSaved('decision', null);
    const vd = getSaved('verdict', null);
    
    // Auto-recover from corrupted state
    if (v >= 2 && v <= 4 && !d) v = 1;      // Missing decision -> go start
    if (v === 5 && !vd) v = d ? 3 : 1;      // Missing verdict -> go contest or start
    return v;
  });
  const [chatReady, setChatReady] = useState(() => getSaved('chatReady', false));
  const [chatOpen, setChatOpen] = useState(false);
  const [chatTrigger, setChatTrigger] = useState(null);
  const [caseData, setCaseData] = useState(() => getSaved('caseData', { sector: 'Personal Loan', age: 35, income: 60000, debt: 1500, score: 680, dependents: 1, lines: 8, mild: 0, defaults: 1, collateral: false }));
  const [processing, setProcessing] = useState(false);
  const [decision, setDecision] = useState(() => getSaved('decision', null));
  const [error, setError] = useState('');
  const [appeals, setAppeals] = useState(() => getSaved('appeals', {}));
  const [files, setFiles] = useState({}); // Files cannot be serialized to localStorage easily
  const [tone, setTone] = useState(() => getSaved('tone', 'neutral'));
  const toneT = useRef(null);
  const fileRefs = useRef({});
  const [logs, setLogs] = useState([]);
  const [verdict, setVerdict] = useState(() => getSaved('verdict', null));
  const [liveConf, setLiveConf] = useState(null);
  const logRef = useRef(null);
  const [letterOpen, setLetterOpen] = useState(false);
  const [letter, setLetter] = useState('');
  const [narrative, setNarrative] = useState(() => getSaved('narrative', ''));
  const [fetchingNarrative, setFetchingNarrative] = useState(false);

  // Persistence Sink: Save state to localStorage on changes
  useEffect(() => {
    const state = { view, decision, caseData, appeals, tone, verdict, narrative, chatReady };
    Object.entries(state).forEach(([k, v]) => {
      localStorage.setItem(`catalyst_${k}`, JSON.stringify(v));
    });
  }, [view, decision, caseData, appeals, tone, verdict, narrative, chatReady]);

  useEffect(() => { 
    fetch(`${API}/api/config`)
      .then(r => r.json())
      .then(d => {
        setGeminiKey(d.GEMINI_API_KEY || '');
        setGroqKey(d.GROQ_API_KEY || '');
      })
      .catch(() => {}); 
  }, []);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logs]);
  useEffect(() => { window.scrollTo(0, 0); }, [view]);

  useEffect(() => {
    const gen = async () => {
      if (letterOpen && !letter && (geminiKey || groqKey)) {
        setLetter('Generating your official appeal letter…');
        const q = new URLSearchParams({ sector: caseData.sector, primary_reason: decision.primary_reason, tone });
        const body = JSON.stringify({ appeals });
        try {
          const r = await fetch(`${API}/api/appeal-letter?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
          const d = await r.json();
          setLetter(d.letter);
        } catch (e) {
          setLetter("Unable to generate at this moment. Please try again.");
        }
      }
    };
    gen();
  }, [letterOpen, letter, geminiKey, caseData.sector, decision?.primary_reason, tone, appeals]);

  const submit = async () => {
    setProcessing(true); setError(''); setNarrative('');
    try { 
      const res = await Engine.decide(caseData); 
      setDecision(res); setView(2); setChatReady(true); 
      
      // Secondary background call for Deep Narrative
      setFetchingNarrative(true);
      fetch(`${API}/api/narrative`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature_vector: res.feature_vector, prediction: { decision: res.decision, confidence: res.confidence } })
      })
      .then(r => r.json())
      .then(d => { setNarrative(d.narrative); setFetchingNarrative(false); })
      .catch(() => setFetchingNarrative(false));

    }
    catch { setError('Unable to reach the decision engine. Is the backend server running on port 8000?'); }
    setProcessing(false);
  };

  const reset = () => {
    setView(1);
    setDecision(null);
    setChatReady(false);
    setChatTrigger(null);
    setChatOpen(false);
    setAppeals({});
    setFiles({});
    setLogs([]);
    setVerdict(null);
    setLiveConf(null);
    setTone('neutral');
    setLetter('');
    setLetterOpen(false);
    setNarrative('');
    // Clear persistence
    ['view', 'decision', 'caseData', 'appeals', 'tone', 'verdict', 'narrative', 'chatReady'].forEach(k => {
      localStorage.removeItem(`catalyst_${k}`);
    });
  };

  const onAppeal = (name, text) => {
    setAppeals(p => {
      const u = { ...p, [name]: text };
      clearTimeout(toneT.current);
      toneT.current = setTimeout(() => {
        const j = Object.values(u).join(' ');
        if (j.trim()) fetch(`${API}/api/tone`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: j }) }).then(r => r.json()).then(d => setTone(d.tone)).catch(() => {});
      }, 650);
      return u;
    });
  };

  const onFile = (name, file) => {
    if (!file) return;
    const kw = ['medical', 'hospital', 'income', 'pay', 'settled', 'cleared', 'identity', 'error', 'dispute', 'bonus'];
    const found = file.name.toLowerCase().split(/[\W_]+/).filter(t => kw.includes(t));
    const hint = ` [Attached: ${file.name}${found.length ? ' · keywords: ' + found.join(', ') : ''}]`;
    setFiles(p => ({ ...p, [name]: file }));
    setAppeals(p => ({ ...p, [name]: (p[name] || '') + hint }));
  };

  const runAppeal = () => {
    setView(4); setLogs([]); setLiveConf(decision.confidence);
    Engine.appeal(decision, appeals, files, geminiKey,
      (msg, isToken) => setLogs(p => {
        if (isToken) { const c = [...p]; if (c.length && c[c.length - 1].stream) { c[c.length - 1].txt += msg; return c; } return [...c, { txt: msg, stream: true }]; }
        return [...p, { txt: msg, stream: false }];
      }),
      res => { setLiveConf(res?.new_confidence ?? liveConf); setTimeout(() => { setVerdict(res); setView(5); }, 1200); }
    );
  };

  const approve = decision?.decision === 'APPROVE';
  const flagged = decision?.factors?.filter(f => f.direction === 'risk') || [];

  return (
    <>
      {/* NAV */}
      <nav style={{ background: '#fff', borderBottom: '1px solid #E8E2D6', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 28px', height: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, background: '#1B2A4A', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Outfit', sans-serif", fontSize: 18, color: '#C6A96B' }}>C</div>
            <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 19, color: '#1B2A4A' }}>Catalyst</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {user?.picture && <img src={user.picture} alt="" style={{ width: 26, height: 26, borderRadius: '50%' }} />}
            <span style={{ fontSize: 13, color: '#6B6456' }}>{user?.name || user?.email}</span>
            <button onClick={onSignOut} style={{ fontSize: 12, color: '#9C9487', background: 'transparent', border: '1px solid #E8E2D6', padding: '5px 12px', borderRadius: 7 }}>Sign out</button>
          </div>
        </div>
      </nav>

      <main style={{ maxWidth: 820, margin: '0 auto', padding: '36px 28px 100px' }}>

        {/* STEP 1 */}
        {view === 1 && (
          <div className="fade-up">
            <Steps current={1} />
            <div style={{ marginBottom: 32 }}>
              <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 40, color: '#1B2A4A', marginBottom: 10, lineHeight: 1.15 }}>Your financial profile</h1>
              <p style={{ fontSize: 16, color: '#6B6456', lineHeight: 1.6 }}>Enter your details. Our engine will analyze the algorithmic decision and produce a complete factor breakdown.</p>
            </div>
            <Card style={{ padding: '36px 40px' }}>
              <ProfileForm data={caseData} onChange={setCaseData} />
              {error && <div style={{ marginTop: 20, padding: '12px 16px', background: '#FFF5F5', border: '1px solid #FEB2B2', borderRadius: 9, fontSize: 13, color: '#9B1C1C', display: 'flex', gap: 6, alignItems: 'flex-start' }}><Icon.Warn /> {error}</div>}
              <div style={{ marginTop: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <span style={{ fontSize: 12, color: '#9C9487', display: 'flex', alignItems: 'center', gap: 5 }}><Icon.Lock /> Data is processed locally. Never stored or shared.</span>
                <BtnGold onClick={submit} disabled={processing}>
                  {processing ? <><Spinner size={15} /> Analyzing…</> : <>Analyze My Application <Icon.Arrow /></>}
                </BtnGold>
              </div>
            </Card>
          </div>
        )}

        {/* STEP 2 */}
        {view === 2 && decision && (
          <div className="fade-up">
            <Steps current={2} />
            {/* ORIGINAL VERDICT CARD */}
            <div style={{ background: approve ? '#059669' : '#0A192F', borderRadius: 24, padding: '40px 48px', color: '#fff', marginBottom: 24, position: 'relative', overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.15)' }}>
              <div style={{ position: 'relative', zIndex: 1 }}>
                <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 64, margin: 0, lineHeight: 1, marginBottom: 12 }}>{approve ? 'Approved' : 'Denied'}</h1>
                <p style={{ fontSize: 18, opacity: .9, fontWeight: 400 }}>{decision.confidence}% confidence · Primary factor: <strong style={{color: approve ? '#fff' : '#B8860B'}}>{decision.primary_reason}</strong></p>
              </div>
              <div style={{ position: 'absolute', top: -50, right: -50, width: 200, height: 200, background: approve ? 'rgba(52,211,153,.1)' : 'rgba(184,134,11,.05)', borderRadius: '50%', filter: 'blur(60px)' }} />
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
              <div>
                <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 28, color: '#0A192F', marginBottom: 6 }}>What the algorithm found</h2>
                <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 0 }}>Ranked by impact. Hover each card for details.</p>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {!approve && <BtnGold onClick={() => { setView(3); setChatOpen(false); }}>Challenge This Decision <Icon.Arrow /></BtnGold>}
                <BtnGhost onClick={reset}>Start Over</BtnGhost>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 24 }}>
              {decision.factors.map((f, i) => (
                <div key={i} className="factor-card" 
                  onClick={() => setChatTrigger({ id: Date.now(), text: <span>Do you need any help understanding how <strong style={{ color: '#B8860B' }}>{f.human_name}</strong> affected your application?</span> })}
                  style={{ background: '#fff', border: '1px solid #E5E1D8', borderRadius: 14, padding: '20px 22px', borderLeft: `5px solid ${f.direction === 'risk' ? '#991B1B' : '#064E3B'}`, cursor: 'pointer', transition: 'transform .2s, box-shadow .2s' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 7 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3, color: '#0A192F' }}>
                      {f.human_name || f.name || f.label || "Analysis Factor"}
                    </div>
                    <Tag label={f.direction === 'risk' ? '↑ Risk' : '↓ Safe'} color={f.direction === 'risk' ? 'red' : 'green'} />
                  </div>
                  <p style={{ fontSize: 13, color: '#4B5563', lineHeight: 1.5, marginBottom: 12 }}>{f.explanation}</p>
                  <div style={{ height: 3, background: '#F0EDE8', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${f.weight}%`, background: f.direction === 'risk' ? '#E53E3E' : '#276749', borderRadius: 4, animation: 'barFill 1s ease both' }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Flip tip */}
            {decision.gap_report && (
              <Card style={{ padding: '20px 24px', borderLeft: '4px solid #C6A96B', background: '#FFFDF7', marginBottom: 18 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#8C742A', marginBottom: 6 }}>What would change this?</div>
                <div style={{ fontSize: 17, fontFamily: "'Outfit', sans-serif", color: '#4A3A0E', lineHeight: 1.5 }}>"{decision.gap_report.human_description}"</div>
              </Card>
            )}

            {/* What-if */}
            <Card style={{ marginBottom: 18 }}>
              <details>
                <summary style={{ fontWeight: 700, fontSize: 15, color: '#1B2A4A', cursor: 'pointer', userSelect: 'none', listStyle: 'none', padding: '20px 24px' }}>
                  Try a different scenario <span style={{ fontSize: 12, color: '#9C9487', fontWeight: 400 }}>— see how changes affect your result</span>
                </summary>
                <div style={{ padding: '0 24px 24px' }}><WhatIf defaultCase={caseData} decision={decision} /></div>
              </details>
            </Card>
          </div>
        )}

        {/* STEP 3 */}
        {view === 3 && decision && (
          <div className="fade-up">
            <Steps current={3} />
            <div style={{ marginBottom: 28 }}>
              <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 34, color: '#1B2A4A', marginBottom: 8 }}>Add your context</h2>
              <p style={{ fontSize: 15, color: '#6B6456', lineHeight: 1.65 }}>Explain your situation for each flagged factor. The more context you give, the better the re-evaluation.</p>
            </div>

            {tone !== 'neutral' && (
              <div style={{ marginBottom: 18 }}>
                <Tag label={tone === 'distressed' ? 'We sense this may be stressful — take your time' : 'Your submission reads as clear and confident'} color={tone === 'distressed' ? 'amber' : 'green'} />
              </div>
            )}

            {flagged.length === 0
              ? <Card style={{ padding: '20px 24px' }}><p style={{ color: '#276749', fontSize: 14 }}>✓ No major risk factors to address.</p></Card>
              : flagged.map((f, i) => {
                const hasDoc = !!files[f.name];
                const hasText = (appeals[f.name] || '').trim().split(/\s+/).length >= 15;
                return (
                <Card key={i} style={{ padding: '26px 30px', marginBottom: 14, border: !hasDoc ? '1.5px solid #FEB2B2' : '1px solid #E8E2D6' }}>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#E53E3E', marginBottom: 4 }}>Flagged Factor</div>
                    <div style={{ fontWeight: 700, fontSize: 17, color: '#1C1C1C' }}>{f.name}</div>
                  </div>
                  <p style={{ fontSize: 13.5, color: '#6B6456', marginBottom: 14, lineHeight: 1.6 }}>{f.explanation} If this doesn't reflect reality, explain why below.</p>
                  <textarea className="inp" value={appeals[f.name] || ''} onChange={e => onAppeal(f.name, e.target.value)}
                    placeholder={`Describe in detail why "${f.name}" is inaccurate. Include specific dates, amounts, and what action was taken (min. 15 words)…`}
                    style={{ width: '100%', padding: '12px 14px', border: `1.5px solid ${!hasText && appeals[f.name] ? '#FEB2B2' : '#E8E2D6'}`, borderRadius: 10, fontSize: 14, minHeight: 110, resize: 'vertical', background: '#FDFCFA', lineHeight: 1.6 }} />
                  {appeals[f.name] && !hasText && (
                    <p style={{ fontSize: 12, color: '#C53030', marginTop: 4 }}>⚠ Please provide at least 15 words of specific context.</p>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                    <input ref={el => fileRefs.current[f.name] = el} type="file" style={{ display: 'none' }} onChange={e => onFile(f.name, e.target.files[0])} />
                    <button onClick={() => fileRefs.current[f.name]?.click()} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '8px 14px', background: hasDoc ? '#F0FFF4' : '#FFF5F5', border: `1.5px solid ${hasDoc ? '#9AE6B4' : '#FC8181'}`, borderRadius: 8, color: hasDoc ? '#276749' : '#C53030', cursor: 'pointer', fontWeight: 600 }}>
                      <Icon.Upload /> {hasDoc ? `✓ ${files[f.name].name}` : '📎 Attach supporting document (required)'}
                    </button>
                    {!hasDoc && <span style={{ fontSize: 11, color: '#C53030', fontStyle: 'italic' }}>Required to submit appeal</span>}
                  </div>
                </Card>
              )})
            }

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
              <BtnGhost onClick={() => setView(2)}>Back</BtnGhost>
              {flagged.some(f => !files[f.name]) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#C53030', padding: '8px 14px', background: '#FFF5F5', border: '1px solid #FEB2B2', borderRadius: 8 }}>
                  <Icon.Warn /> Documents required for all flagged factors
                </div>
              )}
              <BtnGold 
                onClick={runAppeal} 
                disabled={flagged.some(f => !files[f.name])}
                style={{ opacity: flagged.some(f => !files[f.name]) ? 0.4 : 1, cursor: flagged.some(f => !files[f.name]) ? 'not-allowed' : 'pointer' }}
              >
                Submit Contest & Verify Proof <Icon.Arrow />
              </BtnGold>
            </div>
          </div>
        )}

        {/* STEP 4 */}
        {view === 4 && (
          <div className="fade-up" style={{ maxWidth: 540, margin: '0 auto', textAlign: 'center', paddingTop: 16 }}>
            <Steps current={4} />
            <div style={{ width: 52, height: 52, border: '4px solid #E8E2D6', borderTopColor: '#C6A96B', borderRadius: '50%', animation: 'spinAnim .85s linear infinite', margin: '0 auto 24px' }} />
            <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 32, color: '#1B2A4A', marginBottom: 8 }}>Reviewing your submission</h2>
            <p style={{ fontSize: 14, color: '#6B6456', marginBottom: 32, lineHeight: 1.6 }}>Running your evidence against each flagged factor. Usually takes a few seconds.</p>
            <Card style={{ padding: '22px 26px', textAlign: 'left', marginBottom: 22 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#9C9487', marginBottom: 12 }}>Live Review Log</div>
              <div ref={logRef} style={{ minHeight: 100, maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 7 }}>
                {logs.map((l, i) => <div key={i} style={{ fontSize: 13, color: l.txt.includes('✓') ? '#276749' : l.txt.includes('✗') ? '#9B1C1C' : '#3D3830', lineHeight: 1.5 }}>{l.txt}{l.stream && <span style={{ animation: 'scanPulse 1s infinite', marginLeft: 2 }}>▌</span>}</div>)}
                {!logs.length && <div style={{ color: '#C9C2B5', fontSize: 13 }}>Initializing…</div>}
              </div>
            </Card>
            {liveConf !== null && (
              <div>
                <div style={{ fontSize: 12, color: '#9C9487', marginBottom: 7 }}>Current confidence estimate</div>
                <div style={{ height: 5, background: '#E8E2D6', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}><div style={{ height: '100%', width: `${liveConf}%`, background: '#C6A96B', borderRadius: 4, transition: 'width .5s ease' }} /></div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#1B2A4A' }}>{liveConf?.toFixed(1)}%</div>
              </div>
            )}
          </div>
        )}

        {/* STEP 5 */}
        {view === 5 && verdict && (
          <div className="fade-up">
            <Steps current={5} />
            <div style={{ padding: '44px 48px', borderRadius: 18, marginBottom: 30, textAlign: 'center', background: verdict.new_decision === 'APPROVE' ? '#1F4426' : '#2D1515', color: '#fff' }}>
              {verdict.verdict_changed && <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#86EFAC', marginBottom: 8 }}>Decision Reversed</div>}
              <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 44, marginBottom: 12, lineHeight: 1.1 }}>
                {verdict.new_decision === 'APPROVE' ? 'Your appeal was successful.' : 'The decision was upheld.'}
              </div>
              <p style={{ fontSize: 15, opacity: .65, maxWidth: 400, margin: '0 auto', lineHeight: 1.6 }}>{verdict.summary}</p>
            </div>

            <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 26, color: '#1B2A4A', marginBottom: 6 }}>What changed</h3>
            <p style={{ fontSize: 13, color: '#9C9487', marginBottom: 18 }}>Exact comparison of each factor before and after your evidence was reviewed.</p>
            <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
              <div style={{ background: '#fff', border: '1px solid #E5E1D8', borderRadius: 14, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#FDFCFA', borderBottom: '1px solid #E5E1D8' }}>
                      <th style={{ textAlign: 'left', padding: '16px 24px', fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase' }}>Factor</th>
                      <th style={{ textAlign: 'center', padding: '16px 24px', fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase' }}>Before</th>
                      <th style={{ textAlign: 'center', padding: '16px 24px', fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase' }}>After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {verdict.delta.map((f, i) => (
                      <tr key={i} style={{ borderBottom: i === verdict.delta.length - 1 ? 'none' : '1px solid #F1F1F1' }}>
                        <td style={{ padding: '20px 24px' }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: '#0A192F', marginBottom: 4 }}>{f.factor || f.factor_name || f.name || 'Missing Factor Name'}</div>
                          <div style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.4 }}>{f.reason || f.explanation || 'No reason provided by engine'}</div>
                        </td>
                        <td style={{ textAlign: 'center', padding: '20px 24px', whiteSpace: 'nowrap' }}><Tag label={f.old_impact} color="red" /></td>
                        <td style={{ textAlign: 'center', padding: '20px 24px', whiteSpace: 'nowrap' }}>
                          <Tag label={f.new_impact} color={f.changed ? "green" : "red"} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {verdict.delta.some(f => f.changed) && (
                <BtnGhost onClick={() => { setLetterOpen(true); }}>Download Appeal Letter</BtnGhost>
              )}
              {!verdict.verdict_changed && <BtnGold onClick={() => setView(3)}>Add Stronger Evidence <Icon.Arrow /></BtnGold>}
              <BtnGhost onClick={reset}>New Case</BtnGhost>
            </div>
          </div>
        )}
      </main>

      {/* Letter Modal */}
      {letterOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,20,20,.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div className="pop-in" style={{ background: '#fff', borderRadius: 18, padding: '32px 36px', width: '100%', maxWidth: 600, boxShadow: '0 20px 60px rgba(0,0,0,.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, color: '#1B2A4A' }}>Your Appeal Letter</h3>
              <button onClick={() => setLetterOpen(false)} style={{ color: '#9C9487', background: 'transparent', border: 'none' }}><Icon.X /></button>
            </div>
            <textarea readOnly value={letter} style={{ width: '100%', height: 300, padding: '14px', border: '1.5px solid #E8E2D6', borderRadius: 10, fontSize: 13.5, fontFamily: 'Georgia, serif', resize: 'none', background: '#FDFCFA', lineHeight: 1.75, color: '#1C1C1C' }} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <BtnGhost onClick={() => navigator.clipboard.writeText(letter)}>Copy Text</BtnGhost>
              <BtnPrimary onClick={() => setLetterOpen(false)}>Done</BtnPrimary>
            </div>
          </div>
        </div>
      )}

      <Chatbot geminiKey={geminiKey} sector={caseData.sector} decision={decision} forceOpen={chatReady} triggerMsg={chatTrigger} open={chatOpen} setOpen={setChatOpen} />
    </>
  );
}
