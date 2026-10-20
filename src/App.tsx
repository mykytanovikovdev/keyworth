import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { createAppRouter } from "./routes/router.tsx";
import { Toaster, UIProvider } from "./ui/index.ts";

const queryClient = new QueryClient();
const router = createAppRouter(queryClient);

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
