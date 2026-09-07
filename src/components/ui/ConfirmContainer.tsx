import { useEffect, useState } from 'react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { resolveConfirm, subscribeConfirm, type ConfirmRequest } from '@/lib/confirm';

export function ConfirmContainer() {
  const [request, setRequest] = useState<(ConfirmRequest & { resolve: (value: boolean) => void }) | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeConfirm(setRequest);
    return () => {
      unsubscribe();
    };
  }, []);

  if (!request) return null;

  return (
    <ConfirmModal
      open
      title={request.title}
      description={request.description}
      confirmLabel={request.confirmLabel}
      cancelLabel={request.cancelLabel}
      tone={request.tone}
      onConfirm={() => resolveConfirm(true)}
      onCancel={() => resolveConfirm(false)}
    />
  );
}
