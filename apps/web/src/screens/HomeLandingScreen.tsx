import { ArrowRight, LayoutDashboard, PlusCircle } from 'lucide-react';
import { Button } from '@flowiq/ui';

type HomeLandingScreenProps = {
  onOpenDashboard: () => void;
  onCreateCampaign: () => void;
};

const domainImages = [
  'https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1400&q=80',
  'https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=1400&q=80',
  'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1400&q=80',
];

export function HomeLandingScreen({ onOpenDashboard, onCreateCampaign }: HomeLandingScreenProps) {
  return (
    <main className="h-full overflow-auto">
      <section className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950/70 p-7">
          <div className="absolute -right-14 -top-20 h-56 w-56 rounded-full bg-orange-400/20 blur-3xl" />
          <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="relative z-10">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-300/70">Powered by ADS</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Turn Hours into Minutes</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-300 sm:text-base">
              ADSconnect reduces order processing from hours to minutes - directly integrated with REV360 for faster campaign delivery.
            </p>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.24em] text-orange-200">ADS Connect</p>
            <h2 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Plan Outdoor Campaigns Faster With Clear Creative Mapping
            </h2>
            <p className="mt-3 max-w-2xl text-sm text-slate-300 sm:text-base">
              Build campaign schedules, map creatives, and generate download-ready visuals for print and installation workflows.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button className="h-10 px-5" onClick={onOpenDashboard} type="button" variant="secondary">
                <LayoutDashboard className="h-4 w-4" />
                Go to Dashboard
              </Button>
              <Button className="h-10 border-orange-400/40 bg-orange-500 px-5 text-white hover:bg-orange-400" onClick={onCreateCampaign} type="button">
                <PlusCircle className="h-4 w-4" />
                Create New Campaign
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {domainImages.map((src, index) => (
            <div key={`home-domain-image-${index + 1}`} className="group relative overflow-hidden rounded-xl border border-white/10 bg-slate-900/60">
              <img
                alt={`Campaign planning visual ${index + 1}`}
                className="h-52 w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                loading="lazy"
                src={src}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-900/10 to-transparent" />
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-900/55 p-5">
          <button
            className="inline-flex items-center gap-2 text-sm font-semibold text-orange-200 transition hover:text-orange-100"
            onClick={onOpenDashboard}
            type="button"
          >
            Continue to Campaign Dashboard
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </section>
    </main>
  );
}
