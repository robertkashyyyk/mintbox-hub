import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Gamepad2, PoundSterling } from "lucide-react";

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
      </div>
    </div>
  );
}
