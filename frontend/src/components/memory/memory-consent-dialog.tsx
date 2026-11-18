import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useMemory } from '@/hooks/use-memory';

export function MemoryConsentDialog({ visible, accountID, onClose }: { visible: boolean; accountID: string | null; onClose: () => void }) {
  const { accountID: currentAccount, busy, error, setEnabled } = useMemory();
  return (
    <ConfirmDialog
      visible={visible && !!currentAccount && currentAccount === accountID}
      title="Allow personal memory?"
      message={`PADI will save only facts you explicitly approve to your account. Relevant active memories may be sent to the AI service to personalise replies. You can review, correct, pause, delete, or turn memory off at any time.${error ? `\n\n${error}` : ''}`}
      confirmTitle="Allow memory"
      cancelTitle="Not now"
      busy={busy}
      onCancel={onClose}
      onConfirm={async () => { if (await setEnabled(true)) onClose(); }}
    />
  );
}
