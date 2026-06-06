import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import Callout from '../components/Callout.jsx';

const toHex = (n) => (typeof n === 'number' ? '#' + (n & 0xffffff).toString(16).padStart(6, '0') : '#5865f2');

// Same template the Welcome page exposes — keep them in sync.
const WELCOME_CARD = {
  author: { name: '{server}' },
  title: 'Welcome, {displayname}!',
  description: 'Glad to have you here, {user}. Make yourself at home — check the rules channel and grab some roles to get started.',
  thumbnail: '{avatar}',
  footer: { text: 'Member #{membercount}' },
};

const STEPS = [
  { id: 'welcome',    title: 'Welcome' },
  { id: 'personalize', title: 'Personalize' },
  { id: 'welcome-msg', title: 'Welcome members' },
  { id: 'autorole',   title: 'Auto-role' },
  { id: 'verify',     title: 'Verification gate' },
  { id: 'done',       title: 'All set' },
];

function StepShell({ step, title, hint, children, onBack, onSkip, onNext, nextLabel = 'Save & continue', busy }) {
  return (
    <section className="card wizard-step">
      <div className="wizard-progress">
        {STEPS.map((s, i) => (
          <div key={s.id} className={`wizard-pip${i === step ? ' active' : ''}${i < step ? ' done' : ''}`} title={s.title} />
        ))}
        <span className="wizard-counter muted">Step {step + 1} of {STEPS.length}</span>
      </div>
      <h2 style={{ margin: '12px 0 6px' }}>{title}</h2>
      {hint && <p className="muted" style={{ marginBottom: 14 }}>{hint}</p>}
      {children}
      <div className="actions wizard-nav">
        {step > 0 && <button className="link" onClick={onBack} disabled={busy}>← Back</button>}
        {onSkip && <button className="link" onClick={onSkip} disabled={busy}>Skip this step</button>}
        {onNext && <button className="btn" onClick={onNext} disabled={busy}>{nextLabel}</button>}
      </div>
    </section>
  );
}

export default function SetupWizard() {
  const [step, setStep] = useState(0);
  const [guild, setGuild] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [personalizer, setPersonalizer] = useState(null);
  const [verification, setVerification] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    Promise.all([api.guild(), api.getConfig(), api.getPersonalizer(), api.getVerification()])
      .then(([g, c, p, v]) => { setGuild(g); setCfg(c); setPersonalizer(p); setVerification(v); })
      .catch((e) => setStatus(e.message));
  }, []);
  if (!guild || !cfg || !personalizer || !verification) return <div className="muted page">{status || 'Loading…'}</div>;

  const back = () => { setStatus(''); setStep((s) => Math.max(0, s - 1)); };
  const advance = () => { setStatus(''); setStep((s) => Math.min(STEPS.length - 1, s + 1)); };
  const skip = () => { setStatus('Skipped — you can come back to this later from the sidebar.'); advance(); };

  const savePersonalizer = async () => {
    setBusy(true); setStatus('Saving…');
    try { setPersonalizer(await api.savePersonalizer({ bot_nickname: personalizer.bot_nickname || null, embed_color: personalizer.embed_color })); advance(); }
    catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); } finally { setBusy(false); }
  };

  const saveWelcome = async () => {
    if (!cfg.welcome_channel_id) return setStatus('Pick a channel (or use Skip).');
    setBusy(true); setStatus('Saving…');
    try {
      const saved = await api.saveConfig({
        welcome_channel_id: cfg.welcome_channel_id,
        welcome_message: cfg.welcome_message || null,
        welcome_embed: cfg.welcome_embed || WELCOME_CARD,
      });
      setCfg({ ...cfg, ...saved });
      advance();
    } catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); } finally { setBusy(false); }
  };

  const sendTestWelcome = async () => {
    setBusy(true); setStatus('Saving + sending test…');
    try {
      await api.saveConfig({
        welcome_channel_id: cfg.welcome_channel_id,
        welcome_message: cfg.welcome_message || null,
        welcome_embed: cfg.welcome_embed || WELCOME_CARD,
      });
      await api.testWelcome('welcome');
      setStatus('Test welcome sent to that channel ✓');
    } catch (e) { setStatus('Test failed: ' + (e.body?.detail || e.body?.error || e.message)); } finally { setBusy(false); }
  };

  const saveAutorole = async () => {
    setBusy(true); setStatus('Saving…');
    try {
      const saved = await api.saveConfig({ autorole_id: cfg.autorole_id || null });
      setCfg({ ...cfg, ...saved });
      advance();
    } catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); } finally { setBusy(false); }
  };

  const saveVerification = async () => {
    if (!verification.channel_id || !verification.role_id) return setStatus('Pick a channel and the role to grant — or hit Skip.');
    setBusy(true); setStatus('Saving + posting verify panel…');
    try {
      await api.saveVerification({ ...verification, enabled: true });
      await api.postVerification();
      setStatus('Verify panel posted ✓');
      advance();
    } catch (e) { setStatus('Failed: ' + (e.body?.error || e.message)); } finally { setBusy(false); }
  };

  return (
    <div className="page">
      <PageHeader title="Setup Wizard" sub="A quick guided walk through the essentials. Skip anything you don’t want — you can come back to every step later from the sidebar.">
        <span className="status">{status}</span>
      </PageHeader>

      {step === 0 && (
        <StepShell step={step} title={`Hi — let’s set up ${guild.name}.`}
          hint="This takes 3–5 minutes. We’ll wire up the bot’s identity, the welcome flow, an auto-role on join, and an optional verification gate. Hit Skip on anything you’re not ready for; nothing is destructive."
          onNext={advance} nextLabel="Let’s go →" busy={busy}>
          <Callout type="tip">
            Full configuration for every feature lives in the sidebar — this wizard just gets the basics in place. After it’s done, you can keep tweaking from <Link className="link" to="/setup">Setup Guide</Link> and the individual tabs.
          </Callout>
        </StepShell>
      )}

      {step === 1 && (
        <StepShell step={step} title="Personalize"
          hint="A per-server nickname and an accent color that paints every embed the bot generates. Both are optional and stay isolated to this server."
          onBack={back} onSkip={skip} onNext={savePersonalizer} busy={busy}>
          <label>Bot nickname (this server)
            <input value={personalizer.bot_nickname || ''} maxLength={32} placeholder="Leave blank to use the bot’s default name"
              onChange={(e) => setPersonalizer({ ...personalizer, bot_nickname: e.target.value })} />
          </label>
          <label>Embed accent color
            <input type="color" value={toHex(personalizer.embed_color)}
              onChange={(e) => setPersonalizer({ ...personalizer, embed_color: parseInt(e.target.value.slice(1), 16) })} />
          </label>
        </StepShell>
      )}

      {step === 2 && (
        <StepShell step={step} title="Welcome new members"
          hint="A channel where the bot posts a welcome card when someone joins, with their avatar + a friendly greeting. Pick a channel and we’ll drop in a template you can customize later."
          onBack={back} onSkip={skip} onNext={saveWelcome} busy={busy}>
          <label>Welcome channel
            <select value={cfg.welcome_channel_id || ''} onChange={(e) => setCfg({ ...cfg, welcome_channel_id: e.target.value || null })}>
              <option value="">— pick a channel —</option>
              {guild.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </label>
          <Callout type="tip">
            We’ll use a default welcome-card template. The card includes the joining member’s avatar, an @mention, and a member-count footer. You can fully customize it later from the <Link className="link" to="/welcome">Welcome &amp; Roles</Link> tab.
          </Callout>
          {cfg.welcome_channel_id && (
            <div className="actions">
              <button className="link" onClick={sendTestWelcome} disabled={busy}>Send a test welcome to that channel</button>
            </div>
          )}
        </StepShell>
      )}

      {step === 3 && (
        <StepShell step={step} title="Auto-role on join"
          hint="A role the bot automatically grants every member when they join. Useful for an Applicant or Newbie role that gates access until they verify. Pick none to skip."
          onBack={back} onSkip={skip} onNext={saveAutorole} busy={busy}>
          <label>Role granted on join
            <select value={cfg.autorole_id || ''} onChange={(e) => setCfg({ ...cfg, autorole_id: e.target.value || null })}>
              <option value="">— none —</option>
              {guild.roles.map((r) => (
                <option key={r.id} value={r.id} disabled={!r.assignable}>
                  {r.name}{r.assignable ? '' : ' (above bot — can’t assign)'}
                </option>
              ))}
            </select>
          </label>
        </StepShell>
      )}

      {step === 4 && (
        <StepShell step={step} title="Verification gate (optional)"
          hint="A one-click verify button in a public channel that grants a member role. Pair it with channel permissions so unverified joiners only see the verify channel. Skip if you don’t want a gate."
          onBack={back} onSkip={skip} onNext={saveVerification} busy={busy} nextLabel="Save & post panel">
          <div className="row2">
            <label>Verify channel
              <select value={verification.channel_id || ''} onChange={(e) => setVerification({ ...verification, channel_id: e.target.value || null })}>
                <option value="">— choose —</option>
                {guild.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
            </label>
            <label>Role granted on verify
              <select value={verification.role_id || ''} onChange={(e) => setVerification({ ...verification, role_id: e.target.value || null })}>
                <option value="">— choose —</option>
                {guild.roles.map((r) => (
                  <option key={r.id} value={r.id} disabled={!r.assignable}>{r.name}{r.assignable ? '' : ' (above bot)'}</option>
                ))}
              </select>
            </label>
          </div>
          <label>Button label<input value={verification.button_label || 'Verify'} onChange={(e) => setVerification({ ...verification, button_label: e.target.value })} /></label>
          <Callout type="tip">
            Saving here also posts the verify panel to that channel — clicking <b>Save &amp; post panel</b> sends a message right away.
          </Callout>
        </StepShell>
      )}

      {step === 5 && (
        <StepShell step={step} title="You’re set up 🎉"
          hint="That’s the essentials. Below are quick links to the features we didn’t cover in the wizard — wire them up whenever you’re ready."
          onBack={back}>
          <ul className="setup-list">
            <li><Link className="link" to="/onboarding">Onboarding</Link> — a guided welcome tour for new joiners</li>
            <li><Link className="link" to="/rolemenus">Reaction Roles</Link> — self-assign role menus</li>
            <li><Link className="link" to="/tickets">Tickets</Link> — private support channels</li>
            <li><Link className="link" to="/events">Mission Events</Link> — sign-up sheets from your .miz</li>
            <li><Link className="link" to="/dcs">DCS Server</Link> — live status + kill feed + bomb scoring</li>
            <li><Link className="link" to="/roster">Roster</Link> — pilot callsigns + qualifications</li>
            <li><Link className="link" to="/automod">Auto-moderation</Link> — spam / mass-mention / link filters</li>
          </ul>
          <Callout>
            Need to re-run the wizard? It’s always linked from the top of the <Link className="link" to="/setup">Setup Guide</Link>. None of these settings are locked in — change anything from its tab at any time.
          </Callout>
        </StepShell>
      )}
    </div>
  );
}
