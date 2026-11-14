import { redirect } from "next/navigation";
import { needsFirstRun } from "@/server/local/first-run";

export const dynamic = "force-dynamic";

export default async function Home() {
  // A fresh local installation starts with its one-form setup.
  redirect((await needsFirstRun()) ? "/welcome" : "/login");
}
