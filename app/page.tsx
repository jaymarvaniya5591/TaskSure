import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
      <div className="text-center max-w-2xl mx-auto space-y-8">
        <h1 className="text-5xl sm:text-7xl font-extrabold tracking-tight text-black">
          Boldo AI.
        </h1>
        <p className="text-xl sm:text-2xl text-zinc-500 font-medium max-w-lg mx-auto">
          The WhatsApp-first accountability infrastructure for Indian SMBs.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-8">
          <Link href="/signup" className="w-full sm:w-auto">
            <Button className="w-full sm:w-auto sm:min-w-[160px] text-lg shadow-[0_4px_20px_0_rgba(234,179,8,0.4)]">
              Get Started
            </Button>
          </Link>
          <Link href="/login" className="w-full sm:w-auto">
            <Button variant="secondary" className="w-full sm:w-auto sm:min-w-[160px] text-lg">
              Sign In
            </Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
