import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "../../ui/index.ts";
import { Section } from "../settings/Section.tsx";
import { DeleteAllChatsDialog } from "./DeleteAllChatsDialog.tsx";
import { useChats, useDeleteChats } from "./useChats.ts";

/** Settings, Chats: "Delete all chats", asked once, Undo in the toast afterwards. */
export function DeleteAllChats({ userId }: { userId: string }) {
  const chats = useChats(userId);
  const { removeAll } = useDeleteChats(userId);
  const [isOpen, setIsOpen] = useState(false);
  const count = chats?.length ?? 0;
  return (
    <Section
      title="Chats"
      description={
        count === 0
          ? "No chats yet."
          : `Encrypted on this device, like your transactions. ${count === 1 ? "1 chat" : `${String(count)} chats`}.`
      }
    >
      <Button
        icon={<Trash2 aria-hidden="true" />}
        isDisabled={count === 0}
        onPress={() => {
          setIsOpen(true);
        }}
      >
        Delete all chats
      </Button>
      <DeleteAllChatsDialog
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        count={count}
        onDelete={() => {
          setIsOpen(false);
          removeAll(count);
        }}
      />
    </Section>
  );
}
