import { notFound, redirect } from "next/navigation";
import { getSharedTrip } from "@/lib/trips/shareStore";

export default async function ShareTripByIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const cleanId = String(id || "").trim();

  if (!cleanId) {
    notFound();
  }

  const doc = await getSharedTrip(cleanId);

  if (!doc?.trip) {
    notFound();
  }

  redirect(`/build-trip?share=${encodeURIComponent(cleanId)}`);
}