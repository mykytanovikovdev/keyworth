import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "../../ui/index.ts";
import { DeleteAllChatsDialog } from "./DeleteAllChatsDialog.tsx";
import { useChats, useDeleteChats } from "./useChats.ts";

/** "Delete all chats" in Settings: asked once, Undo in the toast afterwards. */
export function DeleteAllChats({ userId }: { userId: string }) {
  const chats = useChats(userId);
  const { removeAll } = useDeleteChats(userId);
  const [isOpen, setIsOpen] = useState(false);
  const count = chats?.length ?? 0;
  return (
    <>
      <Button
        icon={<Trash2 aria-hidden="true" />}
        isDisabled={count === 0}
        onPress={() => {
          setIsOpen(true);
        }}
      >
        Delete all chats…
      </Button>
      <DeleteAllChatsDialog
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        count={count}
        onDelete={() => {
          setIsOpen(false);
          removeAll();
        }}
      />
    </>
  );
}
