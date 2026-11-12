import { Download, Trash2 } from "lucide-react";
import { Button, Dialog, DialogActions } from "../../ui/index.ts";
import { groupDigits } from "./format.ts";

/*
 * "Delete all transactions": asked once, with the way back offered first. The
 * export is a click away in the same dialog, and Undo in the toast afterwards
 * puts them back while the page is open.
 */

interface DeleteAllDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** How many are about to go. */
  count: number;
  pending?: boolean;
  onExport: () => void;
  onDelete: () => void;
}

export function DeleteAllDialog({
  isOpen,
  onOpenChange,
  count,
  pending = false,
  onExport,
  onDelete,
}: DeleteAllDialogProps) {
  const all =
    count === 1
      ? "your 1 transaction"
      : `all ${groupDigits(String(count))} transactions`;
  return (
    <Dialog
      title="Delete all transactions?"
      role="alertdialog"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      <p className="text-sm text-fg-muted">
        This deletes {all} from every device you use Keyworth on. Your portfolio
        starts empty. If you might want them back later, export them first.
      </p>
      <DialogActions>
        <Button
          variant="ghost"
          icon={<Download aria-hidden="true" />}
          className="sm:mr-auto"
          isDisabled={pending}
          onPress={onExport}
        >
          Export to CSV
        </Button>
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
          Delete all
        </Button>
      </DialogActions>
    </Dialog>
  );
}
