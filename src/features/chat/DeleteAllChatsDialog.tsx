import { Trash2 } from "lucide-react";
import { Button, Dialog, DialogActions } from "../../ui/index.ts";

/*
 * "Delete all chats": asked once. Undo in the toast afterwards puts them back
 * while the page is open, as with transactions.
 */

interface DeleteAllChatsDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  count: number;
  pending?: boolean;
  onDelete: () => void;
}

export function DeleteAllChatsDialog({
  isOpen,
  onOpenChange,
  count,
  pending = false,
  onDelete,
}: DeleteAllChatsDialogProps) {
  const all = count === 1 ? "your 1 chat" : `all ${String(count)} chats`;
  return (
    <Dialog
      title="Delete all chats?"
      role="alertdialog"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      <p className="text-sm text-fg-muted">
        This deletes {all} from every device you use Keyworth on. Your portfolio
        and transactions stay as they are.
      </p>
      <DialogActions>
        <Button
          variant="secondary"
          isDisabled={pending}
          onPress={() => {
            onOpenChange(false);
          }}
        >
          Cancel
        </Button>
        <Button
          variant="danger"
          icon={<Trash2 aria-hidden="true" />}
          isPending={pending}
          onPress={onDelete}
        >
          Delete all chats
        </Button>
      </DialogActions>
    </Dialog>
  );
}
