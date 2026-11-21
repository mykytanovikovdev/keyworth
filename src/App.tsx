import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { chatSession } from "./features/chat/chat-session.ts";
import { createAppRouter } from "./routes/router.tsx";
import { Toaster, UIProvider } from "./ui/index.ts";
import { vault } from "./vault/index.ts";

const queryClient = new QueryClient();
const router = createAppRouter(queryClient);

// Decrypted data is kept only while the data key is open (["vault", …]
// queries, and the chat's conversation, which holds numbers from them).
vault.subscribe(() => {
  if (vault.getState().status !== "unlocked") {
    queryClient.removeQueries({ queryKey: ["vault"] });
    chatSession.startOver();
  }
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <UIProvider
        navigate={(href) => {
          void router.navigate({ href });
        }}
      >
        <RouterProvider router={router} />
        <Toaster />
      </UIProvider>
    </QueryClientProvider>
  );
}
