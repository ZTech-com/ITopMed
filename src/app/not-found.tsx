import { getTranslations } from "next-intl/server";
import { ButtonLink } from "@/components/ui/primitives";

export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-md text-center">
        <p className="text-[56px] font-semibold tracking-[-0.04em] text-text-3">404</p>
        <h1 className="mt-2 text-[22px] font-semibold">{t("notFoundTitle")}</h1>
        <p className="mt-2 text-text-2">{t("notFoundBody")}</p>
        <ButtonLink href="/" variant="secondary" className="mt-6">
          ITop Med
        </ButtonLink>
      </div>
    </main>
  );
}
