import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRedeemMagicLink, getGetClientSessionQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, LockKeyhole } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ThemeLogo } from "@/components/ThemeLogo";

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redeemMagicLink = useRedeemMagicLink();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("t");

    if (token) {
      setIsVerifying(true);
      redeemMagicLink.mutate(
        { data: { token } },
        {
          onSuccess: (data) => {
            queryClient.setQueryData(getGetClientSessionQueryKey(), data);
            setLocation("/checklist");
          },
          onError: () => {
            setIsVerifying(false);
            setError("This link is invalid or has expired.");
          },
        }
      );
    }
  }, [setLocation, queryClient, redeemMagicLink.mutate]);

  if (isVerifying) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <h1 className="text-xl font-semibold tracking-tight">Verifying secure link...</h1>
          <p className="text-sm text-muted-foreground">Please wait while we access your portal.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center bg-background px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="mb-8">
        <ThemeLogo className="h-8 w-auto" />
      </div>
      <Card className="w-full max-w-md bg-card/50 backdrop-blur-xl border-border shadow-2xl">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <LockKeyhole className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl font-semibold tracking-tight">Private Client Portal</CardTitle>
          <CardDescription className="text-base mt-2">
            {error || "Please use the secure link sent by your CPA to access your documents."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center pt-6 pb-8">
          <Button
            variant="outline"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setLocation("/sign-in")}
          >
            Admin Sign In
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
