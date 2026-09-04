import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { AdminChatConsolePage } from './AdminChatConsolePage';
import { ChatSpamPolicySettings } from '@/components/chat/ChatSpamPolicySettings';

export function AdminChatConsolePageV2() {
  const [showSpamSettings, setShowSpamSettings] = useState(false);

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex max-w-7xl items-center justify-end px-4 pt-3 md:px-6">
        <Button
          size="sm"
          variant={showSpamSettings ? 'outline' : 'subtle'}
          icon={<ShieldAlert size={14} />}
          onClick={() => setShowSpamSettings(value => !value)}
        >
          {showSpamSettings ? 'Tutup Pengaturan Anti-Spam' : 'Pengaturan Anti-Spam'}
        </Button>
      </div>
      {showSpamSettings && (
        <div className="mx-auto max-w-7xl px-4 pb-2 pt-3 md:px-6">
          <ChatSpamPolicySettings />
        </div>
      )}
      <AdminChatConsolePage />
    </div>
  );
}
