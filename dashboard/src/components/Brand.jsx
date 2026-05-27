import { useState } from 'react';

// Shows the DCS:OPT logo image (dashboard/public/logo.png) and falls back to
// styled text until that file exists. variant: 'hero' (landing), 'lg'
// (login/picker) or 'sm' (sidebar / landing nav).
export default function Brand({ variant = 'lg' }) {
  const [imgOk, setImgOk] = useState(true);

  if (imgOk) {
    return <img className={`brand-logo brand-logo-${variant}`} src="/logo.png" alt="DCS:OPT" onError={() => setImgOk(false)} />;
  }
  return (
    <div className="opt-fallback">
      <div className={`brand opt-brand ${variant === 'sm' ? '' : 'big'}`}>DCS<span>:OPT</span></div>
      {variant !== 'sm' && <div className="opt-tagline">Operational Planning Tool</div>}
    </div>
  );
}
