import { type LucideIcon } from "lucide-react";

interface ModuleHeaderProps {
  title: string;
  description: string;
  icon: LucideIcon;
  backgroundImage?: string;
}

const ModuleHeader = ({ title, description, icon: Icon, backgroundImage }: ModuleHeaderProps) => {
  return (
    <div className="relative w-full h-40 md:h-48 rounded-xl overflow-hidden mb-8">
      {/* Background */}
      {backgroundImage ? (
        <img
          src={backgroundImage}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[hsl(var(--pd-charcoal))] to-[hsl(var(--pd-graphite))]" />
      )}
      
      {/* Dark gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-r from-[hsl(var(--pd-charcoal))]/90 via-[hsl(var(--pd-charcoal))]/70 to-transparent" />
      
      {/* Content */}
      <div className="relative h-full flex items-center px-8 md:px-12">
        <div className="flex items-center gap-5">
          {/* Teal accent bar */}
          <div className="hidden md:block h-16 w-1 rounded-full bg-[hsl(var(--pd-accent))]" />
          
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-[hsl(var(--pd-accent))]/20 border border-[hsl(var(--pd-accent))]/30 flex items-center justify-center">
              <Icon className="h-6 w-6 text-[hsl(var(--pd-accent))]" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">{title}</h1>
              <p className="text-sm md:text-base text-white/60 mt-1">{description}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModuleHeader;
