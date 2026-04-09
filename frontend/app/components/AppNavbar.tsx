import { Link, useLocation } from "react-router";
import { Navbar } from "@pantheon-systems/pds-toolkit-react";

function LogoIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="20" height="20" style={{ verticalAlign: "middle" }}>
      <circle cx="14" cy="14" r="12" fill="none" stroke="var(--color-primary)" strokeWidth="2.5"/>
      <line x1="23" y1="23" x2="30" y2="30" stroke="var(--color-primary)" strokeWidth="3" strokeLinecap="round"/>
      <polyline points="9,14 13,18 20,10" fill="none" stroke="var(--color-success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export default function AppNavbar() {
  const location = useLocation();

  const navLink = (to: string, label: string) => {
    const active = location.pathname === to;
    return (
      <Link
        to={to}
        style={{
          fontSize: "0.8rem",
          color: active ? "var(--color-primary)" : "var(--color-text-secondary)",
          textDecoration: "none",
          fontWeight: active ? 600 : 500,
          padding: "0.25rem 0",
          borderBottom: active ? "2px solid var(--color-primary)" : "2px solid transparent",
          transition: "color 0.1s",
        }}
      >
        {label}
      </Link>
    );
  };

  return (
    <Navbar containerWidth="full" hideBorder={false} colorType="transparent" hideLogo={true}>
      <div slot="items-left" style={{ display: "flex", gap: "1.25rem", alignItems: "center" }}>
        <Link
          to="/"
          style={{
            display: "flex", alignItems: "center", gap: "0.4rem",
            fontSize: "0.9rem", fontWeight: 700,
            color: "var(--color-text)", textDecoration: "none",
            marginRight: "0.75rem",
          }}
        >
          <LogoIcon />
          Site Check
        </Link>
        {navLink("/", "Check")}
        {navLink("/batch", "Batch")}
        {navLink("/compare", "Compare")}
        {navLink("/har", "HAR")}
        {navLink("/migration", "Migration")}
      </div>
    </Navbar>
  );
}
