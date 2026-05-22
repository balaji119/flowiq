import { CalendarRange, ClipboardCheck, Printer, Rocket } from 'lucide-react';
import { Button } from '@flowiq/ui';

type HomeLandingScreenProps = {
  onOpenDashboard: () => void;
  onCreateCampaign: () => void;
};

function WorkflowIllustration() {
  return (
    <div className="relative h-[260px] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0C1424]/90 p-4 backdrop-blur-xl">
      <div className="absolute -left-14 -top-12 h-40 w-40 rounded-full bg-orange-500/12 blur-3xl" />
      <div className="absolute -right-14 bottom-0 h-44 w-44 rounded-full bg-cyan-400/10 blur-3xl" />
      <svg className="relative h-full w-full" fill="none" viewBox="0 0 620 320" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="nodeFill" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#142238" />
            <stop offset="100%" stopColor="#101827" />
          </linearGradient>
          <linearGradient id="flowLine" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#F97316" stopOpacity="0.72" />
          </linearGradient>
        </defs>

        <rect fill="url(#nodeFill)" height="78" rx="14" stroke="rgba(255,255,255,0.14)" width="138" x="24" y="34" />
        <text fill="#F9FAFB" fontFamily="Inter, Geist, sans-serif" fontSize="14" fontWeight="600" x="40" y="62">
          Asset Plan
        </text>
        <text fill="#9CA3AF" fontFamily="Inter, Geist, sans-serif" fontSize="11" x="40" y="84">
          Billboard nodes
        </text>
        <circle cx="132" cy="52" fill="#F97316" fillOpacity="0.32" r="8" />

        <rect fill="url(#nodeFill)" height="78" rx="14" stroke="rgba(255,255,255,0.14)" width="138" x="236" y="116" />
        <text fill="#F9FAFB" fontFamily="Inter, Geist, sans-serif" fontSize="14" fontWeight="600" x="252" y="144">
          Schedule
        </text>
        <text fill="#9CA3AF" fontFamily="Inter, Geist, sans-serif" fontSize="11" x="252" y="166">
          Week allocations
        </text>
        <circle cx="342" cy="134" fill="#38BDF8" fillOpacity="0.32" r="8" />

        <rect fill="url(#nodeFill)" height="78" rx="14" stroke="rgba(255,255,255,0.14)" width="162" x="434" y="198" />
        <text fill="#F9FAFB" fontFamily="Inter, Geist, sans-serif" fontSize="14" fontWeight="600" x="452" y="226">
          PrintIQ Output
        </text>
        <text fill="#9CA3AF" fontFamily="Inter, Geist, sans-serif" fontSize="11" x="452" y="248">
          Quote-ready export
        </text>
        <circle cx="564" cy="216" fill="#F97316" fillOpacity="0.36" r="8" />

        <path d="M162 74 C214 74, 206 124, 236 134" stroke="url(#flowLine)" strokeWidth="2.4" />
        <path d="M374 156 C426 168, 430 214, 434 224" stroke="url(#flowLine)" strokeWidth="2.4" />

        <circle cx="90" cy="212" fill="#101827" r="46" stroke="rgba(255,255,255,0.1)" />
        <path d="M66 212 L90 188 L114 212 L90 236 Z" stroke="#38BDF8" strokeOpacity="0.75" strokeWidth="1.6" />
        <circle cx="90" cy="212" fill="#F97316" fillOpacity="0.18" r="12" />
        <text fill="#9CA3AF" fontFamily="Inter, Geist, sans-serif" fontSize="10" x="52" y="272">
          Market map
        </text>
      </svg>
    </div>
  );
}

export function HomeLandingScreen({ onOpenDashboard, onCreateCampaign }: HomeLandingScreenProps) {
  return (
    <main className="min-h-full bg-[#081120]">
      <section className="mx-auto flex w-full max-w-[1220px] flex-col gap-5 px-5 py-8 sm:px-7 lg:px-10">
        <div className="relative overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[#101827]/82 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.35)] backdrop-blur-xl md:p-6">
          <div className="absolute -left-24 -top-20 h-56 w-56 rounded-full bg-orange-500/16 blur-3xl" />
          <div className="absolute -right-24 -bottom-24 h-64 w-64 rounded-full bg-sky-400/12 blur-3xl" />
          <div className="relative grid min-h-[300px] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] lg:items-center">
            <div className="max-w-xl">
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">POWERED BY ADS</p>
              <h1 className="mt-2 text-[36px] font-semibold leading-tight tracking-tight text-[#F9FAFB] md:text-[42px]">
                Plan Outdoor Campaigns Faster
              </h1>
              <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-[#9CA3AF]">
                Build schedules, review poster quantities, and generate PrintIQ-ready quotes.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button
                  className="h-10 border border-orange-400/45 bg-[#F97316] px-5 text-white shadow-[0_8px_24px_rgba(249,115,22,0.32)] transition hover:brightness-110"
                  onClick={onCreateCampaign}
                  type="button"
                >
                  Create Campaign
                </Button>
                <Button className="h-10 border border-white/10 bg-[#0D1728] px-5 text-[#F9FAFB] transition hover:border-white/20 hover:bg-[#111d30]" onClick={onOpenDashboard} type="button" variant="secondary">
                  Open Dashboard
                </Button>
              </div>
            </div>

            <WorkflowIllustration />
          </div>
        </div>

        <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#101827]/74 px-4 py-3 backdrop-blur-xl md:px-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] sm:items-center">
            {[
              { icon: CalendarRange, title: 'Schedule', subtitle: 'Plan weekly slots' },
              { icon: ClipboardCheck, title: 'Review', subtitle: 'Validate quantities' },
              { icon: Rocket, title: 'Finalise', subtitle: 'Lock campaign workflow' },
              { icon: Printer, title: 'PrintIQ', subtitle: 'Generate quote outputs' },
            ].map((item, index, all) => (
              <div key={item.title} className="contents">
                <div className="rounded-lg border border-white/10 bg-[#0E1627]/90 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <item.icon className="h-4 w-4 text-orange-300" />
                    <p className="text-sm font-semibold text-[#F9FAFB]">{item.title}</p>
                  </div>
                  <p className="mt-1 text-xs text-[#9CA3AF]">{item.subtitle}</p>
                </div>
                {index < all.length - 1 ? (
                  <div className="hidden h-px w-8 bg-gradient-to-r from-white/10 to-orange-400/45 sm:block" />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
