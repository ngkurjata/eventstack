"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ShareRedirectClient({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [to, router]);

  return null;
}
