import { LeftNav } from "@/components/shell/left-nav";
import { MobileNav } from "@/components/shell/mobile-nav";
import { RightSidebar } from "@/components/shell/right-sidebar";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1265px] justify-center">
      <header className="sticky top-0 hidden h-dvh w-[72px] shrink-0 sm:block md:w-[88px] xl:w-[275px]">
        <LeftNav />
      </header>
      <main
        id="main"
        className="min-h-dvh w-full min-w-0 max-w-[600px] pb-[calc(56px+env(safe-area-inset-bottom))] sm:border-x sm:pb-0"
      >
        {children}
      </main>
      <aside className="hidden w-[350px] shrink-0 pl-7 lg:block" aria-label="Sidebar">
        <RightSidebar />
      </aside>
      <MobileNav />
    </div>
  );
}
