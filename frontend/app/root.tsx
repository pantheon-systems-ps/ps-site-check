import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import AppNavbar from "~/components/AppNavbar";
import { GlobalWrapper, SiteFooter } from "@pantheon-systems/pds-toolkit-react";

import "@pantheon-systems/pds-toolkit-react/css/pds-core.css";
import "@pantheon-systems/pds-toolkit-react/css/pds-components.css";
import "@pantheon-systems/pds-toolkit-react/css/pds-layouts.css";
import "./app.css";

export const meta: Route.MetaFunction = () => {
  return [
    { title: "Site Check — Website Audit" },
    { name: "description", content: "Comprehensive website audit — DNS, security, TLS, SEO, performance, and AI-powered insights. Powered by Pantheon." },
  ];
};

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <Meta />
        <Links />
      </head>
      <body>
        <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
          <a href="#main-content" className="skip-nav">Skip to main content</a>
          <GlobalWrapper>
            <AppNavbar />
            <main id="main-content" style={{ maxWidth: "1400px", margin: "0 auto", padding: "1.5rem 2rem", flex: 1 }}>
              {children}
            </main>
            <SiteFooter containerWidth="full" />
          </GlobalWrapper>
        </div>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
