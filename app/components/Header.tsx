import Link from "next/link";
import BrandLogo from "@/app/components/BrandLogo"; // adjust path if needed

export default function Header() {
  return (
    <header
      style={{
        borderBottom: "1px solid #e5e7eb",
        background: "#fff",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
        }}
      >
        <Link href="/" style={{ display: "inline-flex", alignItems: "center" }}>
          <BrandLogo />
        </Link>
      </div>
    </header>
  );
}