import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import NavBar from "@/components/nav-bar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Cineaste",
  description: "We only talk about movies here.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-slate-50 text-slate-900 min-h-screen`}>
        <NavBar />
        {/* pl-14 = sidebar collapsed width (56px). Sidebar never pushes layout — it overlays. */}
        <main className="pl-14 min-h-screen">
          <div className="max-w-5xl mx-auto px-6 py-10">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
