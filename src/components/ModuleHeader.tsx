import { type LucideIcon } from "lucide-react";

interface ModuleHeaderProps {
  title: string;
  description: string;
  icon: LucideIcon;
  backgroundImage?: string;
}

const ModuleHeader = ({ title, description, icon: Icon, backgroundImage }: ModuleHeaderProps) => {
  // Compact inline header — used when no banner image is provided
  if (!backgroundImage) {
    return (
      <div className="flex items-center gap-4 mb-6">
        <div className="h-10 w-10 rounded-xl bg-pd-accent/20 border border-pd-accent/30 flex items-center justify-center flex-shrink-0">
          <Icon className="h-5 w-5 text-pd-accent" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">{title}</h1>
          <p className="text-sm text-foreground/60">{description}</p>
        </div>
      </div>
    );
  }

  // Full banner header — used when a background image is provided
  return (
    <div className="relative w-full h-40 md:h-48 rounded-xl overflow-hidden mb-8">
      <img
        src={backgroundImage}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        loading="lazy"
      />
      {/* Dark gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-r from-[hsl(var(--pd-charcoal))]/90 via-[hsl(var(--pd-charcoal))]/70 to-transparent" />
      {/* Content */}
      <div className="relative h-full flex items-center px-8 md:px-12">
        <div className="flex items-center gap-5">
          <div className="hidden md:block h-16 w-1 rounded-full bg-pd-accent" />
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-pd-accent/20 border border-pd-accent/30 flex items-center justify-center">
              <Icon className="h-6 w-6 text-pd-accent" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground tracking-tight">{title}</h1>
              <p className="text-sm md:text-base text-foreground/60 mt-1">{description}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModuleHeader;
