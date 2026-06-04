import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Gamepad2, PoundSterling, Boxes, Ruler } from "lucide-react";

export default function GamesIndex() {
  return (
    <div className="space-y-6 max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3">
        <Gamepad2 className="h-7 w-7 text-pd-accent" />
        <h1 className="text-2xl font-bold text-foreground">Games</h1>
      </div>
      <p className="text-muted-foreground text-sm">
        Short, gamified tasks for staff. Optimised for phone use.
      </p>

      <div className="grid grid-cols-1 gap-4">
        <Link to="/games/mcg">
          <Card className="p-5 hover:border-pd-accent transition-colors cursor-pointer">
            <div className="flex items-start gap-4">
              <div className="rounded-md bg-pd-accent/10 p-3">
                <PoundSterling className="h-6 w-6 text-pd-accent" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-foreground">Missing Costs Game</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Rapid-fire cost price entry. Pick a brand or top sellers, set a round size, and start filling in the gaps.
                </p>
              </div>
            </div>
          </Card>
        </Link>

        <Link to="/games/scg">
          <Card className="p-5 hover:border-pd-accent transition-colors cursor-pointer">
            <div className="flex items-start gap-4">
              <div className="rounded-md bg-pd-accent/10 p-3">
                <Boxes className="h-6 w-6 text-pd-accent" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-foreground">Stock Count Game</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Count SKUs that have never been counted. Pick a brand, choose a set, and key in the numbers as you go.
                </p>
              </div>
            </div>
          </Card>
        </Link>
        <Link to="/games/rmg">
          <Card className="p-5 hover:border-pd-accent transition-colors cursor-pointer">
            <div className="flex items-start gap-4">
              <div className="rounded-md bg-pd-accent/10 p-3">
                <Ruler className="h-6 w-6 text-pd-accent" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-foreground">Remeasure Game</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Work through carrier penalty remeasures one SKU at a time. Pick a brand, choose a batch, record dimensions as you go.
                </p>
              </div>
            </div>
          </Card>
        </Link>
      </div>
    </div>
  );
}
