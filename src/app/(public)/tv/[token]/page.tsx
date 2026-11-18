import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { WaitingRoomBoard } from "@/components/waiting-room-board";
import { boardForToken } from "@/server/queue/board";

export const metadata = { title: "Navbat" };

/**
 * Waiting-room screen (TV). No sign-in: the secret link is the credential.
 * The first data is rendered on the server, then the board refreshes itself.
 */
export default async function TvPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const board = await boardForToken(token);
  if (!board) notFound();
  const t = await getTranslations("waitingRoom");
  return (
    <WaitingRoomBoard
      token={token}
      initial={board}
      labels={{
        title: t("title"),
        now: t("now"),
        waiting: t("waiting"),
        number: t("number"),
        cabinet: t("cabinet"),
        inVisit: t("inVisit"),
        empty: t("empty"),
        soundOn: t("soundOn"),
        soundHint: t("soundHint"),
        spoken: t.raw("spoken") as string,
        spokenNoCabinet: t.raw("spokenNoCabinet") as string,
        offline: t("offline"),
      }}
    />
  );
}
