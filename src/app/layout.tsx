import "./globals.css";
import Link from "next/link";
export const metadata = { title: "AdEngine", description: "Motor de publicidad prudente para todos tus negocios" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>
        <div className="wrap">
          <header className="top">
            <Link href="/" className="brand">AdEngine <span>· campañas con freno de mano</span></Link>
            <nav className="row">
              <Link href="/negocios/nuevo" className="btn btn-secondary">Añadir negocio</Link>
              <a href="/api/google/auth" className="btn">Conectar Google Ads</a>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
