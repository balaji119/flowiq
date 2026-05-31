import { CalendarRange, ClipboardCheck, Rocket, ShoppingCart } from 'lucide-react';
import { Button } from '@flowiq/ui';

type HomeLandingScreenProps = {
  onOpenDashboard: () => void;
  onCreateCampaign: () => void;
};

function WorkflowIllustration() {
  return (
    <div className="relative h-[280px] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#110f24]/92 p-4 backdrop-blur-xl sm:h-[300px] lg:h-[336px] xl:h-[360px]">
      <div className="absolute -left-14 -top-12 h-44 w-44 rounded-full bg-violet-500/14 blur-3xl" />
      <div className="absolute -right-14 bottom-0 h-52 w-52 rounded-full bg-violet-400/12 blur-3xl" />
      <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: 'linear-gradient(rgba(148,163,184,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.3) 1px, transparent 1px)', backgroundSize: '44px 44px' }} />
      <svg className="relative h-full w-full" fill="none" viewBox="0 0 620 320" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="nodeFill" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#1e163c" />
            <stop offset="100%" stopColor="#161231" />
          </linearGradient>
          <linearGradient id="flowLine" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--primary-500)" stopOpacity="0.72" />
          </linearGradient>
        </defs>

        <rect fill="url(#nodeFill)" height="78" rx="14" stroke="rgba(255,255,255,0.14)" width="138" x="24" y="34" />
        <text fill="#F9FAFB" fontFamily="Inter, Geist, sans-serif" fontSize="14" fontWeight="600" x="40" y="62">
          Asset Plan
        </text>
        <text fill="#9CA3AF" fontFamily="Inter, Geist, sans-serif" fontSize="11" x="40" y="84">
          Campaign inventory
        </text>
        <circle cx="132" cy="52" fill="var(--primary-500)" fillOpacity="0.32" r="8" />

        <rect fill="url(#nodeFill)" height="78" rx="14" stroke="rgba(255,255,255,0.14)" width="138" x="236" y="116" />
        <text fill="#F9FAFB" fontFamily="Inter, Geist, sans-serif" fontSize="14" fontWeight="600" x="252" y="144">
          Schedule
        </text>
        <text fill="#9CA3AF" fontFamily="Inter, Geist, sans-serif" fontSize="11" x="252" y="166">
          Campaign timeline
        </text>
        <circle cx="342" cy="134" fill="#38BDF8" fillOpacity="0.32" r="8" />

        <rect fill="url(#nodeFill)" height="78" rx="14" stroke="rgba(255,255,255,0.14)" width="162" x="434" y="198" />
        <text fill="#F9FAFB" fontFamily="Inter, Geist, sans-serif" fontSize="14" fontWeight="600" x="452" y="226">
          ADS Output
        </text>
        <text fill="#9CA3AF" fontFamily="Inter, Geist, sans-serif" fontSize="11" x="452" y="248">
          Quote-ready export
        </text>
        <circle cx="564" cy="216" fill="var(--primary-500)" fillOpacity="0.36" r="8" />

        <path d="M162 74 C214 74, 206 124, 236 134" stroke="url(#flowLine)" strokeWidth="2.4">
          <animate attributeName="stroke-dashoffset" dur="7s" from="28" repeatCount="indefinite" to="0" />
        </path>
        <path d="M374 156 C426 168, 430 214, 434 224" stroke="url(#flowLine)" strokeWidth="2.4">
          <animate attributeName="stroke-dashoffset" dur="7s" from="22" repeatCount="indefinite" to="0" />
        </path>

        <circle cx="90" cy="212" fill="#161231" r="46" stroke="rgba(255,255,255,0.1)" />
        <path d="M66 212 L90 188 L114 212 L90 236 Z" stroke="#38BDF8" strokeOpacity="0.75" strokeWidth="1.6" />
        <circle cx="90" cy="212" fill="var(--primary-500)" fillOpacity="0.18" r="12" />
        <text fill="#9CA3AF" fontFamily="Inter, Geist, sans-serif" fontSize="10" x="52" y="272">
          Market map
        </text>
      </svg>
    </div>
  );
}

export function HomeLandingScreen({ onOpenDashboard, onCreateCampaign }: HomeLandingScreenProps) {
  return (
    <main className="relative min-h-full overflow-hidden bg-[#081120]">
      <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'radial-gradient(circle at 78% 8%, rgba(105, 53, 228,0.55), transparent 36%), radial-gradient(circle at 14% 88%, rgba(56,189,248,0.45), transparent 34%)' }} />
      <div className="pointer-events-none absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'linear-gradient(rgba(148,163,184,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.3) 1px, transparent 1px)', backgroundSize: '52px 52px' }} />
      <section className="relative mx-auto flex min-h-[calc(100vh-4px)] w-full max-w-[clamp(1100px,78vw,1600px)] flex-col justify-center gap-6 px-5 py-10 sm:px-7 lg:px-10 xl:py-12">
        <div className="relative overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[#161231]/82 p-6 shadow-[0_24px_70px_rgba(2,6,23,0.42)] backdrop-blur-xl sm:p-7 xl:p-8">
          <div className="absolute -left-24 -top-20 h-64 w-64 rounded-full bg-violet-500/16 blur-3xl" />
          <div className="absolute -right-24 -bottom-24 h-72 w-72 rounded-full bg-violet-400/12 blur-3xl" />
          <div className="relative grid min-h-[360px] gap-6 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,1.18fr)] lg:items-center xl:min-h-[410px] xl:gap-10">
            <div className="max-w-xl">
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">POWERED BY ADS</p>
              <h1 className="mt-2 text-[36px] font-semibold leading-tight tracking-tight text-[#F9FAFB] md:text-[42px] xl:text-[48px]">
                Plan Outdoor Campaigns Faster
              </h1>
              <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-[#9CA3AF] xl:text-[16px]">
                Build schedules, review poster quantities, and generate ADS-ready quotes.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button
                  className="h-10 px-5 btn-theme-primary"
                  onClick={onCreateCampaign}
                  type="button"
                >
                  Create Campaign
                </Button>
                <Button className="h-10 border border-white/10 bg-[#15122b] px-5 text-[#F9FAFB] transition hover:-translate-y-[1px] hover:border-white/20 hover:bg-[#111d30]" onClick={onOpenDashboard} type="button" variant="secondary">
                  Open Dashboard
                </Button>
              </div>
            </div>

            <WorkflowIllustration />
          </div>
        </div>

        <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#161231]/74 px-4 py-4 backdrop-blur-xl md:px-6">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] sm:items-center sm:gap-4 xl:gap-6">
            {[
              { icon: CalendarRange, title: 'Schedule', subtitle: 'Plan weekly slots' },
              { icon: ClipboardCheck, title: 'Review', subtitle: 'Validate quantities' },
              { icon: Rocket, title: 'Export', subtitle: 'Prepare campaign outputs' },
              { icon: ShoppingCart, title: 'ADS', subtitle: 'Place Order' },
            ].map((item, index, all) => (
              <div key={item.title} className="contents">
                <div className="rounded-lg border border-white/10 bg-[#0E1627]/90 px-3 py-2.5 xl:px-4">
                  <div className="flex items-center gap-2">
                    <item.icon className="h-4 w-4 text-violet-300" />
                    <p className="text-sm font-semibold text-[#F9FAFB]">{item.title}</p>
                  </div>
                  <p className="mt-1 text-xs text-[#9CA3AF]">{item.subtitle}</p>
                </div>
                {index < all.length - 1 ? (
                  <div className="hidden h-px w-8 bg-gradient-to-r from-white/10 via-slate-300/20 to-violet-400/45 sm:block xl:w-12">
                    <div className="h-full w-1/2 animate-pulse bg-gradient-to-r from-transparent to-violet-300/45" />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
