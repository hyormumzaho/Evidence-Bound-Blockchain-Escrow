import { Disclaimer } from "@/components/Disclaimer";
import { Nav } from "@/components/Nav";
import { MeasurementTable } from "@/components/research/MeasurementTable";

export default function ResearchPage() {
  return (
    <main className="space-y-6">
      <Nav />
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Measured costs</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
          These figures come from <code>experiments/results/latest.json</code>, written by the headless runner.
          This page does not estimate gas.
        </p>
      </header>
      <Disclaimer />
      <MeasurementTable />
    </main>
  );
}
