import { APP_NAME, LOGO_VERSION } from "../../lib/brand";

export default function BrandLogo({
  className = "",
}: {
  className?: string;
}) {
  return (
    <img
      src={`/brand/logo.svg?v=${encodeURIComponent(LOGO_VERSION)}`}
      alt={`${APP_NAME} logo`}
      className={["h-10 w-auto", className].join(" ")}
      loading="eager"
      decoding="async"
    />
  );
}