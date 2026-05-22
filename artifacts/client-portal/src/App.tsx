import { useEffect, useMemo, useRef } from "react";
import {
  ClerkProvider,
  SignIn,
  SignUp,
  Show,
  useClerk,
  useUser,
} from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { dark } from "@clerk/themes";
import {
  Switch,
  Route,
  Redirect,
  useLocation,
  Router as WouterRouter,
} from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider, useTheme } from "@/components/ThemeProvider";
import { themeLogoSources } from "@/components/ThemeLogo";
import LandingPage from "@/pages/LandingPage";
import ClientPortalPage from "@/pages/ClientPortalPage";
import AdminDashboardPage from "@/pages/AdminDashboardPage";
import AdminClientDetailPage from "@/pages/AdminClientDetailPage";
import NotFound from "@/pages/not-found";

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

function buildClerkAppearance(theme: "light" | "dark") {
  const isDark = theme === "dark";
  const logoUrl = `${window.location.origin}${
    isDark ? themeLogoSources.dark : themeLogoSources.light
  }`;

  return {
    baseTheme: isDark ? dark : undefined,
    cssLayerName: "clerk",
    options: {
      logoPlacement: "inside" as const,
      logoLinkUrl: basePath || "/",
      logoImageUrl: logoUrl,
    },
    variables: {
      colorPrimary: "#0500FF",
      colorForeground: isDark ? "#F5F6FA" : "#0E1116",
      colorMutedForeground: isDark ? "#9098A8" : "#5F6577",
      colorDanger: isDark ? "#FF5470" : "#E11D48",
      colorBackground: isDark ? "#0A0B10" : "#FFFFFF",
      colorInput: isDark ? "#13151D" : "#FFFFFF",
      colorInputForeground: isDark ? "#F5F6FA" : "#0E1116",
      colorNeutral: isDark ? "#262833" : "#0E1116",
      fontFamily: "var(--app-font-sans)",
      borderRadius: "0.625rem",
    },
    elements: {
      rootBox: "w-full flex justify-center",
      cardBox:
        "bg-card border border-border rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl",
      card: "!shadow-none !border-0 !bg-transparent !rounded-none",
      footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
      headerTitle: "text-foreground text-2xl font-semibold tracking-tight",
      headerSubtitle: "text-muted-foreground text-sm",
      socialButtonsBlockButtonText: "text-foreground font-medium",
      formFieldLabel: "text-foreground text-sm",
      footerActionLink: "text-primary hover:opacity-80",
      footerActionText: "text-muted-foreground",
      dividerText: "text-muted-foreground",
      formButtonPrimary:
        "bg-primary hover:opacity-90 text-primary-foreground font-medium",
      formFieldInput:
        "bg-background border border-input text-foreground focus:border-primary",
      socialButtonsBlockButton:
        "bg-background border border-input hover:bg-muted",
      logoBox: "mx-auto",
      logoImage: "h-9 w-auto",
    },
  };
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/admin" />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  return <>{children}</>;
}

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
      />
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  const { theme } = useTheme();
  const appearance = useMemo(() => buildClerkAppearance(theme), [theme]);

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={appearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route path="/checklist" component={ClientPortalPage} />
            <Route path="/admin">
              <RequireAdmin>
                <AdminDashboardPage />
              </RequireAdmin>
            </Route>
            <Route path="/admin/clients/:clientId">
              {(params) => (
                <RequireAdmin>
                  <AdminClientDetailPage clientId={params.clientId} />
                </RequireAdmin>
              )}
            </Route>
            <Route component={NotFound} />
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
      </WouterRouter>
    </ThemeProvider>
  );
}

export default App;
