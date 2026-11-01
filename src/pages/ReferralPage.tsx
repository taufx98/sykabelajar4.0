import { ReferralProgramPanel } from '@/components/referrals/ReferralProgramPanel';

export function ReferralPage() {
  return (
    <div className="min-h-screen bg-[#F8FAFC] px-4 py-5 dark:bg-[#0B1120] md:px-6 md:py-7">
      <div className="mx-auto max-w-7xl">
        <ReferralProgramPanel />
      </div>
    </div>
  );
}
