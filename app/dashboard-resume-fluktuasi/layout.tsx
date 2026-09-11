import './dashboard-resume.css';
import SidebarFullscreenToggle from './SidebarFullscreenToggle';

export default function DashboardResumeFluktuasiLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="dashboard-resume-route">
      {children}
      <SidebarFullscreenToggle />
    </div>
  );
}
