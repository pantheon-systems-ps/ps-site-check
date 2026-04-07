import { Link, useLocation } from "react-router";
import { Navbar } from "@pantheon-systems/pds-toolkit-react";

function LogoIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="22" height="22" style={{ verticalAlign: "middle" }}>
      <circle cx="14" cy="14" r="12" fill="none" stroke="#4f46e5" strokeWidth="2.5"/>
      <line x1="23" y1="23" x2="30" y2="30" stroke="#4f46e5" strokeWidth="3" strokeLinecap="round"/>
      <polyline points="9,14 13,18 20,10" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export default function AppNavbar() {
  const location = useLocation();

  const navLink = (to: string, label: string) => (
    <Link
      to={to}
      style={{
        fontSize: "0.85rem",
        color: location.pathname === to ? "#4f46e5" : "#666",
        textDecoration: "none",
        fontWeight: location.pathname === to ? 600 : 400,
        padding: "0.25rem 0",
        borderBottom: location.pathname === to ? "2px solid #4f46e5" : "2px solid transparent",
      }}
    >
      {label}
    </Link>
  );

  return (
    <Navbar
      containerWidth="full"
      hideBorder={false}
      colorType="transparent"
      hideLogo={true}
    >
      <div slot="items-left" style={{ display: "flex", gap: "1.25rem", alignItems: "center" }}>
        <Link
          to="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "1rem",
            fontWeight: 700,
            color: "#1a1a1a",
            textDecoration: "none",
            marginRight: "0.5rem",
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
